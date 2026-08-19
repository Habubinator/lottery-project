import cron from 'node-cron';
import { walletService } from '@wallet/services';
import {
  giveawayService,
  prizeService,
  finalizeJointsOnGiveawayStart,
} from '@giveaways/services';
import { telegramGiftService } from '@telegram-gifts';
import {
  updateGiveawayButtons,
  generateInviteLink,
  sendGiveawayAnnouncement,
  NotificationService,
  identifySponsorChannels,
  generateTrackingCode,
  sendSponsorApprovalRequest,
  sendMessage,
  sendCreatorActivationNotification,
  syncChannelFromTelegram,
  reconcileChannelAddedBy,
  getChannelsNeedingMetadataSync,
  getChannelsNeedingOwnershipReconcile,
  cleanupDescriptionPreviewMessages,
} from '@bot/service';
import {
  getUserLanguage,
  DESCRIPTION_REQUEST_MESSAGES,
} from '@bot/service/localization';
import { prisma } from '@database';
import { fragmentStarsRateService } from '@admin/services/fragment-stars-rate.service';

const DEFAULT_FRAGMENT_EXCHANGE_RATE_CRON = '0 */6 * * *'; // Every 6 hours

class CronService {
  holdProcessingJob?: cron.ScheduledTask;
  giveawayCapacityCheckJob?: cron.ScheduledTask;
  giveawayTimeCheckJob?: cron.ScheduledTask;
  giveawayButtonsUpdateJob?: cron.ScheduledTask;
  giveawayActivationCheckJob?: cron.ScheduledTask;
  channelInviteLinkUpdateJob?: cron.ScheduledTask;
  channelMetadataSyncJob?: cron.ScheduledTask;
  channelOwnershipReconcileJob?: cron.ScheduledTask;
  descriptionRequestCleanupJob?: cron.ScheduledTask;
  cooldownPrizesRetryJob?: cron.ScheduledTask;
  fragmentExchangeRateJob?: cron.ScheduledTask;
  telegramGiftImageSyncJob?: cron.ScheduledTask;

  constructor() {
    this.initializeJobs();
  }

  private initializeJobs() {
    // Run every 10 minutes to check for expired holds
    this.holdProcessingJob = cron.schedule(
      '*/10 * * * *', // Every 10 minutes
      this.processExpiredHolds.bind(this),
      {
        scheduled: false,
        timezone: 'UTC',
      },
    );

    // Run every 30 seconds to check giveaways with ByCapacity completion
    this.giveawayCapacityCheckJob = cron.schedule(
      '*/30 * * * * *', // Every 30 seconds
      this.checkGiveawaysByCapacity.bind(this),
      {
        scheduled: false,
        timezone: 'UTC',
      },
    );

    // Run every minute to check giveaways with ByTime completion
    this.giveawayTimeCheckJob = cron.schedule(
      '* * * * *', // Every minute
      this.checkGiveawaysByTime.bind(this),
      {
        scheduled: false,
        timezone: 'UTC',
      },
    );

    // Run every minute to update buttons for active giveaways
    this.giveawayButtonsUpdateJob = cron.schedule(
      '* * * * *', // Every minute
      this.updateActiveGiveawayButtons.bind(this),
      {
        scheduled: false,
        timezone: 'UTC',
      },
    );

    // Run every minute to check giveaways that need to be activated
    this.giveawayActivationCheckJob = cron.schedule(
      '* * * * *', // Every minute
      this.checkGiveawaysToActivate.bind(this),
      {
        scheduled: false,
        timezone: 'UTC',
      },
    );

    // Run daily at midnight UTC to refresh all invite links for private channels
    // This prevents link expiration by regenerating them regularly
    this.channelInviteLinkUpdateJob = cron.schedule(
      '0 0 * * *', // Daily at 00:00 UTC
      this.updateMissingChannelInviteLinks.bind(this),
      {
        scheduled: false,
        timezone: 'UTC',
      },
    );

    this.channelMetadataSyncJob = cron.schedule(
      '0 * * * *', // Every hour at :00 UTC
      this.syncLinkedChannelMetadata.bind(this),
      {
        scheduled: false,
        timezone: 'UTC',
      },
    );

    this.channelOwnershipReconcileJob = cron.schedule(
      '0 0 * * *', // Daily at 00:00 UTC
      this.reconcileLinkedChannelOwnership.bind(this),
      {
        scheduled: false,
        timezone: 'UTC',
      },
    );

    // Run every minute to notify users whose description request expired without a response
    this.descriptionRequestCleanupJob = cron.schedule(
      '* * * * *', // Every minute
      this.cleanupExpiredDescriptionRequests.bind(this),
      {
        scheduled: false,
        timezone: 'UTC',
      },
    );

    // Run every 10 minutes to release stale gift deliveries without auto-retrying cooldown prizes
    this.cooldownPrizesRetryJob = cron.schedule(
      '*/10 * * * *', // Every 10 minutes
      this.retryCooldownPrizes.bind(this),
      {
        scheduled: false,
        timezone: 'UTC',
      },
    );

    // Sync Telegram catalog gift stickers so new gifts get images without API restart
    this.telegramGiftImageSyncJob = cron.schedule(
      '0 * * * *', // Every hour
      this.syncTelegramGiftImages.bind(this),
      {
        scheduled: false,
        timezone: 'UTC',
      },
    );

    this.initializeFragmentExchangeRateJob();
  }

