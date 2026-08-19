/**
 * Script to update missing invite links for all active private channels
 *
 * Usage:
 *   npx tsx src/scripts/update-channel-invite-links.ts
 *
 * Or use the cron service:
 *   cronService.triggerChannelInviteLinkUpdate()
 */

import { prisma } from '@database';
import { generateInviteLink } from '@bot/service';

async function updateChannelInviteLinks() {
  try {
    console.log('Starting channel invite links update script...\n');

    // Find active channels without username (private) and without invite link
    const channelsNeedingLinks = await prisma.channel.findMany({
      where: {
        isActive: true,
        username: null,
        inviteLink: null,
      },
      select: {
        id: true,
        title: true,
      },
    });

    if (channelsNeedingLinks.length === 0) {
      console.log('✓ No channels need invite link updates. All channels are up to date!');
      return;
    }

    console.log(`Found ${channelsNeedingLinks.length} channel(s) needing invite links:\n`);

    let successCount = 0;
    let failedCount = 0;
    const failedChannels: Array<{ id: bigint; title: string | null; reason: string }> = [];

    // Update each channel
    for (const channel of channelsNeedingLinks) {
      try {
        console.log(`[${successCount + failedCount + 1}/${channelsNeedingLinks.length}] Processing: ${channel.title || 'Unnamed'} (ID: ${channel.id})`);

        const inviteLink = await generateInviteLink(channel.id);

        if (inviteLink) {
          await prisma.channel.update({
            where: { id: channel.id },
            data: { inviteLink },
          });

          console.log(`  ✓ Success: ${inviteLink}\n`);
          successCount++;
        } else {
          console.log(`  ✗ Failed to generate invite link\n`);
          failedCount++;
          failedChannels.push({
            id: channel.id,
            title: channel.title,
            reason: 'Failed to generate invite link (check bot permissions)',
          });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.log(`  ✗ Error: ${errorMessage}\n`);
        failedCount++;
        failedChannels.push({
          id: channel.id,
          title: channel.title,
          reason: errorMessage,
        });
      }
    }

    // Print summary
    console.log('═'.repeat(60));
    console.log('SUMMARY');
    console.log('═'.repeat(60));
    console.log(`Total channels processed: ${channelsNeedingLinks.length}`);
    console.log(`✓ Successfully updated: ${successCount}`);
    console.log(`✗ Failed: ${failedCount}`);
    console.log('═'.repeat(60));

    // Print failed channels details if any
    if (failedChannels.length > 0) {
      console.log('\nFailed channels details:');
      console.log('='.repeat(60));
      failedChannels.forEach((channel, index) => {
        console.log(`${index + 1}. ${channel.title || 'Unnamed'} (ID: ${channel.id})`);
        console.log(`   Reason: ${channel.reason}`);
      });
      console.log('='.repeat(60));
      console.log('\nTo fix permission errors:');
      console.log('1. Go to the channel settings');
      console.log('2. Edit bot administrator permissions');
      console.log('3. Enable "Invite users via link" (can_invite_users)');
      console.log('4. Run this script again');
    }

    console.log('\nScript completed!');
  } catch (error) {
    console.error('Fatal error in update script:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
updateChannelInviteLinks()
  .then(() => {
    console.log('\n✓ Script execution finished successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n✗ Script execution failed:', error);
    process.exit(1);
  });
