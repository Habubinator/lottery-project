export const randomString = (length: number) =>
  Array.from(Array(length), () =>
    Math.floor(Math.random() * 36).toString(36),
  ).join('');

const GIVEAWAY_UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

/** Mini-app / DM deep links — must not be handled as channel connect in groups. */
const NON_CHANNEL_START_RE =
  /^(giveawayId|ownerId|gifts|resultsId|sharedId|startapp|postlot|ref)/i;

/** Matches frontend `GiveawayPageRef` for Telegram Mini App `startapp` links. */
export type GiveawayWebappPageRef = 'user' | 'owner' | 'shared' | 'results';

const STARTAPP_PAGE_PREFIX: Record<GiveawayWebappPageRef, string> = {
  user: 'giveawayId',
  owner: 'ownerId',
  shared: 'sharedId',
  results: 'resultsId',
};

export function buildGiveawayStartappUrl(
  webappBaseUrl: string,
  pageRef: GiveawayWebappPageRef,
  giveawayId: string,
): string {
  const base = webappBaseUrl.replace(/\/$/, '');
  return `${base}?startapp=${STARTAPP_PAGE_PREFIX[pageRef]}_${giveawayId}`;
}

export type GiveawayManagePageRef = Exclude<
  GiveawayWebappPageRef,
  'user' | 'results'
>;

/** Creator → owner manage screen; co-owner / sponsor channel owner → shared. */
export function resolveGiveawayManagePageRef(
  recipientUserId: number,
  giveawayCreatedById: number,
): GiveawayManagePageRef {
  return recipientUserId === giveawayCreatedById ? 'owner' : 'shared';
}

export function buildManageGiveawayStartappUrl(
  webappBaseUrl: string | undefined,
  giveawayId: string,
  recipientUserId: number,
  giveawayCreatedById: number,
): string {
  return buildGiveawayStartappUrl(
    webappBaseUrl ?? '',
    resolveGiveawayManagePageRef(recipientUserId, giveawayCreatedById),
    giveawayId,
  );
}

const CHANNEL_CONNECT_TYPE_ALIASES: Record<string, 'sponsor' | 'linked'> = {
  sponsor: 'sponsor',
  sponsors: 'sponsor',
  linked: 'linked',
  linkedchannel: 'linked',
  linkedchannels: 'linked',
};

export type ChannelConnectStartParams = {
  connectionType: 'sponsor' | 'linked';
  giveawayId: string;
};

/**
 * Parse /start payload from add-to-group links: sponsor-{uuid} | linked-{uuid}.
 * Returns null for mini-app params (giveawayId_{uuid}, etc.) or unknown shapes.
 */
export function parseChannelConnectStartParam(
  paramString: string,
): ChannelConnectStartParams | null {
  if (!paramString?.trim()) return null;

  const clean = paramString.replace(/"/g, '').trim();
  if (NON_CHANNEL_START_RE.test(clean)) return null;

  const uuidMatch = clean.match(GIVEAWAY_UUID_RE);
  if (!uuidMatch?.[0]) return null;

  const giveawayId = uuidMatch[0];
  const rawPrefix = clean
    .slice(0, uuidMatch.index ?? 0)
    .replace(/[-_]+$/g, '')
    .toLowerCase();

  const connectionType = CHANNEL_CONNECT_TYPE_ALIASES[rawPrefix];
  if (!connectionType) return null;

  return { connectionType, giveawayId };
}

/**
 * Parse mini-app /start payloads: giveawayId_{uuid}, ownerId_{uuid}, sharedId_{uuid}, resultsId_{uuid}.
 */
export function parseGiveawayDeepLinkStartParam(
  paramString: string,
): { giveawayId: string } | null {
  if (!paramString?.trim()) return null;

  const clean = paramString.replace(/"/g, '').trim();
  const prefixMatch = clean.match(
    /^(giveawayId|ownerId|sharedId|resultsId)_(.+)$/i,
  );
  if (!prefixMatch) return null;

  const uuidMatch = prefixMatch[2].match(GIVEAWAY_UUID_RE);
  return uuidMatch ? { giveawayId: uuidMatch[0] } : null;
}

/** @deprecated Prefer parseChannelConnectStartParam for group channel connect */
export function parseStartParams(
  paramString: string,
): { type: string; uuid: string } | null {
  const connect = parseChannelConnectStartParam(paramString);
  if (connect) {
    return { type: connect.connectionType, uuid: connect.giveawayId };
  }

  if (!paramString) return null;

  const cleanParam = paramString.replace(/"/g, '');

  const firstDashIndex = cleanParam.indexOf('-');

  if (firstDashIndex === -1) return null;

  const type = cleanParam.substring(0, firstDashIndex);
  const uuid = cleanParam.substring(firstDashIndex + 1);

  return { type: type.trim(), uuid: uuid.trim() };
}