  /**
   * Refresh gift catalog cache + download missing sticker files; repair prize images.
   */
  private async syncTelegramGiftImages() {
    try {
      console.log('[Cron] Syncing Telegram gift catalog images...');
      await telegramGiftService.getAll({ forceRefresh: true });
      await telegramGiftService.initializeGiftImages();
      await prizeService.backfillMissingPrizeStickerImages();
      console.log('[Cron] Telegram gift image sync complete');
    } catch (error) {
      console.error('[Cron] Telegram gift image sync failed:', error);
    }
  }

  /**
   * Fragment exchange rate sync (optional env schedule; invalid cron must not crash cron boot).
   */
  private initializeFragmentExchangeRateJob() {
    if (process.env.FRAGMENT_EXCHANGE_RATE_SYNC_ENABLED === 'false') {
      return;
    }

    const configured = process.env.FRAGMENT_EXCHANGE_RATE_CRON?.trim();
    let schedule = configured || DEFAULT_FRAGMENT_EXCHANGE_RATE_CRON;

    if (!cron.validate(schedule)) {
      console.error(
        `[Fragment] Invalid FRAGMENT_EXCHANGE_RATE_CRON "${configured ?? schedule}", using default "${DEFAULT_FRAGMENT_EXCHANGE_RATE_CRON}"`,
      );
      schedule = DEFAULT_FRAGMENT_EXCHANGE_RATE_CRON;
    }

    try {
      this.fragmentExchangeRateJob = cron.schedule(
        schedule,
        this.syncFragmentExchangeRate.bind(this),
        {
          scheduled: false,
          timezone: 'UTC',
        },
      );
    } catch (error) {
      console.error(
        '[Fragment] Failed to register exchange rate sync cron job:',
        error,
      );
    }
  }

  /**
   * Fetch Fragment Stars packages and update ExchangeRate in DB.
   */
  private async syncFragmentExchangeRate() {
    try {
      console.log('[Fragment] Syncing exchange rate from Fragment...');
      const { starsInput, tonOutput } =
        await fragmentStarsRateService.syncExchangeRateFromFragment();
      console.log(
        `[Fragment] Exchange rate updated: ${starsInput} Stars = ${tonOutput} TON`,
      );
    } catch (error) {
      console.error('[Fragment] Failed to sync exchange rate:', error);
    }
  }

  /**
   * Process expired Stars holds
   */
  private async processExpiredHolds() {
    try {
      console.log('Starting expired holds processing...');

      const result = await walletService.processExpiredHolds();

      if (result.processed > 0) {
        console.log(
          `Processed ${result.processed} holds: ${result.successful} successful, ${result.failed} failed`,
        );

        // Log failed attempts for monitoring
        if (result.failed > 0) {
          const failedDetails = result.details.filter((d) => !d.success);
          console.error('Failed hold processing details:', {
            failedDetails,
          });
        }

        // Log successful releases
        const successfulDetails = result.details
          .filter((d) => d.success)
          .map((d) => ({ holdId: d.holdId, amount: d.amount }));

        if (successfulDetails.length > 0) {
          console.log('Successfully released Stars:', {
            successfulDetails,
          });
        }
      } else {
        console.log('No expired holds found');
      }
    } catch (error) {
      console.error('Error processing expired holds:', error);
    }
  }

