import { Api } from 'telegram';
import type { TelegramClient } from 'telegram';
import type { AccountType } from './clients';
import { getClient } from './clients';

export type ResolveRecipientPeerOptions = {
  recipientTelegramId: string;
  recipientUsername?: string | null;
};

export class RecipientPeerNotFoundError extends Error {
  constructor(
    public readonly recipientTelegramId: string,
    message?: string,
  ) {
    super(message ?? `Recipient peer not found: ${recipientTelegramId}`);
    this.name = 'RecipientPeerNotFoundError';
  }
}

/** Max dialogs to scan; unset = all dialogs (GramJS limit: undefined). */
function getDialogScanLimit(): number | undefined {
  const raw = process.env.USERBOT_DIALOG_SCAN_MAX?.trim();
  if (!raw) return undefined;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

async function findPeerInDialogs(
  client: TelegramClient,
  recipientId: string,
): Promise<Api.TypeInputPeer | null> {
  const limit = getDialogScanLimit();
  let scanned = 0;

  for await (const dialog of client.iterDialogs({
    limit,
    ignorePinned: false,
  })) {
    scanned++;
    if (!dialog.isUser || !dialog.entity) continue;

    const dialogUserId = dialog.entity.id?.toString();
    if (dialogUserId !== recipientId) continue;

    console.log(
      `[Userbot] resolveRecipientPeer found in dialogs recipient=${recipientId} scanned=${scanned} limit=${limit ?? 'all'}`,
    );
    return client.getInputEntity(dialog.entity);
  }

  console.log(
    `[Userbot] resolveRecipientPeer not in dialogs recipient=${recipientId} scanned=${scanned} limit=${limit ?? 'all'}`,
  );
  return null;
}

/**
 * Resolve InputPeer for gift delivery.
 * The recipient must already appear in the userbot dialog list (they messaged first).
 * We do not resolve by raw user id / @username session cache — that can open unsolicited
 * chats and expose the userbot to spam reports.
 */
export async function resolveRecipientPeer(
  accountType: AccountType,
  options: ResolveRecipientPeerOptions,
): Promise<Api.TypeInputPeer> {
  const client = getClient(accountType);
  const recipientId = options.recipientTelegramId.trim();

  const fromDialogs = await findPeerInDialogs(client, recipientId);
  if (fromDialogs) {
    return fromDialogs;
  }

  throw new RecipientPeerNotFoundError(
    recipientId,
    `Recipient ${recipientId} not in userbot dialogs — user must message the userbot first`,
  );
}
