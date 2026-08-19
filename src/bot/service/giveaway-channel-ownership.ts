/** Roles used when resolving per-channel results / ownership settings. */
export type LinkedChannelRole = 'All' | 'Posting' | 'Subscription';

export type LinkedChannelForOwnership = {
  channelId: bigint;
  role: string;
  isPostingResults: boolean;
  isResultsInMainPost: boolean | null;
  isCommentsOn: boolean | null;
  channel: {
    addedBy: Array<{ userId: number }>;
  };
};

/** True only when giveaway creator is in channel.addedBy. */
export function isGiveawayCreatorOwnedChannel(
  createdById: number | null | undefined,
  channelAddedBy: Array<{ userId: number }>,
): boolean {
  if (!createdById) return false;
  return channelAddedBy.some((entry) => entry.userId === createdById);
}

export function findLinkedChannelForMessage(
  linkedChannels: LinkedChannelForOwnership[],
  channelId: bigint,
): LinkedChannelForOwnership | undefined {
  return linkedChannels.find((lc) => lc.channelId === channelId);
}