  /**
   * Check giveaways with ByCapacity completion type
   */
  private async checkGiveawaysByCapacity() {
    try {
      const giveaways =
        await giveawayService.getGiveawaysToCompleteByCapacity();

      if (giveaways.length > 0) {
        console.log(
          `Found ${giveaways.length} giveaway(s) to complete by capacity`,
        );

        for (const giveaway of giveaways) {
          try {
            const result = await giveawayService.autoCompleteGiveaway(
              giveaway.id,
            );
            if (result) {
              console.log(`Auto-completed giveaway ${giveaway.id} by capacity`);
            }
          } catch (error) {
            console.error(
              `Error auto-completing giveaway ${giveaway.id}:`,
              error,
            );
          }
        }
      }
    } catch (error) {
      console.error('Error checking giveaways by capacity:', error);
    }
  }

  /**
   * Check giveaways with ByTime completion type
   */
  private async checkGiveawaysByTime() {
    try {
      const giveaways = await giveawayService.getGiveawaysToCompleteByTime();

      if (giveaways.length > 0) {
        console.log(
          `Found ${giveaways.length} giveaway(s) to complete by time`,
        );

        for (const giveaway of giveaways) {
          try {
            const result = await giveawayService.autoCompleteGiveaway(
              giveaway.id,
            );
            if (result) {
              console.log(`Auto-completed giveaway ${giveaway.id} by time`);
            }
          } catch (error) {
            console.error(
              `Error auto-completing giveaway ${giveaway.id}:`,
              error,
            );
          }
        }
      }
    } catch (error) {
      console.error('Error checking giveaways by time:', error);
    }
  }

  /**
   * Update buttons for all active giveaways
   */
  private async updateActiveGiveawayButtons() {
    try {
      console.log('Starting active giveaways buttons update...');

      // Get all active giveaways that have linked or postlot messages (exclude planned)
      const activeGiveaways = await prisma.giveaway.findMany({
        where: {
          isActive: true,
          isPlanned: false,
          isCancelled: false,
          OR: [
            { messages: { some: {} } },
            { postlotPublications: { some: {} } },
          ],
        },
        select: {
          id: true,
        },
      });

      if (activeGiveaways.length === 0) {
        console.log('No active giveaways found');
        return;
      }

      console.log(
        `Found ${activeGiveaways.length} active giveaway(s) to update buttons`,
      );

      const webappUrl = process.env.BOT_URL || 'https://t.me/your_bot';

      let totalSuccess = 0;
      let totalFailed = 0;

      // Update buttons for each giveaway
      for (const giveaway of activeGiveaways) {
        try {
          const result = await updateGiveawayButtons(giveaway.id, webappUrl);
          totalSuccess += result.success;
          totalFailed += result.failed;

          // if (result.success > 0) {
          //   console.log(
          //     `Updated ${result.success} message(s) for giveaway ${giveaway.id}`,
          //   );
          // }

          if (result.failed > 0) {
            console.error(
              `Failed to update ${result.failed} message(s) for giveaway ${giveaway.id}`,
            );
          }
        } catch (error) {
          console.error(
            `Error updating buttons for giveaway ${giveaway.id}:`,
            error instanceof Error ? error.message : error,
          );
        }
      }

      console.log(
        `Buttons update completed: ${totalSuccess} successful, ${totalFailed} failed`,
      );
    } catch (error) {
      console.error('Error updating active giveaway buttons:', error);
    }
  }

