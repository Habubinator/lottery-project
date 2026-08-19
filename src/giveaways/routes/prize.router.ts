import { Router } from 'express';
import { auth } from '@auth/middlewares';
import { prizeController } from '../controllers/prize.controller';

export const prizeRouter = Router({ mergeParams: true });

// Standalone prize routes (/api/prizes)
export const prizesStandaloneRouter = Router();

/**
 * @swagger
 * /api/prizes/available:
 *   get:
 *     summary: Get available gifts ready to link to a giveaway
 *     description: |
 *       Returns prize records owned by the current user that can be linked to a giveaway:
 *       status **Available** or **Cooldown**, not already linked (`giveawayId = null`).
 *       Excludes **Processing** (in-flight claim) — those appear on `GET /api/prizes/my`.
 *       Cooldown rows include `nextTransferDate` for frontend timers; they can still be linked and used in giveaways.
 *       Includes both:
 *       - NFT (UniqueGift) gifts deposited to the business account — `commissionPaid=false` until paid via POST /api/prizes/pay
 *       - StandardGift records created by POST /api/prizes/pay — always `commissionPaid=true`
 *
 *       Check the `commissionPaid` field to distinguish paid (ready to link) from unpaid (need to call POST /api/prizes/pay first).
 *     tags:
 *       - Prizes
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       "200":
 *         description: List of available gift prizes
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/GiveawayPrizeDto'
 *       "401":
 *         description: Unauthorized
 *       "500":
 *         description: Internal server error
 */
prizesStandaloneRouter.get('/available', auth, prizeController.getAvailable.bind(prizeController));

/**
 * @swagger
 * /api/prizes/my:
 *   get:
 *     summary: Get all prizes belonging to the current user
 *     description: |
 *       Returns all gift prizes visible on the current user's gifts page:
 *       - **Available** or **Processing** prizes where `depositedByUserId = me` — ready to send or gift delivery in progress (`POST /prizes/claim`)
 *       - **ReadyToClaim** or **Cooldown** prizes where `winnerUserId = me` — won prizes awaiting acceptance via `POST /prizes/accept`
 *
 *       **Linked** prizes (currently assigned to an active giveaway) are not returned.
 *       `claimDeadline` is returned **only** when `status` is `ReadyToClaim` (24h to accept a won prize); it is `null` for `Available` withdraw UI.
 *       Frontend should distinguish by `status`: `ReadyToClaim` → Accept; `Available` → Send to Telegram; `Processing` → delivery queued (poll until `Transferred`).
 *     tags:
 *       - Prizes
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       "200":
 *         description: List of user's prizes
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/GiveawayPrizeDto'
 *       "401":
 *         description: Unauthorized
 *       "500":
 *         description: Internal server error
 */
prizesStandaloneRouter.get('/my', auth, prizeController.getMy.bind(prizeController));

