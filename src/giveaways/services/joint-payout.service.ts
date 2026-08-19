import {
  prisma,
  Currencies,
  TransactionStatus,
  TransactionType,
  LinkRequestStatus,
  SponsorApprovalStatus,
} from '@database';
import type { PrismaClient } from '@prisma/client';
import moment from 'moment';
import {
  editLinkRequestMessage,
  LINK_REQUEST_MESSAGES,
  normalizeGiveawayLanguage,
  refundTelegramStarPayment,
} from '@bot/service';

type PrismaTransaction = Parameters<
  Parameters<PrismaClient['$transaction']>[0]
>[0];

export type LinkRequestRefundContext = {
  giveawayId: string;
  starsAmount: number | null;
  paidFromBalance: boolean;
  requesterId: number;
  requester: {
    wallet: { id: number; starsBalance: number } | null;
    telegramId: string | null;
  };
};

export function jointHoldTransactionId(linkRequestId: number): string {
  return `joint_${linkRequestId}`;
}

export async function refundLinkRequestWalletInTx(
  tx: PrismaTransaction,
  linkRequest: LinkRequestRefundContext,
) {
  if (linkRequest.paidFromBalance !== true) return;

  const starsAmount = linkRequest.starsAmount ?? 0;
  if (starsAmount <= 0) return;

  // Upsert so missing wallet rows (rare) still get the refund instead of a silent skip.
  const wallet = await tx.wallet.upsert({
    where: { userId: linkRequest.requesterId },
    create: {
      userId: linkRequest.requesterId,
      starsBalance: 0,
      holdedStarsBalance: 0,
      tonBalance: 0,
    },
    update: {},
  });

  const balanceBefore = wallet.starsBalance;
  const updated = await tx.wallet.update({
    where: { userId: linkRequest.requesterId },
    data: { starsBalance: { increment: starsAmount } },
  });
  await tx.transactionHistory.create({
    data: {
      userId: linkRequest.requesterId,
      walletId: wallet.id,
      type: TransactionType.Incoming,
      status: TransactionStatus.Completed,
      currency: Currencies.Stars,
      value: starsAmount,
      balanceBefore,
      balanceAfter: updated.starsBalance,
      additionalInfo: `Giveaway joint ${linkRequest.giveawayId}`,
    },
  });
}