  /**
   * Check giveaways that need to be activated
   */
  private async checkGiveawaysToActivate() {
    try {
      console.log('Checking giveaways to activate...');

      const now = new Date();
      const giveawaysToActivate = await prisma.giveaway.findMany({
        where: {
          isActive: false,
          isPlanned: true,
          isCancelled: false,
          startingAt: {
            lte: now,
          },
          OR: [{ endingAt: null }, { endingAt: { gt: now } }],
        },
        select: {
          id: true,
          startingAt: true,
          endingAt: true,
          completionType: true,
        },
      });

      if (giveawaysToActivate.length === 0) {
        console.log('No giveaways to activate');
        return;
      }

      console.log(
        `Found ${giveawaysToActivate.length} giveaway(s) to activate`,
      );

      // Activate each giveaway
      for (const giveaway of giveawaysToActivate) {
        try {
          const activatedGiveaway = await prisma.giveaway.update({
            where: { id: giveaway.id },
            data: {
              isActive: true,
              isPlanned: false,
            },
            include: {
              linkedChannels: {
                include: {
                  channel: true,
                },
              },
              createdBy: {
                select: {
                  id: true,
                  first_name: true,
                  last_name: true,
                  username: true,
                  telegramId: true,
                },
              },
            },
          });
          console.log(
            `Activated giveaway ${giveaway.id} (removed planned status)`,
          );

          // Send announcements and notifications after activation
          let hasSponsorChannels = false;
          // Only consider posting channels (All or Posting); skip subscription-only channels
          const postingLinkedChannels = activatedGiveaway.linkedChannels.filter(
            (lc) => lc.role === 'All' || lc.role === 'Posting',
          );
          if (postingLinkedChannels.length > 0) {
            try {
              const webappUrl = process.env.BOT_URL;

              // Identify sponsor channels (channels NOT added by giveaway creator)
              const creatorUserId = activatedGiveaway.createdBy?.id;
              if (creatorUserId) {
                const sponsorChannels = await identifySponsorChannels(
                  activatedGiveaway.id,
                  creatorUserId,
                );

                const sponsorChannelIds = new Set(
                  sponsorChannels.map((sc) => sc.channelId.toString()),
                );

                // Check if there are any creator's own channels among posting channels
                const hasCreatorChannels =
                  postingLinkedChannels.some(
                    (lc) => !sponsorChannelIds.has(lc.channelId.toString()),
                  );

                // Post immediately to creator's own channels only
                if (hasCreatorChannels) {
                  const announcementResult = await sendGiveawayAnnouncement(
                    activatedGiveaway.id,
                    webappUrl,
                    Array.from(sponsorChannelIds).map((id) => BigInt(id)),
                  );
                  console.log(
                    `Giveaway ${activatedGiveaway.id} activated - announcements sent to creator channels: ${announcementResult.success} successful, ${announcementResult.failed} failed`,
                  );
                }

                hasSponsorChannels = sponsorChannels.length > 0;

                // Send approval requests to sponsor channel owners
                if (sponsorChannels.length > 0) {
                  const giveawayForApproval = await prisma.giveaway.findUnique({
                    where: { id: activatedGiveaway.id },
                    select: {
                      id: true,
                      createdById: true,
                      participiationType: true,
                      language: true,
                      banner: true,
                      createdBy: {
                        select: {
                          telegramId: true,
                          first_name: true,
                          last_name: true,
                          username: true,
                        },
                      },
                    },
                  });

                  if (giveawayForApproval) {
                    const failedChannelTitles: string[] = [];

                    for (const sponsorChannel of sponsorChannels) {
                      if (sponsorChannel.owners.length === 0) {
                        // Co-owner channel has no registered users — alert creator
                        failedChannelTitles.push(sponsorChannel.channelTitle);
                        console.log(
                          `No registered owners for sponsor channel ${sponsorChannel.channelId} (${sponsorChannel.channelTitle}) — will notify creator`,
                        );
                        continue;
                      }

                      for (const owner of sponsorChannel.owners) {
                        const trackingCode = generateTrackingCode(
                          activatedGiveaway.id,
                          sponsorChannel.channelId,
                        );

                        // Create approval record first to get ID (upsert to handle race with manual activation)
                        const createdApproval =
                          await prisma.sponsorApproval.upsert({
                            where: {
                              giveawayId_channelId_ownerUserId: {
                                giveawayId: activatedGiveaway.id,
                                channelId: sponsorChannel.channelId,
                                ownerUserId: owner.userId,
                              },
                            },
                            create: {
                              giveawayId: activatedGiveaway.id,
                              channelId: sponsorChannel.channelId,
                              ownerUserId: owner.userId,
                              trackingCode,
                              status: 'Pending',
                            },
                            update: {},
                          });

                        // Send approval request with approval ID
                        const targetUser = await prisma.user.findFirst({
                          where: {
                            telegramId: owner.telegramId,
                          },
                          select: {
                            first_name: true,
                            last_name: true,
                            picked_language: true,
                            language_code: true,
                          },
                        });

                        try {
                          const result = await sendSponsorApprovalRequest(
                            owner.telegramId,
                            targetUser.first_name,
                            targetUser.last_name,
                            {
                              id: giveawayForApproval.id,
                              type: giveawayForApproval.participiationType,
                              createdById: giveawayForApproval.createdById,
                              banner: giveawayForApproval.banner,
                            },
                            sponsorChannel.channelId,
                            sponsorChannel.channelTitle,
                            createdApproval.id,
                            getUserLanguage(targetUser ?? {}),
                            owner.userId,
                          );

                          if (result.success && result.messageId) {
                            await prisma.sponsorApproval.update({
                              where: { id: createdApproval.id },
                              data: {
                                messageId: BigInt(result.messageId),
                              },
                            });
                          } else if (!result.success) {
                            // DM failed (e.g. co-owner hasn't started the bot)
                            failedChannelTitles.push(
                              sponsorChannel.channelTitle,
                            );
                            console.log(
                              `Could not DM co-owner ${owner.userId} for channel ${sponsorChannel.channelTitle}: ${result.error}`,
                            );
                          }
                        } catch (dmError: any) {
                          failedChannelTitles.push(sponsorChannel.channelTitle);
                          console.log(
                            `Exception sending approval DM to co-owner ${owner.userId}: ${dmError?.message}`,
                          );
                        }

                        console.log(
                          `Sent sponsor approval request to owner ${owner.userId} for channel ${sponsorChannel.channelId}`,
                        );
                      }
                    }

                    // Notify creator about channels whose co-owners couldn't be reached
                    if (
                      failedChannelTitles.length > 0 &&
                      giveawayForApproval.createdBy?.telegramId
                    ) {
                      try {
                        const channelList = failedChannelTitles
                          .map((t) => `• ${t}`)
                          .join('\n');
                        await sendMessage(
                          giveawayForApproval.createdBy.telegramId,
                          `⚠️ Could not notify co-owner(s) for the following channel(s):\n${channelList}\n\nAsk them to start the bot first: /start`,
                        );
                      } catch (notifyError: any) {
                        console.log(
                          `Could not notify creator about unreachable co-owners: ${notifyError?.message}`,
                        );
                      }
                    }
                  }
                }
              } else {
                // No creator - fall back to original behavior (post to all channels)
                const announcementResult = await sendGiveawayAnnouncement(
                  activatedGiveaway.id,
                  webappUrl,
                );
                console.log(
                  `Giveaway ${activatedGiveaway.id} activated - announcements sent: ${announcementResult.success} successful, ${announcementResult.failed} failed`,
                );
              }

              // Channel subscribers: always notify on activation (free, no isNotificationOn gate).
              // Atomic updateMany prevents duplicates if manual activation fires concurrently.
              if (!activatedGiveaway.lastChannelNotifiedAt) {
                const claimedChannel = await prisma.giveaway.updateMany({
                  where: { id: activatedGiveaway.id, lastChannelNotifiedAt: null },
                  data: { lastChannelNotifiedAt: new Date() },
                });
                if (claimedChannel.count > 0) {
                  await NotificationService.notifyChannelSubscribers(activatedGiveaway.id);
                }
              }

              // Paid broadcast: notify FromAll users not in channel list.
              // Use atomic updateMany to claim the notification slot — prevents
              // duplicate notifications if the update endpoint fires concurrently.
              if (activatedGiveaway.isNotificationOn && !activatedGiveaway.lastNotifiedAt) {
                const claimed = await prisma.giveaway.updateMany({
                  where: { id: activatedGiveaway.id, lastNotifiedAt: null },
                  data: { lastNotifiedAt: new Date() },
                });
                if (claimed.count > 0) {
                  await NotificationService.notifyGiveawayCreated(activatedGiveaway.id);
                }
              }
            } catch (notifyError) {
              console.error(
                `Error sending announcements for giveaway ${activatedGiveaway.id}:`,
                notifyError,
              );
            }
          }

          // Notify creator that giveaway has started
          const creatorTelegramId = activatedGiveaway.createdBy?.telegramId;
          if (creatorTelegramId) {
            try {
              await sendCreatorActivationNotification(
                creatorTelegramId,
                activatedGiveaway.id,
                activatedGiveaway.participiationType === 'Lottery' ? 'lottery' : 'random',
                activatedGiveaway.language ?? 'en',
                hasSponsorChannels,
                activatedGiveaway.banner,
              );
            } catch (err) {
              console.error(
                `Error sending creator activation notification for ${activatedGiveaway.id}:`,
                err,
              );
            }
          }

          // Auto-decline pending joints + credit Accepted to creator hold
          try {
            await finalizeJointsOnGiveawayStart(activatedGiveaway.id);
          } catch (err) {
            console.error(
              `Error finalizing joints for giveaway ${activatedGiveaway.id}:`,
              err,
            );
          }
        } catch (error) {
          console.error(
            `Error activating giveaway ${giveaway.id}:`,
            error instanceof Error ? error.message : error,
          );
        }
      }
    } catch (error) {
      console.error('Error checking giveaways to activate:', error);
    }
  }