/**
 * @swagger
 * /api/prizes/claim-prerequisites:
 *   get:
 *     summary: Pre-claim checks before POST /prizes/claim
 *     description: |
 *       Call **before** `POST /prizes/claim` when `GIFT_PROVIDER=userbot`.
 *       For each owned `Available` prize returns whether the user must message the userbot first (`needsChat`),
 *       the correct Telegram @username (`contactUsername`), and for StandardGift whether the catalog gift is still
 *       available or a same-cost `substituteGiftId` can be sent instead.
 *
 *       When `canEnqueue` is `false`, do not call claim. If `needsChat` is true, user must open chat with `contactUsername`.
 *       If `recipientCheckUnavailable` is true, retry this endpoint (queue busy/timeout) — do not treat as needsChat.
 *     tags:
 *       - Prizes
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: prizeIds
 *         required: true
 *         schema:
 *           type: array
 *           items:
 *             type: integer
 *         style: form
 *         explode: true
 *         description: Prize IDs to check (must be Available and owned by caller)
 *     responses:
 *       "200":
 *         description: Per-prize prerequisite flags
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       prizeId:
 *                         type: integer
 *                       prizeType:
 *                         type: string
 *                         enum: [StandardGift, UniqueGift]
 *                       accountType:
 *                         type: string
 *                         enum: [Standard, Unique]
 *                       contactUsername:
 *                         type: string
 *                         nullable: true
 *                         description: Userbot/business @username without @ (Standard vs Unique per prize)
 *                       contactUrl:
 *                         type: string
 *                         nullable: true
 *                         example: "https://t.me/example_bot"
 *                         description: Ready-to-open t.me link for the open-chat button
 *                       needsChat:
 *                         type: boolean
 *                         description: Telegram requires user to message userbot first
 *                       recipientCheckUnavailable:
 *                         type: boolean
 *                         description: Reachability check did not complete — retry prerequisites; not the same as needsChat
 *                       catalogAvailable:
 *                         type: boolean
 *                         description: StandardGift only — gift id still in Telegram catalog with stock
 *                       giftUnavailable:
 *                         type: boolean
 *                         description: StandardGift sold out or missing from catalog
 *                       substituteGiftId:
 *                         type: string
 *                         description: Alternative catalog gift id with same star cost
 *                       substituteGiftName:
 *                         type: string
 *                         nullable: true
 *                       canEnqueue:
 *                         type: boolean
 *                         description: Safe to call POST /claim when true
 *       "400":
 *         description: Invalid prize or not Available
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Prize not owned by caller
 */
prizesStandaloneRouter.get(
  '/claim-prerequisites',
  auth,
  prizeController.getClaimPrerequisites.bind(prizeController),
);

/**
 * @swagger
 * /api/prizes/claim-commission:
 *   get:
 *     summary: Get total claim commission for a set of prizes
 *     description: |
 *       Calculates transfer commission for the given prize IDs.
 *       Prizes where `commissionPaid=true` are excluded.
 *
 *       Returned values include:
 *       - `starsTotal`: informational base total in Stars
 *       - `tonTotal`: payable total in TON (computed live from exchange rate and admin payment settings)
 *
 *       For NFT withdrawal, payment is TON-only in actual claim flow.
 *     tags:
 *       - Prizes
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: prizeIds
 *         required: true
 *         schema:
 *           type: array
 *           items:
 *             type: integer
 *         style: form
 *         explode: true
 *         description: IDs of the prizes to calculate commission for
 *         example: [1, 2, 3]
 *     responses:
 *       "200":
 *         description: Commission calculation result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     unpaidCount:
 *                       type: integer
 *                       example: 3
 *                       description: Number of prizes that require commission payment
 *                     starsTotal:
 *                       type: number
 *                       example: 105
 *                       description: Base total in Stars
 *                     tonTotal:
 *                       type: number
 *                       example: 0.63
 *                       description: Total payable in TON
 *                     commissionPerGift:
 *                       type: object
 *                       properties:
 *                         starsAmount:
 *                           type: number
 *                           example: 35
 *                         tonAmount:
 *                           type: number
 *                           example: 0.21
 *                     prizes:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/GiveawayPrizeDto'
 *       "400":
 *         description: Bad request - missing or invalid parameters
 *       "401":
 *         description: Unauthorized
 *       "409":
 *         description: One or more prizes are already in Processing (gift delivery in progress)
 *       "500":
 *         description: Internal server error
 */
prizesStandaloneRouter.get('/claim-commission', auth, prizeController.getClaimCommission.bind(prizeController));

/**
 * @swagger
 * /api/prizes/pay-commission:
 *   get:
 *     summary: Quote gift pre-payment fees and allowed payment methods
 *     description: |
 *       Call **before** `POST /api/prizes/pay` when creating or editing a giveaway with gifts.
 *       Unlike `GET /api/prizes/claim-commission` (withdraw flow), this accepts the same cart as pay:
 *       `nftPrizeIds` + `standardGifts` from the catalog.
 *
 *       Returns fee breakdown in Stars and TON plus `allowedMethods` for wallet vs Telegram Stars.
 *       Telegram Stars (direct) is enabled only for NFT-only carts when the user has an active bot subscription.
 *     tags:
 *       - Prizes
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: nftPrizeIds
 *         schema:
 *           type: array
 *           items:
 *             type: integer
 *         style: form
 *         explode: true
 *         description: Available NFT prize IDs to pay commission for
 *       - in: query
 *         name: standardGifts
 *         schema:
 *           type: string
 *         description: JSON array of `{ telegramGiftId, count }` catalog gifts to purchase
 *         example: '[{"telegramGiftId":"gift_abc","count":2}]'
 *     responses:
 *       "200":
 *         description: Fee quote, allowed payment methods, and full NFT prize rows
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/PayCommissionQuoteDto'
 *       "400":
 *         description: Invalid cart or catalog gift not found
 *       "401":
 *         description: Unauthorized
 */