export async function refundLinkRequestViaTelegram(
  linkRequest: LinkRequestRefundContext,
) {
  if (linkRequest.paidFromBalance !== false) return;

  const starsAmount = linkRequest.starsAmount ?? 0;
  if (starsAmount <= 0) return;

  const paymentTx = await prisma.transactionHistory.findFirst({
    where: {
      userId: linkRequest.requesterId,
      telegramPaymentId: { not: null },
      additionalInfo: { contains: `Giveaway joint ${linkRequest.giveawayId}` },
      status: TransactionStatus.Completed,
      type: TransactionType.Outcoming,
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!paymentTx?.telegramPaymentId || !linkRequest.requester.telegramId) {
    console.error(
      `refundLinkRequestViaTelegram: missing charge id or telegram id for joint ${linkRequest.giveawayId}`,
    );
    return;
  }

  await refundTelegramStarPayment(
    Number(linkRequest.requester.telegramId),
    paymentTx.telegramPaymentId,
    linkRequest.requesterId,
  );
}

/**
 * Reverse creator credit for a paid-out Accepted joint.
 * Pending hold → decrement holdedStars; released hold → decrement starsBalance.
 */
export async function clawbackJointCreatorCreditInTx(
  tx: PrismaTransaction,
  linkRequest: {
    id: number;
    giveawayId: string;
    starsAmount: number | null;
    paidOutAt: Date | null;
  },
  creatorUserId: number,
) {
  if (!linkRequest.paidOutAt) return;

  const amount = linkRequest.starsAmount ?? 0;
  if (amount <= 0) return;

  const transactionId = jointHoldTransactionId(linkRequest.id);
  const hold = await tx.holdingStars.findFirst({
    where: { transactionId, userId: creatorUserId },
    orderBy: { id: 'desc' },
  });

  const wallet = await tx.wallet.upsert({
    where: { userId: creatorUserId },
    create: {
      userId: creatorUserId,
      starsBalance: 0,
      holdedStarsBalance: 0,
      tonBalance: 0,
    },
    update: {},
  });

  if (hold && hold.status === TransactionStatus.Pending) {
    const available = wallet.holdedStarsBalance;
    const claw = Math.min(amount, available);
    if (claw < amount) {
      console.warn(
        `clawbackJointCreatorCredit: hold shortfall joint_${linkRequest.id} need=${amount} have=${available}`,
      );
    }
    if (claw > 0) {
      const balanceBefore = wallet.holdedStarsBalance;
      const updated = await tx.wallet.update({
        where: { userId: creatorUserId },
        data: { holdedStarsBalance: { decrement: claw } },
      });
      await tx.transactionHistory.create({
        data: {
          walletId: wallet.id,
          userId: creatorUserId,
          type: TransactionType.Outcoming,
          status: TransactionStatus.Completed,
          currency: Currencies.Stars,
          value: claw,
          balanceBefore,
          balanceAfter: updated.holdedStarsBalance,
          additionalInfo: `Joint clawback hold | ${transactionId}`,
        },
      });
    }
    await tx.holdingStars.update({
      where: { id: hold.id },
      data: { status: TransactionStatus.Failed },
    });
    const pendingTx = await tx.transactionHistory.findFirst({
      where: {
        userId: creatorUserId,
        additionalInfo: { contains: transactionId },
        status: TransactionStatus.Pending,
        type: TransactionType.Incoming,
      },
    });
    if (pendingTx) {
      await tx.transactionHistory.update({
        where: { id: pendingTx.id },
        data: { status: TransactionStatus.Failed },
      });
    }
    return;
  }

  // Hold already released (or missing) — claw from spendable starsBalance
  const available = wallet.starsBalance;
  const claw = Math.min(amount, available);
  if (claw < amount) {
    console.warn(
      `clawbackJointCreatorCredit: balance shortfall joint_${linkRequest.id} need=${amount} have=${available}`,
    );
  }
  if (claw > 0) {
    const balanceBefore = wallet.starsBalance;
    const updated = await tx.wallet.update({
      where: { userId: creatorUserId },
      data: { starsBalance: { decrement: claw } },
    });
    await tx.transactionHistory.create({
      data: {
        walletId: wallet.id,
        userId: creatorUserId,
        type: TransactionType.Outcoming,
        status: TransactionStatus.Completed,
        currency: Currencies.Stars,
        value: claw,
        balanceBefore,
        balanceAfter: updated.starsBalance,
        additionalInfo: `Joint clawback balance | ${transactionId}`,
      },
    });
  }

  if (hold && hold.status === TransactionStatus.Completed) {
    await tx.holdingStars.update({
      where: { id: hold.id },
      data: { status: TransactionStatus.Failed },
    });
  }
}

async function creditCreatorForJointInTx(
  tx: PrismaTransaction,
  linkRequest: { id: number; giveawayId: string; starsAmount: number | null },
  creatorUserId: number,
) {
  const amount = linkRequest.starsAmount ?? 0;
  if (amount <= 0) return;

  const transactionId = jointHoldTransactionId(linkRequest.id);

  // Atomic claim: only one concurrent tx can set paidOutAt. Losers exit without
  // creating a second hold / double-credit (findFirst+create is not safe alone).
  const claimed = await tx.linkRequest.updateMany({
    where: {
      id: linkRequest.id,
      status: LinkRequestStatus.Accepted,
      paidOutAt: null,
      starsAmount: { gt: 0 },
    },
    data: { paidOutAt: new Date() },
  });
  if (claimed.count !== 1) return;

  const wallet = await tx.wallet.upsert({
    where: { userId: creatorUserId },
    create: {
      userId: creatorUserId,
      starsBalance: 0,
      holdedStarsBalance: 0,
      tonBalance: 0,
    },
    update: {},
  });

  const balanceBefore = wallet.holdedStarsBalance;
  const updatedWallet = await tx.wallet.update({
    where: { userId: creatorUserId },
    data: { holdedStarsBalance: { increment: amount } },
  });

  const validWhen = moment().add(21, 'days').toDate();

  await tx.holdingStars.create({
    data: {
      transactionId,
      userId: creatorUserId,
      giveawayId: linkRequest.giveawayId,
      validWhen,
      ammount: amount,
      status: TransactionStatus.Pending,
    },
  });

  await tx.transactionHistory.create({
    data: {
      walletId: wallet.id,
      userId: creatorUserId,
      type: TransactionType.Incoming,
      status: TransactionStatus.Pending,
      currency: Currencies.Stars,
      value: amount,
      balanceBefore,
      balanceAfter: updatedWallet.holdedStarsBalance,
      additionalInfo: `Joint earnings | ${transactionId}`,
    },
  });
}

/** Credit creator hold for Accepted joints not yet paid out. Idempotent. */
export async function distributeJointFunds(giveawayId: string): Promise<void> {
  const giveaway = await prisma.giveaway.findUnique({
    where: { id: giveawayId },
    select: { id: true, createdById: true },
  });
  if (!giveaway?.createdById) {
    console.log(
      `distributeJointFunds: giveaway ${giveawayId} missing creator, skip`,
    );
    return;
  }

  const accepted = await prisma.linkRequest.findMany({
    where: {
      giveawayId,
      status: LinkRequestStatus.Accepted,
      paidOutAt: null,
      starsAmount: { gt: 0 },
    },
  });

  for (const req of accepted) {
    try {
      await prisma.$transaction(async (tx) => {
        const current = await tx.linkRequest.findUnique({
          where: { id: req.id },
        });
        if (
          !current ||
          current.status !== LinkRequestStatus.Accepted ||
          current.paidOutAt != null ||
          (current.starsAmount ?? 0) <= 0
        ) {
          return;
        }
        await creditCreatorForJointInTx(tx, current, giveaway.createdById!);
      });
      console.log(
        `distributeJointFunds: credited joint_${req.id} for giveaway ${giveawayId}`,
      );
    } catch (err) {
      console.error(
        `distributeJointFunds: failed for linkRequest ${req.id}:`,
        err,
      );
    }
  }
}

type JointForRefund = {
  id: number;
  giveawayId: string;
  channelId: bigint;
  requesterId: number;
  status: LinkRequestStatus;
  starsAmount: number | null;
  paidFromBalance: boolean;
  paidOutAt: Date | null;
  creatorMessageId: bigint | null;
  senderMessageId: bigint | null;
  requester: {
    telegramId: string | null;
    first_name: string;
    last_name: string | null;
    wallet: { id: number; starsBalance: number } | null;
  };
  channel: { title: string | null; username: string | null };
};

function toRefundContext(req: JointForRefund): LinkRequestRefundContext {
  return {
    giveawayId: req.giveawayId,
    starsAmount: req.starsAmount,
    paidFromBalance: req.paidFromBalance,
    requesterId: req.requesterId,
    requester: req.requester,
  };
}

/**
 * Clawback (if paid out) + refund buyer + set terminal status.
 * Pending → AutoDeclined; Accepted → Refunded.
 * Returns context if Telegram Stars refund still needed (outside tx).
 */
export async function refundOpenJointInTx(
  tx: PrismaTransaction,
  req: JointForRefund,
  creatorUserId: number,
  pendingTerminalStatus:
    | typeof LinkRequestStatus.AutoDeclined
    | typeof LinkRequestStatus.Declined = LinkRequestStatus.AutoDeclined,
): Promise<LinkRequestRefundContext | null> {
  if (
    req.status !== LinkRequestStatus.Pending &&
    req.status !== LinkRequestStatus.Accepted
  ) {
    return null;
  }

  if (req.status === LinkRequestStatus.Accepted && req.paidOutAt) {
    await clawbackJointCreatorCreditInTx(tx, req, creatorUserId);
  }

  const nextStatus =
    req.status === LinkRequestStatus.Accepted
      ? LinkRequestStatus.Refunded
      : pendingTerminalStatus;

  await tx.linkRequest.update({
    where: { id: req.id },
    data: {
      status: nextStatus,
      ...(req.status === LinkRequestStatus.Accepted
        ? { paidOutAt: req.paidOutAt } // keep audit trail of prior payout
        : {}),
    },
  });

  await refundLinkRequestWalletInTx(tx, toRefundContext(req));

  if (req.status === LinkRequestStatus.Accepted) {
    await tx.sponsorApproval.updateMany({
      where: {
        giveawayId: req.giveawayId,
        channelId: req.channelId,
        status: {
          in: [SponsorApprovalStatus.Pending, SponsorApprovalStatus.Approved],
        },
      },
      data: { status: SponsorApprovalStatus.Rejected },
    });
  }

  if (!req.paidFromBalance && (req.starsAmount ?? 0) > 0) {
    return toRefundContext(req);
  }
  return null;
}

const jointInclude = {
  requester: {
    select: {
      telegramId: true,
      first_name: true,
      last_name: true,
      wallet: true,
    },
  },
  channel: { select: { title: true, username: true } },
} as const;

/** Refund all Pending + Accepted joints on cancel. Telegram refunds returned for post-commit. */
export async function refundJointsOnCancelInTx(
  tx: PrismaTransaction,
  giveawayId: string,
  creatorUserId: number,
): Promise<LinkRequestRefundContext[]> {
  const open = await tx.linkRequest.findMany({
    where: {
      giveawayId,
      status: {
        in: [LinkRequestStatus.Pending, LinkRequestStatus.Accepted],
      },
    },
    include: jointInclude,
  });

  const telegramRefunds: LinkRequestRefundContext[] = [];
  for (const req of open) {
    try {
      const tg = await refundOpenJointInTx(
        tx,
        req,
        creatorUserId,
        LinkRequestStatus.AutoDeclined,
      );
      if (tg) telegramRefunds.push(tg);
    } catch (err) {
      console.error(
        `refundJointsOnCancelInTx: failed linkRequest ${req.id}:`,
        err,
      );
    }
  }
  return telegramRefunds;
}

/** Refund Accepted joint when its channel is removed from the giveaway. */
export async function refundAcceptedJointForChannelInTx(
  tx: PrismaTransaction,
  giveawayId: string,
  channelId: bigint,
  creatorUserId: number,
): Promise<LinkRequestRefundContext | null> {
  const req = await tx.linkRequest.findUnique({
    where: { giveawayId_channelId: { giveawayId, channelId } },
    include: jointInclude,
  });
  if (!req || req.status !== LinkRequestStatus.Accepted) return null;
  return refundOpenJointInTx(tx, req, creatorUserId);
}

async function autoDeclinePendingJoints(
  giveawayId: string,
  options?: { editMessages?: boolean },
): Promise<void> {
  const editMessages = options?.editMessages !== false;

  const giveaway = await prisma.giveaway.findUnique({
    where: { id: giveawayId },
    select: {
      id: true,
      language: true,
      createdById: true,
      createdBy: { select: { telegramId: true } },
    },
  });
  if (!giveaway) return;

  const pendingRequests = await prisma.linkRequest.findMany({
    where: { giveawayId, status: LinkRequestStatus.Pending },
    include: jointInclude,
  });

  const creatorTelegramId = giveaway.createdBy?.telegramId ?? null;
  const lang = normalizeGiveawayLanguage(giveaway.language ?? 'en');
  const msgs = LINK_REQUEST_MESSAGES[lang];

  for (const req of pendingRequests) {
    try {
      if (!giveaway.createdById) {
        console.error(
          `autoDeclinePendingJoints: giveaway ${giveawayId} has no creator, skip linkRequest ${req.id}`,
        );
        continue;
      }

      // Assign refund context from the committed tx result only — never from
      // a side-effect during the callback (rollback/retry would leak TG refunds).
      const telegramRefund = await prisma.$transaction(async (tx) => {
        const current = await tx.linkRequest.findUnique({
          where: { id: req.id },
          include: jointInclude,
        });
        if (!current || current.status !== LinkRequestStatus.Pending) {
          return null;
        }
        return refundOpenJointInTx(
          tx,
          current,
          giveaway.createdById!,
          LinkRequestStatus.AutoDeclined,
        );
      });

      if (telegramRefund) {
        await refundLinkRequestViaTelegram(telegramRefund);
      }

      if (!editMessages) continue;

      const channelTitle = req.channel.title ?? '';
      const channelUsername = req.channel.username ?? null;

      if (req.creatorMessageId && creatorTelegramId) {
        const originalCreatorText = msgs.creatorRequest(
          req.requester.first_name,
          req.requester.last_name ?? null,
          channelTitle,
        );
        const remainingButtons: Array<
          Array<{ text: string; url?: string }>
        > = [];
        if (channelUsername) {
          remainingButtons.push([
            { text: channelTitle, url: `https://t.me/${channelUsername}` },
          ]);
        }
        remainingButtons.push([
          {
            text: msgs.creatorContactBtn,
            url: `tg://user?id=${req.requester.telegramId}`,
          },
        ]);
        await editLinkRequestMessage(
          creatorTelegramId,
          req.creatorMessageId,
          originalCreatorText,
          msgs.creatorAutoDeclinedStatus,
          remainingButtons,
        );
      }

      if (req.senderMessageId && req.requester.telegramId) {
        const senderText = msgs.senderAutoDeclined(
          req.requester.first_name,
          req.requester.last_name ?? null,
        );
        const senderButtons: Array<Array<{ text: string; url?: string }>> = [];
        if (channelUsername) {
          senderButtons.push([
            { text: channelTitle, url: `https://t.me/${channelUsername}` },
          ]);
        }
        if (creatorTelegramId) {
          senderButtons.push([
            {
              text: msgs.senderContactBtn,
              url: `tg://user?id=${creatorTelegramId}`,
            },
          ]);
        }
        await editLinkRequestMessage(
          req.requester.telegramId,
          req.senderMessageId,
          senderText,
          msgs.senderAutoDeclinedRefund,
          senderButtons,
        );
      }
    } catch (reqErr) {
      console.error(
        `autoDeclinePendingJoints: error for link request ${req.id}:`,
        reqErr,
      );
    }
  }
}

/**
 * On giveaway start: auto-decline Pending (refund buyers) then credit Accepted to creator hold.
 */
export async function finalizeJointsOnGiveawayStart(
  giveawayId: string,
  options?: { editMessages?: boolean },
): Promise<void> {
  try {
    await autoDeclinePendingJoints(giveawayId, options);
    await distributeJointFunds(giveawayId);
  } catch (err) {
    console.error(
      `finalizeJointsOnGiveawayStart failed for ${giveawayId}:`,
      err,
    );
  }
}

export async function applyTelegramJointRefunds(
  refunds: LinkRequestRefundContext[],
): Promise<void> {
  for (const r of refunds) {
    try {
      await refundLinkRequestViaTelegram(r);
    } catch (err) {
      console.error(
        `applyTelegramJointRefunds failed for giveaway ${r.giveawayId} user ${r.requesterId}:`,
        err,
      );
    }
  }
}