  /**
   * Refresh invite links for all active private channels
   * This regenerates links to prevent expiration issues
   */
  private async updateMissingChannelInviteLinks() {
    try {
      console.log('Starting invite links refresh...');

      // Find all active private channels (without username) to refresh their invite links
      // This includes both missing links and expired links that need regeneration
      const channelsNeedingLinks = await prisma.channel.findMany({
        where: {
          isActive: true,
          username: null,
        },
        select: {
          id: true,
          title: true,
        },
      });

      if (channelsNeedingLinks.length === 0) {
        console.log('No private channels found to update');
        return;
      }

      console.log(
        `Found ${channelsNeedingLinks.length} private channel(s) to refresh invite links`,
      );

      let successCount = 0;
      let failedCount = 0;

      // Update each channel
      for (const channel of channelsNeedingLinks) {
        try {
          console.log(
            `Generating invite link for channel ${channel.id} (${channel.title || 'Unnamed'})...`,
          );

          const inviteLink = await generateInviteLink(channel.id);

          if (inviteLink) {
            await prisma.channel.update({
              where: { id: channel.id },
              data: { inviteLink },
            });

            console.log(
              `✓ Successfully updated invite link for channel ${channel.id}: ${inviteLink}`,
            );
            successCount++;
          } else {
            console.warn(
              `✗ Failed to generate invite link for channel ${channel.id}`,
            );
            failedCount++;
          }
        } catch (error) {
          console.error(
            `Error updating invite link for channel ${channel.id}:`,
            error instanceof Error ? error.message : error,
          );
          failedCount++;
        }
      }

      console.log(
        `Invite links update completed: ${successCount} successful, ${failedCount} failed`,
      );
    } catch (error) {
      console.error('Error updating missing channel invite links:', error);
    }
  }