prizesStandaloneRouter.get(
  '/pay-commission',
  auth,
  prizeController.getPayCommission.bind(prizeController),
);

/**
 * @swagger
 * /api/prizes/pay:
 *   post:
 *     summary: Pay for gifts before linking to a giveaway
 *     description: |
 *       Standalone pre-payment endpoint. Call this before creating or editing a giveaway.
 *       - **UniqueGift (NFT)**: pays platform commission for already-deposited Available prizes
 *         (status stays Available, commissionPaid → true).
 *       - **StandardGift**: creates prize records (status=Available, commissionPaid=true) from the
 *         Telegram gift catalog and charges based on admin-configured markup.
 *
 *       Returns the prize records with their IDs — pass those IDs in `prizes[]` when creating
 *       or updating a giveaway.
 *
 *       Fee breakdown (see `GET /api/prizes/pay-commission` for a quote):
 *       - NFT Stars: `nftWithdrawalBaseStars` per gift
 *       - NFT TON: `convertStarsToTon(nftWithdrawalBaseStars)` per gift
 *       - StandardGift Stars: `ceil(baseStars * (1 + starsMarkup%))`
 *       - StandardGift TON: `round2(convertStarsToTon(baseStars) * (1 + tonMarkup%))`
 *
 *       **paymentSource:**
 *       - `wallet` (default): deduct from in-app balance; returns `prizes` when done
 *       - `telegram`: NFT-only, Stars-only, active subscription required; returns `paymentLink`
 *
 *       Standard gifts cannot use Telegram Stars — wallet Stars or TON only.
 *     tags:
 *       - Prizes
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - currency
 *             properties:
 *               nftPrizeIds:
 *                 type: array
 *                 items:
 *                   type: integer
 *                 description: IDs of Available NFT prizes to pay commission for
 *                 example: [1, 2]
 *               standardGifts:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required:
 *                     - telegramGiftId
 *                     - count
 *                   properties:
 *                     telegramGiftId:
 *                       type: string
 *                       example: "gift_5Pmvsk3gD4u3aH"
 *                       description: Telegram catalog gift ID from GET /api/telegram-gifts
 *                     count:
 *                       type: integer
 *                       minimum: 1
 *                       maximum: 500
 *                       example: 200
 *                       description: How many of this gift to purchase (creates count separate prize rows)
 *                 description: Standard catalog gifts to purchase
 *               currency:
 *                 type: string
 *                 enum: [Stars, TON]
 *                 example: "Stars"
 *               paymentSource:
 *                 type: string
 *                 enum: [wallet, telegram]
 *                 default: wallet
 *                 description: |
 *                   `wallet` — pay from in-app balance (Stars or TON).
 *                   `telegram` — NFT-only Stars invoice via Telegram (subscribers only).
 *     responses:
 *       "200":
 *         description: Payment successful (wallet) or invoice link created (telegram)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     prizes:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/GiveawayPrizeDto'
 *                       description: All paid prize records — use their IDs in prizes[] when creating/updating a giveaway
 *                     totalFeeStars:
 *                       type: number
 *                       example: 2150
 *                       description: Total Stars deducted
 *                     totalFeeTon:
 *                       type: number
 *                       example: 0
 *                       description: Total TON deducted
 *                     paymentLink:
 *                       type: string
 *                       description: Telegram invoice URL when paymentSource=telegram
 *                     amount:
 *                       type: number
 *                       description: Stars amount for telegram invoice
 *       "400":
 *         description: Insufficient balance, invalid prize IDs, catalog gift not found, or invalid payment method
 *       "401":
 *         description: Unauthorized
 *       "500":
 *         description: Internal server error
 */