  private async syncLinkedChannelMetadata() {
    try {
      const channels = await getChannelsNeedingMetadataSync();
      if (channels.length === 0) return;

      console.log(
        `Starting hourly channel metadata sync for ${channels.length} channel(s)...`,
      );

      const batchSize = 5;
      for (let i = 0; i < channels.length; i += batchSize) {
        const batch = channels.slice(i, i + batchSize);
        await Promise.all(
          batch.map((channel) => syncChannelFromTelegram(channel.id)),
        );
      }
    } catch (error) {
      console.error('Error syncing linked channel metadata:', error);
    }
  }

  private async reconcileLinkedChannelOwnership() {
    try {
      const channels = await getChannelsNeedingOwnershipReconcile();
      if (channels.length === 0) return;

      console.log(
        `Starting daily channel ownership reconcile for ${channels.length} channel(s)...`,
      );

      const batchSize = 5;
      for (let i = 0; i < channels.length; i += batchSize) {
        const batch = channels.slice(i, i + batchSize);
        await Promise.all(
          batch.map((channel) => reconcileChannelAddedBy(channel.id)),
        );
      }
    } catch (error) {
      console.error('Error reconciling linked channel ownership:', error);
    }
  }

  /**
   * Notify users whose description request expired (still pending, never answered) and delete records
   */
  private async cleanupExpiredDescriptionRequests(): Promise<void> {
    try {
      const expired = await prisma.descriptionRequest.findMany({
        where: { expiresAt: { lt: new Date() }, description: null },
        include: { user: { select: { telegramId: true, picked_language: true, language_code: true } } },
      });

      for (const request of expired) {
        if (request.user.telegramId) {
          await cleanupDescriptionPreviewMessages(
            request.userId,
            request.user.telegramId,
          );
          const lang = getUserLanguage(request.user);
          await sendMessage(request.user.telegramId, DESCRIPTION_REQUEST_MESSAGES.expired[lang]).catch(() => {});
        }
      }

      if (expired.length > 0) {
        await prisma.descriptionRequest.deleteMany({
          where: { id: { in: expired.map((r) => r.id) } },
        });
      }
    } catch (error) {
      console.error('Error cleaning up expired description requests:', error);
    }
  }

  /**
   * Recover stale gift deliveries without auto-retrying cooldown prizes
   */
  private async retryCooldownPrizes() {
    try {
      const releasedCooldown = await prizeService.releaseExpiredCooldownPrizes();
      if (releasedCooldown > 0) {
        console.log(`Released ${releasedCooldown} expired cooldown prize(s)`);
      }

      const released = await prizeService.releaseStaleProcessingPrizes();
      if (released > 0) {
        console.log(`Recovered ${released} stale gift delivery job(s)`);
      }
    } catch (error) {
      console.error('Error recovering stale gift deliveries:', error);
    }
  }

  /**
   * Start all cron jobs
   */
  start() {
    if (this.holdProcessingJob) {
      this.holdProcessingJob.start();
      console.log('Hold processing cron job started');
    }
    if (this.giveawayCapacityCheckJob) {
      this.giveawayCapacityCheckJob.start();
      console.log('Giveaway capacity check cron job started');
    }
    if (this.giveawayTimeCheckJob) {
      this.giveawayTimeCheckJob.start();
      console.log('Giveaway time check cron job started');
    }
    if (this.giveawayButtonsUpdateJob) {
      this.giveawayButtonsUpdateJob.start();
      console.log('Giveaway buttons update cron job started');
    }
    if (this.giveawayActivationCheckJob) {
      this.giveawayActivationCheckJob.start();
      console.log('Giveaway activation check cron job started');
    }
    if (this.channelInviteLinkUpdateJob) {
      this.channelInviteLinkUpdateJob.start();
      console.log('Channel invite link update cron job started');
    }
    if (this.channelMetadataSyncJob) {
      this.channelMetadataSyncJob.start();
      console.log('Channel metadata sync cron job started');
    }
    if (this.channelOwnershipReconcileJob) {
      this.channelOwnershipReconcileJob.start();
      console.log('Channel ownership reconcile cron job started');
    }
    if (this.descriptionRequestCleanupJob) {
      this.descriptionRequestCleanupJob.start();
      console.log('Description request cleanup cron job started');
    }
    if (this.cooldownPrizesRetryJob) {
      this.cooldownPrizesRetryJob.start();
      console.log('Gift delivery recovery cron job started');
    }
    if (this.telegramGiftImageSyncJob) {
      this.telegramGiftImageSyncJob.start();
      console.log('Telegram gift image sync cron job started');
    }
    if (this.fragmentExchangeRateJob) {
      this.fragmentExchangeRateJob.start();
      console.log('Fragment exchange rate sync cron job started');
    }
  }