prizesStandaloneRouter.post('/pay', auth, prizeController.payForPrizes.bind(prizeController));

/**
 * @swagger
 * /api/prizes/accept:
 *   post:
 *     summary: "Stage 1 — Accept a won prize into your account"
 *     description: |
 *       **Stage 1 of the prize claiming flow.**
 *       Moves a won prize (`status=ReadyToClaim`, `winnerUserId=caller`) into the caller's personal gift account (`status=Available`, `depositedByUserId=caller`).
 *
 *       Call this when a user wins a giveaway and wants to secure their prize before the **24-hour claim deadline** expires. After acceptance:
 *       - The prize appears on the caller's gifts page (`GET /prizes/my`) as an Available gift
 *       - The 24-hour deadline is cleared — the giveaway creator can no longer refund it
 *       - The caller can then transfer it to their Telegram account via `POST /prizes/claim` (Stage 2)
 *
 *       Accepts a single prize at a time.
 *     tags:
 *       - Prizes
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - prizeId
 *             properties:
 *               prizeId:
 *                 type: integer
 *                 example: 42
 *                 description: ID of the prize to accept (must be ReadyToClaim and won by the caller)
 *     responses:
 *       "200":
 *         description: Prize accepted — now Available in caller's account
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/GiveawayPrizeDto'
 *       "400":
 *         description: Prize is not in ReadyToClaim status
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Prize does not belong to caller (winnerUserId mismatch)
 *       "404":
 *         description: Prize not found
 *       "500":
 *         description: Internal server error
 */
prizesStandaloneRouter.post('/accept', auth, prizeController.accept.bind(prizeController));

/**
 * @swagger
 * /api/prizes/claim:
 *   post:
 *     summary: "Stage 2 — Transfer an Available prize to your Telegram account"
 *     description: |
 *       **Stage 2 of the prize claiming flow (async when `GIFT_PROVIDER=userbot`).**
 *       Locks each `Available` prize to `Processing`, deducts commission where required, and enqueues gift delivery (20–60s throttle per job; bulk claims are staggered).
 *       Returns immediately with `Processing` — poll `GET /api/prizes/my` until `Transferred` or terminal state.
 *       Do **not** show “withdrawn” in the UI until `status` is `Transferred`.
 *
 *       **Before claim**, call `GET /api/prizes/claim-prerequisites` when using userbot (needsChat + correct @username + sold-out substitute hints).
 *       Winners must first call `POST /api/prizes/accept` (Stage 1). Duplicate claims while `Processing` return **409**.
 *
 *       Sold-out StandardGift catalog ids may be delivered as a **same star-cost substitute**; if send still fails, status reverts to `Available` (not `Failed`).
 *
 *       Commission/payment rules:
 *       - NFT withdrawal commission is TON-only and uses admin settings + live exchange-rate conversion.
 *       - If any unpaid NFT prize is in `prizeIds`, `currency` must be `TON`.
 *     tags:
 *       - Prizes
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - prizeIds
 *               - currency
 *             properties:
 *               prizeIds:
 *                 type: array
 *                 items:
 *                   type: integer
 *                 example: [1, 2]
 *                 description: IDs of prizes to claim (must all belong to the current user)
 *               currency:
 *                 type: string
 *                 enum: [Stars, TON]
 *                 example: "TON"
 *                 description: |
 *                   Currency to pay transfer commission with.
 *                   For unpaid NFT withdrawal commission, only `TON` is allowed.
 *     responses:
 *       "200":
 *         description: Claim accepted — gifts queued for delivery (`Processing`) or transferred synchronously (`GIFT_PROVIDER=business`)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     message:
 *                       type: string
 *                       example: "Queued for delivery; poll GET /prizes/my for Transferred or Available"
 *                       description: Present when gifts are queued (userbot async path)
 *                     results:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           prizeId:
 *                             type: integer
 *                           success:
 *                             type: boolean
 *                           status:
 *                             type: string
 *                             enum: [Processing, Transferred, Available, Cooldown, Failed]
 *                     queued:
 *                       type: integer
 *                       description: Number of prizes enqueued (userbot mode)
 *                     processing:
 *                       type: integer
 *                       description: Prizes now in Processing status
 *                     transferred:
 *                       type: integer
 *                       example: 0
 *                     cooldown:
 *                       type: integer
 *                       example: 0
 *                     failed:
 *                       type: integer
 *                       example: 0
 *                     prizes:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/GiveawayPrizeDto'
 *                       description: Full prize rows after claim (status Processing or terminal)
 *       "400":
 *         description: Bad request — insufficient balance, already claimed, invalid status, or non-TON NFT commission payment
 *       "409":
 *         description: Gift delivery already in progress for one or more prizes
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "NFT withdrawal fee can only be paid in TON"
 *       "401":
 *         description: Unauthorized
 *       "500":
 *         description: Internal server error
 */
prizesStandaloneRouter.post('/claim', auth, prizeController.claim.bind(prizeController));

/**
 * @swagger
 * /api/prizes/transfer:
 *   post:
 *     summary: Transfer owned prizes to another app user
 *     description: |
 *       Reassigns one or more `Available` prizes from the current owner to another user inside the app database.
 *       No Telegram transfer is performed and no Stars/TON commission is charged.
 *
 *       The caller must currently own all specified prizes via `depositedByUserId`, and the recipient must be a valid internal user.
 *       Use `POST /api/prizes/claim` only when sending a gift to a Telegram account.
 *     tags:
 *       - Prizes
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - prizeIds
 *               - recipientUserId
 *             properties:
 *               prizeIds:
 *                 type: array
 *                 items:
 *                   type: integer
 *                 example: [1, 2]
 *                 description: IDs of prizes to transfer (must all belong to the current user)
 *               recipientUserId:
 *                 type: integer
 *                 example: 42
 *                 description: Internal DB user ID of the recipient (use GET /api/users/search to look up)
 *               currency:
 *                 type: string
 *                 enum: [Stars, TON]
 *                 example: "Stars"
 *                 nullable: true
 *                 description: Deprecated and ignored for backward compatibility with older frontend payloads
 *     responses:
 *       "200":
 *         description: Prizes reassigned successfully inside the app
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     transferred:
 *                       type: integer
 *                       example: 2
 *                       description: Number of prizes successfully reassigned to the recipient user
 *                     cooldown:
 *                       type: integer
 *                       example: 0
 *                       description: Always 0 for internal app transfers
 *                     failed:
 *                       type: integer
 *                       example: 0
 *       "400":
 *         description: Bad request — recipient not found, recipient equals caller, or one of the prizes is not Available
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "Recipient user not found"
 *       "401":
 *         description: Unauthorized
 *       "500":
 *         description: Internal server error
 */
prizesStandaloneRouter.post('/transfer', auth, prizeController.transfer.bind(prizeController));

// Giveaway-scoped prize routes (/api/giveaways/:giveawayId)
// These are mounted under the giveaways router at /:giveawayId

/**
 * @swagger
 * /api/giveaways/{giveawayId}/prizes:
 *   get:
 *     summary: Get prizes for a giveaway
 *     description: Returns all prizes linked to the specified giveaway. Publicly accessible.
 *     tags:
 *       - Prizes
 *     parameters:
 *       - in: path
 *         name: giveawayId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: UUID of the giveaway
 *     responses:
 *       "200":
 *         description: List of prizes for this giveaway
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/GiveawayPrizeDto'
 *       "404":
 *         description: Giveaway not found
 *       "500":
 *         description: Internal server error
 */
prizeRouter.get('/prizes', prizeController.getGiveawayPrizes.bind(prizeController));