  /**
   * Stop all cron jobs
   */
  stop() {
    if (this.holdProcessingJob) {
      this.holdProcessingJob.stop();
      console.log('Hold processing cron job stopped');
    }
    if (this.giveawayCapacityCheckJob) {
      this.giveawayCapacityCheckJob.stop();
      console.log('Giveaway capacity check cron job stopped');
    }
    if (this.giveawayTimeCheckJob) {
      this.giveawayTimeCheckJob.stop();
      console.log('Giveaway time check cron job stopped');
    }
    if (this.giveawayButtonsUpdateJob) {
      this.giveawayButtonsUpdateJob.stop();
      console.log('Giveaway buttons update cron job stopped');
    }
    if (this.giveawayActivationCheckJob) {
      this.giveawayActivationCheckJob.stop();
      console.log('Giveaway activation check cron job stopped');
    }
    if (this.channelInviteLinkUpdateJob) {
      this.channelInviteLinkUpdateJob.stop();
      console.log('Channel invite link update cron job stopped');
    }
    if (this.channelMetadataSyncJob) {
      this.channelMetadataSyncJob.stop();
      console.log('Channel metadata sync cron job stopped');
    }
    if (this.channelOwnershipReconcileJob) {
      this.channelOwnershipReconcileJob.stop();
      console.log('Channel ownership reconcile cron job stopped');
    }
    if (this.descriptionRequestCleanupJob) {
      this.descriptionRequestCleanupJob.stop();
      console.log('Description request cleanup cron job stopped');
    }
    if (this.cooldownPrizesRetryJob) {
      this.cooldownPrizesRetryJob.stop();
      console.log('Gift delivery recovery cron job stopped');
    }
    if (this.telegramGiftImageSyncJob) {
      this.telegramGiftImageSyncJob.stop();
      console.log('Telegram gift image sync cron job stopped');
    }
    if (this.fragmentExchangeRateJob) {
      this.fragmentExchangeRateJob.stop();
      console.log('Fragment exchange rate sync cron job stopped');
    }
  }

  /**
   * Get cron job status
   */
  getStatus() {
    return {
      holdProcessingJob: {
        running: this.holdProcessingJob
          ? cron.getTasks().has(this.holdProcessingJob as any)
          : false,
      },
      giveawayCapacityCheckJob: {
        running: this.giveawayCapacityCheckJob
          ? cron.getTasks().has(this.giveawayCapacityCheckJob as any)
          : false,
      },
      giveawayTimeCheckJob: {
        running: this.giveawayTimeCheckJob
          ? cron.getTasks().has(this.giveawayTimeCheckJob as any)
          : false,
      },
      giveawayButtonsUpdateJob: {
        running: this.giveawayButtonsUpdateJob
          ? cron.getTasks().has(this.giveawayButtonsUpdateJob as any)
          : false,
      },
      giveawayActivationCheckJob: {
        running: this.giveawayActivationCheckJob
          ? cron.getTasks().has(this.giveawayActivationCheckJob as any)
          : false,
      },
      channelInviteLinkUpdateJob: {
        running: this.channelInviteLinkUpdateJob
          ? cron.getTasks().has(this.channelInviteLinkUpdateJob as any)
          : false,
      },
      fragmentExchangeRateJob: {
        running: this.fragmentExchangeRateJob
          ? cron.getTasks().has(this.fragmentExchangeRateJob as any)
          : false,
      },
    };
  }

  /**
   * Manually trigger hold processing (for testing or admin purposes)
   */
  async triggerHoldProcessing() {
    console.log('Manually triggering hold processing...');
    await this.processExpiredHolds();
  }

  /**
   * Manually trigger giveaway capacity check (for testing or admin purposes)
   */
  async triggerCapacityCheck() {
    console.log('Manually triggering capacity check...');
    await this.checkGiveawaysByCapacity();
  }

  /**
   * Manually trigger giveaway time check (for testing or admin purposes)
   */
  async triggerTimeCheck() {
    console.log('Manually triggering time check...');
    await this.checkGiveawaysByTime();
  }

  /**
   * Manually trigger buttons update (for testing or admin purposes)
   */
  async triggerButtonsUpdate() {
    console.log('Manually triggering buttons update...');
    await this.updateActiveGiveawayButtons();
  }

  /**
   * Manually trigger activation check (for testing or admin purposes)
   */
  async triggerActivationCheck() {
    console.log('Manually triggering activation check...');
    await this.checkGiveawaysToActivate();
  }

  /**
   * Manually trigger channel invite link update (for testing or admin purposes)
   */
  async triggerChannelInviteLinkUpdate() {
    console.log('Manually triggering channel invite link update...');
    await this.updateMissingChannelInviteLinks();
  }

  /**
   * Manually trigger Fragment → ExchangeRate sync (for testing or admin purposes)
   */
  async triggerFragmentExchangeRateSync() {
    console.log('Manually triggering Fragment exchange rate sync...');
    await this.syncFragmentExchangeRate();
  }
}

export const cronService = new CronService();