/**
 * @swagger
 * /api/giveaways/{giveawayId}/prizes:
 *   post:
 *     summary: Link a single pre-paid prize to a giveaway
 *     description: |
 *       Links a single Available or Cooldown + commissionPaid=true prize to the specified giveaway.
 *       The prize status changes to `Linked`. The giveaway's `winnerSlots` is automatically
 *       synced to the total count of Linked prizes.
 *
 *       **Preferred flow**: use `POST /api/prizes/pay` to pre-purchase gifts, then pass
 *       the returned `prizeId` values here (or in the `prizes[]` array on giveaway create/update).
 *
 *       Accepts `prizeId` (primary) or `ownedGiftId` (resolved to prizeId server-side).
 *       The `telegramGiftId/count` variant is deprecated — use `POST /api/prizes/pay` + `prizeId` instead.
 *     tags:
 *       - Prizes
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: giveawayId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             oneOf:
 *               - type: object
 *                 description: Link by prizeId (primary — prize must be Available/Cooldown + commissionPaid)
 *                 required:
 *                   - prizeId
 *                 properties:
 *                   prizeId:
 *                     type: integer
 *                     example: 42
 *                     description: ID of an Available/Cooldown + commissionPaid=true prize (from POST /api/prizes/pay)
 *                   winPlace:
 *                     type: integer
 *                     nullable: true
 *                     example: 1
 *               - type: object
 *                 description: Link by ownedGiftId (alternative for NFT — resolved to prizeId server-side)
 *                 required:
 *                   - ownedGiftId
 *                 properties:
 *                   ownedGiftId:
 *                     type: string
 *                     example: "AgADAgADxRYAAhAjSVN0v3HiEr2RAQIDBA"
 *                     description: Telegram owned_gift_id of the deposited NFT gift
 *                   winPlace:
 *                     type: integer
 *                     nullable: true
 *                     example: 1
 *               - type: object
 *                 description: "Deprecated: add catalog standard gifts directly (bypasses pre-payment; use POST /api/prizes/pay instead)"
 *                 required:
 *                   - telegramGiftId
 *                   - count
 *                 properties:
 *                   telegramGiftId:
 *                     type: string
 *                     example: "gift_5Pmvsk3gD4u3aH"
 *                   count:
 *                     type: integer
 *                     minimum: 1
 *                     maximum: 500
 *                     example: 100
 *                   winPlaceStart:
 *                     type: integer
 *                     nullable: true
 *                     example: 4
 *     responses:
 *       "200":
 *         description: Prize linked successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/GiveawayPrizeDto'
 *       "400":
 *         description: Bad request - prize not available, not owned by user, or giveaway already active
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "Prize is not available for linking"
 *       "401":
 *         description: Unauthorized
 *       "404":
 *         description: Giveaway or prize not found
 *       "500":
 *         description: Internal server error
 */
prizeRouter.post('/prizes', auth, prizeController.linkPrize.bind(prizeController));

/**
 * @swagger
 * /api/giveaways/{giveawayId}/prizes/{prizeId}:
 *   patch:
 *     summary: Update the win place of a linked prize
 *     description: Updates the `winPlace` rank of a prize already linked to this giveaway. Only allowed before giveaway activation.
 *     tags:
 *       - Prizes
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: giveawayId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: prizeId
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID of the prize to update
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - winPlace
 *             properties:
 *               winPlace:
 *                 type: integer
 *                 nullable: true
 *                 example: 2
 *                 description: New win place / rank for this prize (null to clear)
 *     responses:
 *       "200":
 *         description: Prize win place updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/GiveawayPrizeDto'
 *       "400":
 *         description: Bad request - giveaway is already active or prize not linked to this giveaway
 *       "401":
 *         description: Unauthorized
 *       "404":
 *         description: Prize not found
 *       "500":
 *         description: Internal server error
 */
prizeRouter.patch('/prizes/:prizeId', auth, prizeController.updateWinPlace.bind(prizeController));

/**
 * @swagger
 * /api/giveaways/{giveawayId}/prizes/{prizeId}:
 *   delete:
 *     summary: Unlink a prize from a giveaway
 *     description: |
 *       Removes the link between a prize and this giveaway. The prize status reverts to `Available`.
 *       Only allowed before giveaway activation. The giveaway's `winnerSlots` is automatically
 *       re-synced to the remaining Linked prize count.
 *     tags:
 *       - Prizes
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: giveawayId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: prizeId
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID of the prize to unlink
 *     responses:
 *       "200":
 *         description: Prize unlinked successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *       "400":
 *         description: Bad request - giveaway already active or prize not linked to this giveaway
 *       "401":
 *         description: Unauthorized
 *       "404":
 *         description: Prize not found
 *       "500":
 *         description: Internal server error
 */
prizeRouter.delete('/prizes/:prizeId', auth, prizeController.unlinkPrize.bind(prizeController));

/**
 * @swagger
 * /api/giveaways/{giveawayId}/pay-transfer-fees:
 *   post:
 *     summary: "[Deprecated] Pay transfer fees for all unpaid linked prizes"
 *     description: |
 *       **Deprecated** — use `POST /api/prizes/pay` before creating or editing a giveaway.
 *       With the new pre-payment flow all prizes arrive already `commissionPaid=true` so this
 *       endpoint is a no-op in normal usage. Kept for backward compatibility.
 *
 *       Deducts the transfer commission from the user's in-app balance for all Linked prizes
 *       in this giveaway where `commissionPaid = false`. Sets `commissionPaid = true` on each paid prize.
 *       The giveaway cannot be activated until all Linked prizes have `commissionPaid = true`.
 *
 *       Current pricing:
 *       - UniqueGift unpaid fees: TON-only, based on admin payment settings and live exchange-rate conversion.
 *       - StandardGift unpaid fees:
 *         - Stars: `ceil(baseStars * (1 + starsMarkup%))`
 *         - TON: `round2(convertStarsToTon(baseStars) * (1 + tonMarkup%))`
 *     tags:
 *       - Prizes
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: giveawayId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - currency
 *             properties:
 *               currency:
 *                 type: string
 *                 enum: [Stars, TON]
 *                 example: "TON"
 *                 description: |
 *                   Currency to pay fees from (in-app balance).
 *                   If unpaid UniqueGift commissions exist, must be `TON`.
 *     responses:
 *       "200":
 *         description: Transfer fees paid successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     paid:
 *                       type: integer
 *                       example: 3
 *                       description: Number of prizes that had fees deducted
 *                     totalDeducted:
 *                       type: number
 *                       example: 75
 *                       description: Total amount deducted in the specified currency
 *       "400":
 *         description: Bad request - insufficient balance, giveaway already active, no unpaid prizes, or non-TON NFT fee payment
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "NFT withdrawal fee can only be paid in TON"
 *       "401":
 *         description: Unauthorized
 *       "404":
 *         description: Giveaway not found
 *       "500":
 *         description: Internal server error
 */
prizeRouter.post('/pay-transfer-fees', auth, prizeController.payTransferFees.bind(prizeController));

/**
 * @swagger
 * /api/giveaways/{giveawayId}/prizes/{prizeId}/refund:
 *   post:
 *     summary: Refund an unclaimed prize after the 24-hour claim window expires
 *     description: |
 *       Allows the giveaway creator to reclaim a prize the winner did not collect within 24 hours.
 *       - **StandardGift**: refunds `starCount` Stars to creator balance; prize → Failed.
 *       - **UniqueGift**: returns prize to Available (creator can re-assign); prize → Available.
 *       - Blocked if `claimDeadline` has not yet passed (400).
 *       - Blocked if prize is `Transferred` (already delivered).
 *     tags:
 *       - Prizes
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: giveawayId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: prizeId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       "200":
 *         description: Prize refunded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     prizeId:
 *                       type: integer
 *                       example: 42
 *                     prizeType:
 *                       type: string
 *                       enum: [UniqueGift, StandardGift]
 *                     refundedStars:
 *                       type: integer
 *                       nullable: true
 *                       example: 53
 *                       description: Stars refunded (StandardGift only; null for UniqueGift)
 *       "400":
 *         description: Claim deadline not yet expired, or prize already transferred
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden — caller is not the giveaway creator
 *       "404":
 *         description: Prize not found or not in a refundable status
 *       "500":
 *         description: Internal server error
 */
prizeRouter.post('/prizes/:prizeId/refund', auth, prizeController.refundPrize.bind(prizeController));
