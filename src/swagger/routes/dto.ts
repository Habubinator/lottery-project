/**
 * @swagger
 * components:
 *   schemas:
 *     UserDto:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           example: 1
 *         telegramId:
 *           type: string
 *           example: "123456789"
 *         username:
 *           type: string
 *           nullable: true
 *           example: "john_doe"
 *         first_name:
 *           type: string
 *           example: "John"
 *         last_name:
 *           type: string
 *           nullable: true
 *           example: "Doe"
 *         language_code:
 *           type: string
 *           example: "en"
 *         picked_language:
 *           type: string
 *           nullable: true
 *           description: App UI language; null in auth responses until isLanguagePicked is true
 *           example: "en"
 *         isLanguagePicked:
 *           type: boolean
 *           example: false
 *         photo_url:
 *           type: string
 *           example: "https://censored-link.com/photo.jpg"
 *         is_premium:
 *           type: boolean
 *           example: false
 *         roleId:
 *           type: integer
 *           example: 1
 *         tonAddress:
 *           type: string
 *           nullable: true
 *           example: "EQDk2VTvn04SUKJrW7rXahzdF8_Qi6utb0wj43InCu9vdjrR"
 *         notificationList:
 *           type: string
 *           enum: [FromAll, MyList, NoOne]
 *           example: "FromAll"
 *           description: Notification setting for the user
 *         isBanned:
 *           type: boolean
 *           example: false
 *         freePremiumUses:
 *           type: integer
 *           example: 3
 *           description: Number of free premium feature uses available (decremented when creating premium giveaways without subscription)
 *         createdAt:
 *           type: string
 *           format: date-time
 *           example: "2024-01-15T10:30:00Z"
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           example: "2024-01-15T10:30:00Z"
 *         role:
 *           $ref: '#/components/schemas/RoleDto'
 *         wallet:
 *           $ref: '#/components/schemas/WalletDto'
 *         subscription:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/SubscribersDto'
 *         statistics:
 *           $ref: '#/components/schemas/UserStatisticsDto'
 *         creatorStatistics:
 *           $ref: '#/components/schemas/CreatorStatisticsDto'

 *     UserStatisticsDto:
 *       type: object
 *       properties:
 *         totalParticipations:
 *           type: integer
 *           example: 25
 *         lotteryParticipations:
 *           type: integer
 *           example: 15
 *         randomParticipations:
 *           type: integer
 *           example: 10
 *         totalWins:
 *           type: integer
 *           example: 3
 *           description: Occupied prize places won (main + additional winners; replaced holders excluded)
 *         lotteryWins:
 *           type: integer
 *           example: 2
 *           description: Occupied prize places in lottery giveaways
 *         randomWins:
 *           type: integer
 *           example: 1
 *           description: Occupied prize places in random giveaways
 *         earnings:
 *           type: object
 *           description: Total earnings from created giveaways by currency
 *           properties:
 *             stars:
 *               type: number
 *               format: float
 *               example: 1500.5
 *               description: Total Stars earned from lottery giveaways
 *             ton:
 *               type: number
 *               format: float
 *               example: 25.75
 *               description: Total TON earned from lottery giveaways
 *         referrals:
 *           type: object
 *           description: Referral counts across all giveaways
 *           properties:
 *             given:
 *               type: integer
 *               example: 12
 *               description: Number of other users this user referred across all giveaways
 *             received:
 *               type: integer
 *               example: 5
 *               description: Number of times this user was referred by someone
 *         boosts:
 *           type: integer
 *           example: 30
 *           description: Total boost tickets earned across all giveaways

 *     AuthLoginStatisticsDto:
 *       type: object
 *       description: Participation statistics returned on POST /api/auth/login (subset of UserStatisticsDto)
 *       properties:
 *         totalParticipations:
 *           type: integer
 *           example: 15
 *         lotteryParticipations:
 *           type: integer
 *           example: 8
 *         randomParticipations:
 *           type: integer
 *           example: 7
 *         totalWins:
 *           type: integer
 *           example: 3
 *           description: Occupied prize places won (main + additional winners; replaced holders excluded)
 *         earnings:
 *           type: object
 *           properties:
 *             stars:
 *               type: number
 *               example: 150
 *             ton:
 *               type: number
 *               example: 5.5

 *     CreatorStatisticsDto:
 *       type: object
 *       properties:
 *         totalCreated:
 *           type: integer
 *           example: 15
 *           description: Total number of created giveaways
 *         lotteryCreated:
 *           type: integer
 *           example: 10
 *           description: Number of created lottery-type giveaways
 *         randomCreated:
 *           type: integer
 *           example: 5
 *           description: Number of created random-type giveaways
 *         activeCreated:
 *           type: integer
 *           example: 3
 *           description: Number of active created giveaways
 *         finishedCreated:
 *           type: integer
 *           example: 12
 *           description: Number of finished created giveaways

 *     RoleDto:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           example: 1
 *         name:
 *           type: string
 *           example: "user"

 *     PermissionDto:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           example: 1
 *         resource:
 *           type: string
 *           example: "giveaway"
 *         action:
 *           type: string
 *           example: "create"

 *     RolePermissionDto:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           example: 1
 *         roleId:
 *           type: integer
 *           example: 1
 *         permissionId:
 *           type: integer
 *           example: 1
 *         role:
 *           $ref: '#/components/schemas/RoleDto'
 *         permission:
 *           $ref: '#/components/schemas/PermissionDto'

 *     WalletDto:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           example: 1
 *         userId:
 *           type: integer
 *           example: 1
 *         starsBalance:
 *           type: number
 *           format: float
 *           example: 150.50
 *           description: Available Stars balance
 *         holdedStarsBalance:
 *           type: number
 *           format: float
 *           example: 25.0
 *           description: Stars balance on hold pending verification
 *         tonBalance:
 *           type: number
 *           format: float
 *           example: 2.75
 *         transactionHistory:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/TransactionHistoryDto'

 *     WithdrawalDto:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           example: 1
 *         currency:
 *           type: string
 *           enum: [Stars, TON]
 *           example: "Stars"
 *         amount:
 *           type: number
 *           format: float
 *           example: 100.50
 *         status:
 *           type: string
 *           enum: [Reviewed, Accepted, Denied]
 *           example: "Reviewed"
 *         walletId:
 *           type: integer
 *           example: 1
 *         userId:
 *           type: integer
 *           example: 1
 *         photos:
 *           type: array
 *           items:
 *             type: string
 *           example: ["https://censored-link.com/proof1.jpg", "https://censored-link.com/proof2.jpg"]
 *           description: Photos attached by admin as proof of payment or rejection reason
 *         notes:
 *           type: string
 *           example: "Payment processed via bank transfer"
 *           description: Notes from user or admin
 *         createdAt:
 *           type: string
 *           format: date-time
 *           example: "2024-01-15T10:30:00Z"
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           example: "2024-01-15T10:30:00Z"
 *         user:
 *           type: object
 *           properties:
 *             id:
 *               type: integer
 *               example: 1
 *             telegramId:
 *               type: string
 *               example: "123456789"
 *             username:
 *               type: string
 *               nullable: true
 *               example: "john_doe"
 *             firstName:
 *               type: string
 *               nullable: true
 *               example: "John"
 *             lastName:
 *               type: string
 *               nullable: true
 *               example: "Doe"
 *             languageCode:
 *               type: string
 *               nullable: true
 *               example: "en"
 *             photo_url:
 *               type: string
 *               example: "https://censored-link.com/photo.jpg"
 *             isPremium:
 *               type: boolean
 *               example: false
 *             roleId:
 *               type: integer
 *               example: 1
 *             tonAddress:
 *               type: string
 *               nullable: true
 *               example: "EQDk2VTvn04SUKJrW7rXahzdF8_Qi6utb0wj43InCu9vdjrR"
 *             createdAt:
 *               type: string
 *               format: date-time
 *             updatedAt:
 *               type: string
 *               format: date-time
 *             role:
 *               type: object
 *               properties:
 *                 id:
 *                   type: integer
 *                   example: 1
 *                 name:
 *                   type: string
 *                   example: "user"
 *             wallet:
 *               type: object
 *               nullable: true
 *               properties:
 *                 id:
 *                   type: integer
 *                   example: 1
 *                 userId:
 *                   type: integer
 *                   example: 1
 *                 balance:
 *                   type: number
 *                   example: 500
 *                 currency:
 *                   type: string
 *                   enum: [Stars, TON]
 *                   example: "Stars"
 *                 createdAt:
 *                   type: string
 *                   format: date-time
 *                 updatedAt:
 *                   type: string
 *                   format: date-time
 *             subscription:
 *               type: object
 *               nullable: true
 *               properties:
 *                 id:
 *                   type: integer
 *                   example: 1
 *                 userId:
 *                   type: integer
 *                   example: 1
 *                 tariffId:
 *                   type: integer
 *                   example: 1
 *                 startDate:
 *                   type: string
 *                   format: date-time
 *                 endDate:
 *                   type: string
 *                   format: date-time
 *                 isActive:
 *                   type: boolean
 *                   example: true
 *                 createdAt:
 *                   type: string
 *                   format: date-time
 *                 updatedAt:
 *                   type: string
 *                   format: date-time
 *                 tariff:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                       example: 1
 *                     name:
 *                       type: string
 *                       example: "Premium"
 *                     price:
 *                       type: number
 *                       example: 100
 *                     durationDays:
 *                       type: integer
 *                       example: 30
 *                     features:
 *                       type: string
 *                       example: "All features included"
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 *                     updatedAt:
 *                       type: string
 *                       format: date-time
 *         wallet:
 *           type: object
 *           properties:
 *             id:
 *               type: integer
 *               example: 1
 *             userId:
 *               type: integer
 *               example: 1
 *             balance:
 *               type: number
 *               example: 500
 *             currency:
 *               type: string
 *               enum: [Stars, TON]
 *               example: "Stars"
 *             createdAt:
 *               type: string
 *               format: date-time
 *             updatedAt:
 *               type: string
 *               format: date-time

 *     StarsWithdrawalRequestDto:
 *       type: object
 *       required:
 *         - starsAmount
 *       properties:
 *         starsAmount:
 *           type: integer
 *           minimum: 1
 *           example: 1000
 *           description: Stars amount to withdraw (exchanged to TON, then TON withdrawal created)
 *         notes:
 *           type: string
 *           example: "Optional user note"
 *           description: Optional notes appended to the withdrawal request

 *     StarsWithdrawalPreviewDto:
 *       type: object
 *       properties:
 *         starsAmount:
 *           type: integer
 *           example: 1000
 *         starsBalance:
 *           type: integer
 *           example: 5000
 *         tonBalance:
 *           type: number
 *           format: float
 *           example: 1.25
 *         tonGross:
 *           type: number
 *           format: float
 *           example: 10.5
 *           description: TON after Stars→TON conversion (before withdrawal commission)
 *         tonCommissionPercent:
 *           type: number
 *           format: float
 *           example: 5
 *         tonCommissionAmount:
 *           type: number
 *           format: float
 *           example: 0.53
 *         tonNet:
 *           type: number
 *           format: float
 *           example: 9.97
 *           description: Net TON the user receives after commission
 *         exchangeRate:
 *           type: object
 *           properties:
 *             starsInput:
 *               type: number
 *               example: 100
 *             tonOutput:
 *               type: number
 *               example: 1.05
 *         tonAddress:
 *           type: string
 *           nullable: true
 *           example: "EQDk2VTvn04SUKJrW7rXahzdF8_Qi6utb0wj43InCu9vdjrR"
 *         minStars:
 *           type: integer
 *           example: 100
 *         minTon:
 *           type: number
 *           format: float
 *           example: 0.5
 *         hasPendingWithdrawal:
 *           type: boolean
 *           example: false
 *         meetsMinStars:
 *           type: boolean
 *           example: true
 *         meetsMinTon:
 *           type: boolean
 *           example: true

 *     StarsWithdrawalResultDto:
 *       type: object
 *       properties:
 *         exchange:
 *           type: object
 *           properties:
 *             starsDebited:
 *               type: integer
 *               example: 1000
 *             tonGross:
 *               type: number
 *               format: float
 *               example: 10.5
 *         withdrawal:
 *           $ref: '#/components/schemas/WithdrawalDto'
 *         quote:
 *           type: object
 *           properties:
 *             tonNet:
 *               type: number
 *               format: float
 *               example: 9.97
 *             tonCommissionAmount:
 *               type: number
 *               format: float
 *               example: 0.53
 *             tonCommissionPercent:
 *               type: number
 *               format: float
 *               example: 5

 *     PrizePaymentMethodOptionDto:
 *       type: object
 *       properties:
 *         currency:
 *           type: string
 *           enum: [Stars, TON]
 *           example: Stars
 *         source:
 *           type: string
 *           enum: [wallet, telegram]
 *           example: wallet
 *         enabled:
 *           type: boolean
 *           example: true
 *         disabledReason:
 *           type: string
 *           nullable: true
 *           enum: [standard_gifts_present, no_nft, subscription_required]
 *           description: Present when enabled=false (telegram Stars direct pay)

 *     PayCommissionQuoteDto:
 *       type: object
 *       description: Quote from GET /api/prizes/pay-commission
 *       properties:
 *         hasActiveSubscription:
 *           type: boolean
 *           example: true
 *           description: Whether user has active bot subscription (required for paymentSource=telegram)
 *         wallet:
 *           type: object
 *           properties:
 *             starsBalance:
 *               type: number
 *               example: 5000
 *             tonBalance:
 *               type: number
 *               format: float
 *               example: 1.25
 *         fees:
 *           type: object
 *           properties:
 *             stars:
 *               type: object
 *               properties:
 *                 nft:
 *                   type: number
 *                   example: 70
 *                 standard:
 *                   type: number
 *                   example: 240
 *                 total:
 *                   type: number
 *                   example: 310
 *             ton:
 *               type: object
 *               properties:
 *                 nft:
 *                   type: number
 *                   format: float
 *                   example: 0.42
 *                 standard:
 *                   type: number
 *                   format: float
 *                   example: 2.1
 *                 total:
 *                   type: number
 *                   format: float
 *                   example: 2.52
 *             nftCount:
 *               type: integer
 *               example: 2
 *             standardGiftCount:
 *               type: integer
 *               example: 3
 *         allowedMethods:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/PrizePaymentMethodOptionDto'
 *         prizes:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/GiveawayPrizeDto'
 *           description: Full NFT prize rows for nftPrizeIds in the request

 *     CreateWithdrawalRequestDto:
 *       type: object
 *       required:
 *         - currency
 *         - amount
 *       properties:
 *         currency:
 *           type: string
 *           enum: [Stars, TON]
 *           example: "Stars"
 *           description: Currency to withdraw
 *         amount:
 *           type: number
 *           minimum: 0.01
 *           example: 100.50
 *           description: Amount to withdraw
 *         notes:
 *           type: string
 *           example: "Please send to my TON wallet"
 *           description: Optional notes for the withdrawal request

 *     AdminWithdrawalActionDto:
 *       type: object
 *       properties:
 *         photos:
 *           type: array
 *           items:
 *             type: string
 *           example: ["https://censored-link.com/proof1.jpg", "https://censored-link.com/proof2.jpg"]
 *           description: Optional photos as proof of payment or rejection reason
 *         notes:
 *           type: string
 *           example: "Payment processed successfully via bank transfer"
 *           description: Optional admin notes

 *     PaginatedWithdrawalsResponse:
 *       type: object
 *       properties:
 *         items:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/WithdrawalDto'
 *         meta:
 *           $ref: '#/components/schemas/PaginationMetaDto'

 *     HoldingStarsDto:
 *       type: object
 *       properties:
 *         transactionId:
 *           type: string
 *           example: "tx_1234567890"
 *           description: Telegram payment charge ID
 *         userId:
 *           type: integer
 *           example: 1
 *         validWhen:
 *           type: string
 *           format: date-time
 *           example: "2024-01-15T12:30:00Z"
 *           description: When the hold expires and Stars can be released
 *         ammount:
 *           type: number
 *           format: float
 *           example: 100.0
 *           description: Amount of Stars on hold
 *         status:
 *           type: string
 *           enum: [Pending, Completed, Failed]
 *           example: "Pending"
 *         timeRemainingMs:
 *           type: integer
 *           example: 86400000
 *           description: Time remaining until hold expires in milliseconds
 *         isExpired:
 *           type: boolean
 *           example: false
 *           description: Whether the hold has expired
 *         owner:
 *           type: object
 *           properties:
 *             id:
 *               type: integer
 *               example: 1
 *             username:
 *               type: string
 *               nullable: true
 *               example: "john_doe"
 *             first_name:
 *               type: string
 *               example: "John"
 *             last_name:
 *               type: string
 *               nullable: true
 *               example: "Doe"
 *             photo_url:
 *               type: string
 *               example: "https://censored-link.com/photo.jpg"

 *     TariffDto:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           example: 1
 *         label:
 *           type: string
 *           example: "Premium Monthly"
 *         currency:
 *           type: string
 *           enum: [Stars, TON]
 *           example: "Stars"
 *         price:
 *           type: integer
 *           example: 100
 *         tonPrice:
 *           type: number
 *           format: decimal
 *           example: 2.5
 *           description: Price in TON cryptocurrency
 *         lengthDays:
 *           type: integer
 *           example: 30

 *     SubscribersDto:
 *       type: object
 *       properties:
 *         userId:
 *           type: integer
 *           example: 1
 *         tariffId:
 *           type: integer
 *           example: 1
 *         subscriptionExpiringAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *           example: "2024-02-15T10:30:00Z"
 *         tariff:
 *           $ref: '#/components/schemas/TariffDto'

 *     WalletStatsDto:
 *       type: object
 *       properties:
 *         currentBalance:
 *           type: object
 *           properties:
 *             stars:
 *               type: number
 *               format: float
 *               example: 1250.5
 *               description: Available Stars balance
 *             holdedStars:
 *               type: number
 *               format: float
 *               example: 50.0
 *               description: Stars balance on hold
 *             ton:
 *               type: number
 *               format: float
 *               example: 15.75
 *         totalDeposited:
 *           type: number
 *           example: 2000
 *         totalSpent:
 *           type: number
 *           example: 750
 *         depositCount:
 *           type: integer
 *           example: 8
 *         withdrawalCount:
 *           type: integer
 *           example: 12
 *         pendingTransactions:
 *           type: integer
 *           example: 2
 *           description: Number of pending transactions

 *     CreateDepositLinkRequestDto:
 *       type: object
 *       required:
 *         - amount
 *         - currency
 *       properties:
 *         amount:
 *           type: number
 *           minimum: 1
 *           example: 100
 *           description: Amount to deposit
 *         currency:
 *           type: string
 *           enum: [Stars, TON]
 *           example: "Stars"
 *           description: Currency type
 *         description:
 *           type: string
 *           example: "Wallet top-up"
 *           description: Optional description for the payment

 *     PaginatedTransactionsResponse:
 *       type: object
 *       properties:
 *         items:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/TransactionHistoryDto'
 *         meta:
 *           $ref: '#/components/schemas/PaginationMetaDto'

 *     TransactionHistoryDto:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *           example: "550e8400-e29b-41d4-a716-446655440000"
 *         walletId:
 *           type: integer
 *           example: 1
 *         userId:
 *           type: integer
 *           example: 1
 *         type:
 *           type: string
 *           enum: [Incoming, Outcoming]
 *           example: "Incoming"
 *         status:
 *           type: string
 *           enum: [Pending, Completed, Failed]
 *           example: "Pending"
 *           description: Pending for Stars deposits until hold expires
 *         currency:
 *           type: string
 *           enum: [Stars, TON]
 *           example: "Stars"
 *           description: Currency of the transaction
 *         value:
 *           type: integer
 *           example: 100
 *           description: Transaction amount
 *         balanceBefore:
 *           type: number
 *           format: float
 *           nullable: true
 *           example: 150.50
 *           description: Balance before the transaction
 *         balanceAfter:
 *           type: number
 *           format: float
 *           nullable: true
 *           example: 250.50
 *           description: Balance after the transaction
 *         isSubscriptionPayment:
 *           type: boolean
 *           example: false
 *           description: Whether this is a subscription payment
 *         additionalInfo:
 *           type: string
 *           nullable: true
 *           example: "Payment via Telegram: charge_123 (deposit) - On hold until 2024-01-15T12:30:00Z"
 *         createdAt:
 *           type: string
 *           format: date-time
 *           example: "2024-01-15T10:30:00Z"
 *         wallet:
 *           $ref: '#/components/schemas/WalletDto'
 *         user:
 *           type: object
 *           properties:
 *             id:
 *               type: integer
 *               example: 1
 *             username:
 *               type: string
 *               nullable: true
 *               example: "john_doe"
 *             first_name:
 *               type: string
 *               example: "John"
 *             last_name:
 *               type: string
 *               nullable: true
 *               example: "Doe"
 *             photo_url:
 *               type: string
 *               example: "https://censored-link.com/photo.jpg"

 *     GiveawayDto:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *           example: "550e8400-e29b-41d4-a716-446655440000"
 *         isActive:
 *           type: boolean
 *           example: true
 *         isPlanned:
 *           type: boolean
 *           example: false
 *           description: Whether the giveaway is scheduled for future activation
 *         isCancelled:
 *           type: boolean
 *           example: false
 *         cancelDescription:
 *           type: string
 *           nullable: true
 *           example: null
 *         description:
 *           type: string
 *           nullable: true
 *           example: "Win amazing prizes!"
 *         banner:
 *           type: array
 *           items:
 *             type: string
 *           example: ["/static/giveaways/banner1.jpg", "/static/giveaways/banner2.jpg"]
 *           description: Array of banner image paths
 *         participiationType:
 *           type: string
 *           enum: [Lottery, Random]
 *           example: "Lottery"
 *         completionType:
 *           type: string
 *           enum: [ByTime, ByCapacity]
 *           example: "ByTime"
 *         language:
 *           type: string
 *           example: "en"
 *         maxParticipants:
 *           type: integer
 *           nullable: true
 *           example: 1000
 *         winnerSlots:
 *           type: integer
 *           example: 5
 *         participiationPrice:
 *           type: string
 *           format: float
 *           example: "10.50"
 *         participiationCurr:
 *           type: string
 *           enum: [Stars, TON]
 *           example: "Stars"
 *         neededReferals:
 *           type: integer
 *           example: 0
 *         isOnlyPremium:
 *           type: boolean
 *           example: false
 *         isBoostNeeded:
 *           type: boolean
 *           example: false
 *         boostedId:
 *           type: string
 *           format: int64
 *           nullable: true
 *           example: "123456789"
 *           description: BigInt Channel ID that requires boost for participation
 *         boostedChannel:
 *           nullable: true
 *           allOf:
 *             - $ref: '#/components/schemas/ChannelDto'
 *           description: Channel that requires boost for participation
 *         allowedGeoCountries:
 *           type: string
 *           example: ""
 *         isCaptchaNeeded:
 *           type: boolean
 *           example: false
 *           description: Require captcha verification for participation
 *         doApiSessionCheck:
 *           type: boolean
 *           example: false
 *         isStaySubscribed:
 *           type: boolean
 *           example: false
 *         participationButtonText:
 *           type: string
 *           nullable: true
 *           maxLength: 40
 *           example: "Join now"
 *           description: Custom base label for the participation inline button
 *         participationButtonStyle:
 *           type: string
 *           nullable: true
 *           enum: [primary, success, danger]
 *           example: success
 *           description: Telegram inline button color (Bot API 9.4+). Null = default gray. Applied on active giveaway posts only.
 *         showParticipationCount:
 *           type: boolean
 *           default: true
 *           example: true
 *           description: When false, active post button shows label only (no participant/ticket count suffix)
 *         showParticipationMaxCount:
 *           type: boolean
 *           default: true
 *           example: true
 *           description: When true and completionType is ByCapacity, button shows •current/max. When false, shows •current only. Ignored if showParticipationCount is false.
 *         numerifyWinners:
 *           type: boolean
 *           example: false
 *           description: Automatically assign sequential place numbers to winners
 *         allowMultipleWinPlaces:
 *           type: boolean
 *           default: false
 *           description: When false, one user can occupy at most one main winner place. When true, each Participant row can win separately (Lottery paid tickets or Random earned tickets via canEarnAdditionalTickets). Does not affect additional-winner selection.
 *         isResultsInMainPost:
 *           type: boolean
 *           example: false
 *           description: Post results as blockquote inside main giveaway post instead of separate message
 *         isCommentsOn:
 *           type: boolean
 *           example: false
 *           description: Convert buttons to text hyperlinks to enable Telegram comments
 *         variant:
 *           type: string
 *           example: "standard"
 *           description: Giveaway card variant/template name
 *         isPostingOn:
 *           type: boolean
 *           example: false
 *           description: Ads - whether giveaway is visible in public listing
 *         isNotificationOn:
 *           type: boolean
 *           example: false
 *           description: Ads - whether bot sends notifications for this giveaway
 *         twinkBlock:
 *           type: boolean
 *           example: false
 *           description: Block suspected twink (duplicate) accounts from participating
 *         isShared:
 *           type: boolean
 *           example: false
 *           description: True when the user did not create this giveaway but claimed shared management (linkedChannels.managedByUserId, postlot publishedById, or Approved SponsorApproval). Not set for other channel co-admins.
 *         canEarnAdditionalTickets:
 *           type: boolean
 *           example: false
 *           description: Allow participants to earn extra lottery tickets via referrals and channel boosts
 *         countRefsOnParticipation:
 *           type: boolean
 *           example: false
 *           description: When true, referral tickets count only after the referred user joins; when false, on invite (referral link)
 *         refsPerTicket:
 *           type: integer
 *           example: 0
 *           description: Referrals required to earn one additional ticket
 *         boostsPerTicket:
 *           type: integer
 *           example: 0
 *           description: Channel boosts required to earn one additional ticket
 *         maxAdditionalTickets:
 *           type: integer
 *           example: 0
 *           description: Cap on total additional tickets per participant (0 = unlimited)
 *         earnedTickets:
 *           type: integer
 *           example: 0
 *           description: Total additional tickets earned across all participants for this giveaway
 *         startingAt:
 *           type: string
 *           format: date-time
 *           example: "2024-01-15T10:30:00Z"
 *         endingAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *           example: "2024-01-22T10:30:00Z"
 *         finishedAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *           example: "2024-01-22T10:30:00Z"
 *           description: Actual finish/cancellation timestamp
 *         createdAt:
 *           type: string
 *           format: date-time
 *           example: "2024-01-15T10:30:00Z"
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           example: "2024-01-15T10:30:00Z"
 *         createdById:
 *           type: integer
 *           nullable: true
 *           example: 1
 *         createdBy:
 *           $ref: '#/components/schemas/UserDto'
 *         linkedChannels:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/LinkedChannelsDto'
 *         sponsoredBy:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/SponsorsDto'
 *         participants:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/ParticipantDto'
 *         referrals:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/GiveawayReferralDto'
 *         _count:
 *           $ref: '#/components/schemas/GiveawayCountDto'
 *         isParticipiating:
 *           type: boolean
 *           example: false
 *           description: Only present when queried with userId
 *         userTicketsCount:
 *           type: integer
 *           example: 3
 *           description: Number of tickets (participations) the user has purchased for this giveaway. Only present when queried with userId
 *         uniqueParticipantsCount:
 *           type: integer
 *           example: 127
 *           description: Number of unique participants (unique userId's) in this giveaway
 *         sponsorSlots:
 *           type: integer
 *           nullable: true
 *           example: 3
 *           description: Total co-sponsor slots for this giveaway (null = no joint feature)
 *         starsPerSlot:
 *           type: integer
 *           nullable: true
 *           example: 100
 *           description: Telegram Stars price per co-sponsor slot
 *         numerifyPrizes:
 *           type: boolean
 *           example: false
 *           description: Whether to display medal/rank numeration next to prizes in announcements
 *         prizes:
 *           type: array
 *           items:
 *             $ref: "#/components/schemas/GiveawayPrizeDto"
 *           description: Gift prizes on this giveaway (Linked+ for detail views; user giveaway lists may also include Available/Processing after claim)
 *         postlotPublications:
 *           type: array
 *           items:
 *             $ref: "#/components/schemas/PostlotPublicationDto"
 *           description: Channels where this giveaway was additionally published via /postlot. Not counted as creation channels — results are NOT posted here.

 *     GiveawayCountDto:
 *       type: object
 *       properties:
 *         participants:
 *           type: integer
 *           example: 250
 *         referrals:
 *           type: integer
 *           example: 5

 *     CreateGiveawayRequestDto:
 *       type: object
 *       required:
 *         - banner
 *         - participiationType
 *         - completionType
 *         - language
 *         - winnerSlots
 *       properties:
 *         description:
 *           type: string
 *           example: "Win amazing prizes in our giveaway!"
 *         banner:
 *           type: array
 *           items:
 *             type: string
 *             format: binary
 *           description: Array of banner images (multipart/form-data upload)
 *         participiationType:
 *           type: string
 *           enum: [Lottery, Random]
 *           example: "Lottery"
 *         completionType:
 *           type: string
 *           enum: [ByTime, ByCapacity]
 *           example: "ByTime"
 *         language:
 *           type: string
 *           example: "en"
 *         maxParticipants:
 *           type: integer
 *           example: 1000
 *         winnerSlots:
 *           type: integer
 *           example: 3
 *         participiationPrice:
 *           type: number
 *           format: float
 *           example: 50.00
 *         participiationCurr:
 *           type: string
 *           enum: [Stars, TON]
 *           example: "Stars"
 *         startingAt:
 *           type: string
 *           format: date-time
 *           example: "2024-01-15T10:30:00Z"
 *         endingAt:
 *           type: string
 *           format: date-time
 *           example: "2024-01-22T10:30:00Z"
 *         neededReferals:
 *           type: integer
 *           example: 5
 *           description: Premium feature - requires active subscription
 *         isOnlyPremium:
 *           type: boolean
 *           example: false
 *           description: Premium feature - requires active subscription
 *         isBoostNeeded:
 *           type: boolean
 *           example: false
 *           description: Premium feature - requires active subscription
 *         boostedId:
 *           type: string
 *           format: int64
 *           example: "123456789"
 *           description: Premium feature - BigInt Channel ID that requires boost for participation. Requires active subscription
 *         allowedGeoCountries:
 *           type: string
 *           example: "US,UK,CA"
 *           description: Premium feature - requires active subscription
 *         isCaptchaNeeded:
 *           type: boolean
 *           example: false
 *           description: Require captcha verification for participation (non-premium feature)
 *         doApiSessionCheck:
 *           type: boolean
 *           example: false
 *           description: Premium feature - requires active subscription
 *         isStaySubscribed:
 *           type: boolean
 *           example: false
 *           description: Premium feature - requires active subscription. Validates winners are subscribed to linked channels at selection time
 *         participationButtonText:
 *           type: string
 *           maxLength: 40
 *           example: "Join now"
 *           description: Custom base label for the participation inline button (non-premium). Prefer value from GET /users/description/poll after bot Save; if omitted, server uses User.defaultParticipationButtonText.
 *         participationButtonStyle:
 *           type: string
 *           enum: [primary, success, danger]
 *           example: success
 *           description: Telegram inline button color (Bot API 9.4+). Omit or null for default gray/transparent. Prefer value from description poll; if omitted, server uses User.defaultParticipationButtonStyle.
 *         showParticipationCount:
 *           type: boolean
 *           default: true
 *           example: true
 *           description: When false, active post button shows label only (no count suffix). Prefer value from description poll; if omitted, server uses User.defaultShowParticipationCount.
 *         showParticipationMaxCount:
 *           type: boolean
 *           default: true
 *           example: true
 *           description: When true and completionType is ByCapacity, button shows •current/max. When false, shows •current only. Pass values from GET /users/description/poll after bot Save. If omitted on create, server uses last saved user defaults from bot customization.
 *         numerifyWinners:
 *           type: boolean
 *           example: false
 *           description: Automatically numerify winners on giveaway/lottery ending (assign sequential place numbers)
 *         allowMultipleWinPlaces:
 *           type: boolean
 *           default: false
 *           description: When false, one user can occupy at most one main winner place. When true, each Participant row can win separately (Lottery paid tickets or Random earned tickets via canEarnAdditionalTickets). Does not affect additional-winner selection.
 *         isResultsInMainPost:
 *           type: boolean
 *           example: false
 *           description: Post results as blockquote inside main giveaway post instead of creating separate message (non-premium feature)
 *         isCommentsOn:
 *           type: boolean
 *           example: false
 *           description: Convert buttons to text hyperlinks to enable Telegram comments (non-premium feature)
 *         variant:
 *           type: string
 *           example: "standard"
 *           description: Giveaway card variant/template name (max 16 chars, defaults to 'standard')
 *         isPostingOn:
 *           type: boolean
 *           example: false
 *           description: Ads - whether giveaway is visible in public listing
 *         isNotificationOn:
 *           type: boolean
 *           example: false
 *           description: Ads - whether bot sends notifications for this giveaway
 *         twinkBlock:
 *           type: boolean
 *           example: false
 *           description: "Paid feature — blocks twink/duplicate accounts from joining. Requires active subscription or free premium use."
 *         sponsorLinks:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *                 example: "Visit our website"
 *               link:
 *                 type: string
 *                 example: "https://censored-link.com"
 *         linkedChannelIds:
 *           type: array
 *           items:
 *             oneOf:
 *               - type: string
 *                 format: int64
 *                 description: Channel ID — defaults to role All (posting + subscription)
 *                 example: "1111111111"
 *               - type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                     format: int64
 *                     example: "1111111111"
 *                   role:
 *                     type: string
 *                     enum: [All, Posting, Subscription]
 *                     default: All
 *                     description: "All: posting + subscription required. Posting: giveaway posted but no subscription check. Subscription: must subscribe but giveaway not posted here."
 *           description: Channels attached to this giveaway. Plain string IDs default to role All.
 *           example: ["1111111111", {"id": "2222222222", "role": "Subscription"}]
 *         canEarnAdditionalTickets:
 *           type: boolean
 *           default: false
 *           description: Allow participants to earn extra lottery tickets via referrals and channel boosts. Cannot be combined with neededReferals > 0 or isBoostNeeded = true.
 *         countRefsOnParticipation:
 *           type: boolean
 *           default: false
 *           description: When true, count referrals only after referred user joins; when false, count on invite. Requires canEarnAdditionalTickets.
 *         refsPerTicket:
 *           type: integer
 *           default: 0
 *           description: How many referrals a participant must bring to earn one additional ticket. Requires canEarnAdditionalTickets.
 *         boostsPerTicket:
 *           type: integer
 *           default: 0
 *           description: How many linked-channel boosts earn one additional ticket. Requires canEarnAdditionalTickets.
 *         maxAdditionalTickets:
 *           type: integer
 *           default: 0
 *           description: Cap on total additional tickets per participant (0 = unlimited).
 *         earnedTickets:
 *           type: integer
 *           example: 0
 *           description: Total additional tickets earned across all participants (read-only, ignored on write).
 *         sponsorSlots:
 *           type: integer
 *           example: 3
 *           description: Number of open co-sponsor slots (0 or omit to disable)
 *         starsPerSlot:
 *           type: integer
 *           example: 100
 *           description: Telegram Stars price per co-sponsor slot
 *         prizes:
 *           type: array
 *           description: |
 *             Already-paid Available prize records to link to this giveaway.
 *             Obtain prizeIds from POST /api/prizes/pay first.
 *           items:
 *             type: object
 *             required:
 *               - prizeId
 *             properties:
 *               prizeId:
 *                 type: integer
 *                 example: 42
 *                 description: ID of an Available + commissionPaid=true prize record
 *               winPlace:
 *                 type: integer
 *                 nullable: true
 *                 example: 1
 *                 description: Win place assignment (null = unordered)

 *     UpdateGiveawayDto:
 *       type: object
 *       description: Update giveaway properties. Note - participationType cannot be changed after creation, startingAt cannot be changed after giveaway has started, and participiationPrice cannot be changed for active lotteries.
 *       properties:
 *         description:
 *           type: string
 *           example: "Win amazing prizes in our giveaway!"
 *         banner:
 *           type: array
 *           items:
 *             type: string
 *             format: binary
 *           description: Array of banner images (multipart/form-data upload) - replaces existing banners
 *         completionType:
 *           type: string
 *           enum: [ByTime, ByCapacity]
 *           example: "ByTime"
 *         language:
 *           type: string
 *           example: "en"
 *         maxParticipants:
 *           type: integer
 *           example: 1000
 *           description: Cannot be reduced below current participant count
 *         winnerSlots:
 *           type: integer
 *           example: 3
 *           description: Cannot be reduced below current value
 *         participiationPrice:
 *           type: number
 *           format: float
 *           example: 50.00
 *           description: Cannot be changed for active lotteries
 *         participiationCurr:
 *           type: string
 *           enum: [Stars, TON]
 *           example: "Stars"
 *         endingAt:
 *           type: string
 *           format: date-time
 *           example: "2024-01-22T10:30:00Z"
 *         neededReferals:
 *           type: integer
 *           example: 5
 *           description: Premium feature - requires active subscription
 *         isOnlyPremium:
 *           type: boolean
 *           example: false
 *           description: Premium feature - requires active subscription
 *         isBoostNeeded:
 *           type: boolean
 *           example: false
 *           description: Premium feature - requires active subscription
 *         boostedId:
 *           type: string
 *           format: int64
 *           example: "123456789"
 *           description: Premium feature - BigInt Channel ID that requires boost for participation. Requires active subscription
 *         allowedGeoCountries:
 *           type: string
 *           example: "US,UK,CA"
 *           description: Premium feature - requires active subscription
 *         isCaptchaNeeded:
 *           type: boolean
 *           example: false
 *           description: Require captcha verification for participation (non-premium feature)
 *         doApiSessionCheck:
 *           type: boolean
 *           example: false
 *           description: Premium feature - requires active subscription
 *         isStaySubscribed:
 *           type: boolean
 *           example: false
 *           description: Premium feature - requires active subscription. Validates winners are subscribed to linked channels at selection time
 *         participationButtonText:
 *           type: string
 *           maxLength: 40
 *           example: "Join now"
 *           description: Custom base label for the participation inline button (non-premium). Prefer value from GET /users/description/poll after bot Save; if omitted, server uses User.defaultParticipationButtonText.
 *         participationButtonStyle:
 *           type: string
 *           enum: [primary, success, danger]
 *           example: success
 *           description: Telegram inline button color (Bot API 9.4+). Omit or null for default gray/transparent. Prefer value from description poll; if omitted, server uses User.defaultParticipationButtonStyle.
 *         showParticipationCount:
 *           type: boolean
 *           default: true
 *           example: true
 *           description: When false, active post button shows label only (no count suffix). Prefer value from description poll; if omitted, server uses User.defaultShowParticipationCount.
 *         showParticipationMaxCount:
 *           type: boolean
 *           default: true
 *           example: true
 *           description: When true and completionType is ByCapacity, button shows •current/max. When false, shows •current only. Pass values from GET /users/description/poll after bot Save. If omitted on create, server uses last saved user defaults from bot customization.
 *         numerifyWinners:
 *           type: boolean
 *           example: false
 *           description: Automatically numerify winners on giveaway/lottery ending (assign sequential place numbers)
 *         allowMultipleWinPlaces:
 *           type: boolean
 *           default: false
 *           description: When false, one user can occupy at most one main winner place. When true, each Participant row can win separately (Lottery paid tickets or Random earned tickets via canEarnAdditionalTickets). Does not affect additional-winner selection.
 *         isResultsInMainPost:
 *           type: boolean
 *           example: false
 *           description: Post results as blockquote inside main giveaway post instead of creating separate message (non-premium feature)
 *         isCommentsOn:
 *           type: boolean
 *           example: false
 *           description: Convert buttons to text hyperlinks to enable Telegram comments (non-premium feature)
 *         variant:
 *           type: string
 *           example: "standard"
 *           description: Giveaway card variant/template name (max 16 chars, defaults to 'standard')
 *         isPostingOn:
 *           type: boolean
 *           example: false
 *           description: Ads - whether giveaway is visible in public listing
 *         isNotificationOn:
 *           type: boolean
 *           example: false
 *           description: Ads - whether bot sends notifications for this giveaway
 *         twinkBlock:
 *           type: boolean
 *           example: false
 *           description: "Paid feature — blocks twink/duplicate accounts from joining. Requires active subscription or free premium use."
 *         sponsorLinks:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *                 example: "Visit our website"
 *               link:
 *                 type: string
 *                 example: "https://censored-link.com"
 *         linkedChannelIds:
 *           type: array
 *           items:
 *             oneOf:
 *               - type: string
 *                 format: int64
 *                 description: Channel ID — defaults to role All (posting + subscription)
 *                 example: "1111111111"
 *               - type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                     format: int64
 *                     example: "1111111111"
 *                   role:
 *                     type: string
 *                     enum: [All, Posting, Subscription]
 *                     default: All
 *                     description: "All: posting + subscription required. Posting: giveaway posted but no subscription check. Subscription: must subscribe but giveaway not posted here."
 *           description: Channels attached to this giveaway. Plain string IDs default to role All.
 *           example: ["1111111111", {"id": "2222222222", "role": "Subscription"}]
 *         canEarnAdditionalTickets:
 *           type: boolean
 *           description: Allow participants to earn extra lottery tickets via referrals and channel boosts. Cannot be combined with neededReferals > 0 or isBoostNeeded = true.
 *         countRefsOnParticipation:
 *           type: boolean
 *           description: When true, count referrals only after referred user joins; when false, count on invite.
 *         refsPerTicket:
 *           type: integer
 *           description: How many referrals a participant must bring to earn one additional ticket. Requires canEarnAdditionalTickets.
 *         boostsPerTicket:
 *           type: integer
 *           description: How many linked-channel boosts earn one additional ticket. Requires canEarnAdditionalTickets.
 *         maxAdditionalTickets:
 *           type: integer
 *           description: Cap on total additional tickets per participant (0 = unlimited).
 *         earnedTickets:
 *           type: integer
 *           example: 0
 *           description: Total additional tickets earned across all participants (read-only, ignored on write).
 *         sponsorSlots:
 *           type: integer
 *           example: 3
 *           description: Number of open co-sponsor slots (0 to disable)
 *         starsPerSlot:
 *           type: integer
 *           example: 100
 *           description: Telegram Stars price per co-sponsor slot
 *         prizes:
 *           type: array
 *           description: |
 *             Replace all linked prizes with this list (replace-all semantics).
 *             Omit to leave existing prizes untouched.
 *             All entries must be Available + commissionPaid=true records (from POST /api/prizes/pay).
 *             Blocked if giveaway is active, cancelled, or finished.
 *           items:
 *             type: object
 *             required:
 *               - prizeId
 *             properties:
 *               prizeId:
 *                 type: integer
 *                 example: 42
 *               winPlace:
 *                 type: integer
 *                 nullable: true
 *                 example: 1

 *     JoinGiveawayRequestDto:
 *       type: object
 *       properties:
 *         tickets:
 *           type: integer
 *           minimum: 1
 *           example: 3
 *           description: Number of tickets to purchase (for lottery giveaways)

 *     CancelGiveawayRequestDto:
 *       type: object
 *       required:
 *         - cancelDescription
 *       properties:
 *         cancelDescription:
 *           type: string
 *           example: "Cancelled due to technical issues"

 *     ParticipantDto:
 *       type: object
 *       properties:
 *         userId:
 *           type: integer
 *           example: 1
 *         giveawayId:
 *           type: string
 *           format: uuid
 *           example: "550e8400-e29b-41d4-a716-446655440000"
 *         isWinner:
 *           type: boolean
 *           example: false
 *         winPlace:
 *           type: integer
 *           example: 0
 *         isAddWinner:
 *           type: boolean
 *           description: Whether this participant is an additional winner
 *           example: false
 *         range:
 *           type: string
 *           description: Range of participants from which this additional winner was selected
 *           example: "1-100"
 *         addPlace:
 *           type: integer
 *           description: Position of the additional winner (0 if not an additional winner)
 *           example: 0
 *         participatedAt:
 *           type: string
 *           format: date-time
 *           example: "2024-01-15T10:30:00Z"
 *         wasReplaced:
 *           type: boolean
 *           example: false
 *           description: Whether this winner was replaced by another participant
 *         canReplaceWinner:
 *           type: boolean
 *           description: Whether the creator can replace this winner (computed on winners endpoints)
 *           example: true
 *         replaceBlockedReason:
 *           type: string
 *           nullable: true
 *           enum: [wait_claim_deadline, gift_claimed, gift_delivered, gift_linked_to_place]
 *           description: Why replacement/removal is blocked; gift_linked_to_place when a gift is pinned to the prize place; null when canReplaceWinner is true
 *         replaceAvailableAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *           description: When replacement becomes allowed (claim deadline); set when replaceBlockedReason is wait_claim_deadline
 *         replacedWinnerUuid:
 *           type: string
 *           format: uuid
 *           nullable: true
 *           example: "550e8400-e29b-41d4-a716-446655440000"
 *           description: UUID of the winner that this participant replaced (if applicable)
 *         uuid:
 *           type: string
 *           format: uuid
 *           example: "550e8400-e29b-41d4-a716-446655440000"
 *         user:
 *           type: object
 *           properties:
 *             id:
 *               type: integer
 *               example: 1
 *             username:
 *               type: string
 *               example: "john_doe"
 *             first_name:
 *               type: string
 *               example: "John"
 *             last_name:
 *               type: string
 *               example: "Doe"
 *             photo_url:
 *               type: string
 *               example: "https://censored-link.com/photo.jpg"
 *         giveaway:
 *           $ref: '#/components/schemas/GiveawayDto'
 *         wonPrize:
 *           nullable: true
 *           description: Prize won by this participant (null if no prize linked or giveaway has no prizes)
 *           allOf:
 *             - $ref: '#/components/schemas/GiveawayPrizeDto'

 *     ChannelDto:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: int64
 *           description: BigInt channel ID from Telegram
 *           example: "1234567890"
 *         photo:
 *           type: string
 *           nullable: true
 *           example: "https://censored-link.com/channel_photo.jpg"
 *         username:
 *           type: string
 *           nullable: true
 *           example: "@mychannel"
 *         title:
 *           type: string
 *           nullable: true
 *           example: "My Awesome Channel"
 *         type:
 *           type: string
 *           nullable: true
 *           example: "channel"
 *         inviteLink:
 *           type: string
 *           nullable: true
 *           example: "https://t.me/+AbCdEfGhIjKlMnOp"
 *         isActive:
 *           type: boolean
 *           example: true
 *         createdAt:
 *           type: string
 *           format: date-time
 *           example: "2024-01-15T10:30:00Z"
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           example: "2024-01-15T10:30:00Z"
 *         isSponsor:
 *           type: boolean
 *           example: false
 *           description: Whether this channel is a co-sponsor (not owned by the giveaway creator). Only present in giveaway context.
 *
 *     SyncedChannelDto:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           example: "-1001234567890"
 *         title:
 *           type: string
 *           nullable: true
 *         username:
 *           type: string
 *           nullable: true
 *         photo:
 *           type: string
 *           nullable: true
 *         type:
 *           type: string
 *           nullable: true
 *         isActive:
 *           type: boolean
 *         botCanPostMessages:
 *           type: boolean
 *         botCanInviteUsers:
 *           type: boolean
 *
 *     JointPaymentQuoteDto:
 *       type: object
 *       properties:
 *         starsAmount:
 *           type: integer
 *           example: 100
 *         walletBalance:
 *           type: integer
 *           example: 250
 *         canPayFromWallet:
 *           type: boolean
 *         canPayFromTelegram:
 *           type: boolean
 *         labels:
 *           type: object
 *           properties:
 *             wallet:
 *               type: string
 *               example: "Оплатити з балансу"
 *             telegram:
 *               type: string
 *               example: "Оплатити з телеграма"
 *         endpoints:
 *           type: object
 *           properties:
 *             wallet:
 *               type: string
 *               example: "POST /api/giveaways/{giveawayId}/joints"
 *             telegram:
 *               type: string
 *               example: "POST /api/giveaways/{giveawayId}/joints/invoice"
 *
 *     SponsorChannelDto:
 *       type: object
 *       description: Channel object with sponsor indicator for search results
 *       allOf:
 *         - $ref: '#/components/schemas/ChannelDto'
 *         - type: object
 *           properties:
 *             isSponsor:
 *               type: boolean
 *               example: true
 *               description: Indicates this channel can be used as a sponsor
 *
 *     PaginatedSponsorChannelsResponse:
 *       type: object
 *       properties:
 *         items:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/SponsorChannelDto'
 *         meta:
 *           $ref: '#/components/schemas/PaginationMetaDto'

 *     SponsorLinkDto:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           example: 1
 *         title:
 *           type: string
 *           example: "Visit our website"
 *         link:
 *           type: string
 *           example: "https://censored-link.com"
 *         imageUrl:
 *           type: string
 *           nullable: true
 *           example: "https://censored-link.com/preview-image.jpg"
 *           description: Preview image URL (automatically fetched from link metadata)

 *     SponsorsDto:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           example: 1
 *         giveawayId:
 *           type: string
 *           format: uuid
 *           example: "550e8400-e29b-41d4-a716-446655440000"
 *         sponsorType:
 *           type: string
 *           enum: [Link, Channel]
 *           example: "Channel"
 *         sponsorLinkId:
 *           type: integer
 *           nullable: true
 *           example: null
 *         sponsorChannelId:
 *           type: string
 *           format: int64
 *           nullable: true
 *           example: "1234567890"
 *           description: BigInt channel ID of sponsor channel
 *         sponsorLink:
 *           $ref: '#/components/schemas/SponsorLinkDto'
 *         sponsorChannel:
 *           $ref: '#/components/schemas/ChannelDto'

 *     LinkedChannelsDto:
 *       type: object
 *       properties:
 *         channelId:
 *           type: string
 *           format: int64
 *           example: "1234567890"
 *           description: BigInt channel ID
 *         giveawayId:
 *           type: string
 *           format: uuid
 *           example: "550e8400-e29b-41d4-a716-446655440000"
 *         channel:
 *           allOf:
 *             - $ref: '#/components/schemas/ChannelDto'
 *             - type: object
 *               properties:
 *                 isSponsor:
 *                   type: boolean
 *                   example: false
 *                   description: "True when the authenticated user did NOT add this channel (or when unauthenticated). Sponsor channels require an approval request before the announcement is posted."
 *                 isCreator:
 *                   type: boolean
 *                   example: true
 *                   description: "True when the authenticated user added this channel (i.e. they own it). Only present when the request is authenticated."
 *         isPostingResults:
 *           type: boolean
 *           example: false
 *           description: "Per-channel result setting (sponsor channels only). Defaults to false - winner and cancel announcements are NOT sent to sponsor channels unless the channel owner explicitly enables this via PATCH /:giveawayId/channel-settings."
 *         isResultsInMainPost:
 *           type: boolean
 *           example: false
 *           description: "Per-channel result setting (sponsor channels only). When true, results are appended to the original giveaway post as a blockquote instead of sending a separate reply message."
 *         isCommentsOn:
 *           type: boolean
 *           example: false
 *           description: "Per-channel result setting (sponsor channels only). When true, a comments hyperlink is appended to the result text instead of using an inline button keyboard."
 *         role:
 *           type: string
 *           enum: [All, Posting, Subscription]
 *           example: "All"
 *           description: "All: posting + subscription required (legacy default). Posting: giveaway is posted here but no subscription check. Subscription: users must subscribe but giveaway is not posted here."

 *     PostlotPublicationDto:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           example: 1
 *         giveawayId:
 *           type: string
 *           format: uuid
 *           example: "550e8400-e29b-41d4-a716-446655440000"
 *         channelId:
 *           type: string
 *           format: int64
 *           example: "1234567890"
 *           description: BigInt Telegram channel ID
 *         publishedById:
 *           type: integer
 *           example: 1
 *         messageIds:
 *           type: array
 *           items:
 *             type: string
 *             format: int64
 *           example: ["12345", "12346"]
 *           description: Telegram message IDs posted to this channel
 *         createdAt:
 *           type: string
 *           format: date-time
 *           example: "2024-01-15T10:30:00Z"
 *         channel:
 *           $ref: '#/components/schemas/ChannelDto'
 *         publishedBy:
 *           $ref: '#/components/schemas/UserDto'

 *     GiveawayReferralDto:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           example: 1
 *         giveawayId:
 *           type: string
 *           format: uuid
 *           example: "550e8400-e29b-41d4-a716-446655440000"
 *         referrerId:
 *           type: integer
 *           example: 1
 *         referredId:
 *           type: integer
 *           example: 2
 *         hasParticipated:
 *           type: boolean
 *           example: true
 *         createdAt:
 *           type: string
 *           format: date-time
 *           example: "2024-01-15T10:30:00Z"
 *         giveaway:
 *           $ref: '#/components/schemas/GiveawayDto'
 *         referrer:
 *           $ref: '#/components/schemas/UserDto'
 *         referred:
 *           $ref: '#/components/schemas/UserDto'

 *     UserActivityDto:
 *       type: object
 *       properties:
 *         userId:
 *           type: integer
 *           example: 1
 *         ip:
 *           type: string
 *           example: "192.168.1.1"
 *         lastActivityAt:
 *           type: string
 *           format: date-time
 *           example: "2024-01-15T10:30:00Z"

 *     PaginationMetaDto:
 *       type: object
 *       properties:
 *         page:
 *           type: integer
 *           example: 1
 *         pageSize:
 *           type: integer
 *           example: 20
 *         pageCount:
 *           type: integer
 *           example: 5
 *         total:
 *           type: integer
 *           example: 100
 *         prevPage:
 *           type: integer
 *           nullable: true
 *           example: null
 *         nextPage:
 *           type: integer
 *           nullable: true
 *           example: 2

 *     PaginatedGiveawaysResponse:
 *       type: object
 *       properties:
 *         items:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/GiveawayDto'
 *         meta:
 *           $ref: '#/components/schemas/PaginationMetaDto'

 *     PaginatedUsersResponse:
 *       type: object
 *       properties:
 *         items:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/UserDto'
 *         meta:
 *           $ref: '#/components/schemas/PaginationMetaDto'

 *     PaginatedParticipantsResponse:
 *       type: object
 *       properties:
 *         items:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/ParticipantDto'
 *         meta:
 *           $ref: '#/components/schemas/PaginationMetaDto'

 *     PaginatedChannelsResponse:
 *       type: object
 *       properties:
 *         items:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/ChannelDto'
 *         meta:
 *           $ref: '#/components/schemas/PaginationMetaDto'

 *     SetLanguageRequestDto:
 *       type: object
 *       required:
 *         - lang
 *       properties:
 *         lang:
 *           type: string
 *           enum: [en, uk, ru]
 *           example: "en"

 *     PaySubscriptionRequestDto:
 *       type: object
 *       required:
 *         - tariffId
 *       properties:
 *         tariffId:
 *           type: integer
 *           example: 1

 *     PaySubscriptionResponseDto:
 *       type: object
 *       properties:
 *         subscription:
 *           $ref: '#/components/schemas/SubscribersDto'
 *         newBalance:
 *           type: object
 *           properties:
 *             starsBalance:
 *               type: number
 *               format: float
 *               example: 50.50
 *             tonBalance:
 *               type: number
 *               format: float
 *               example: 2.75

 *     StandardSuccessResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         data:
 *           type: object

 *     NotificationListDto:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           example: 1
 *         userId:
 *           type: integer
 *           example: 1
 *         channelId:
 *           type: string
 *           format: int64
 *           example: "1234567890"
 *           description: BigInt channel ID
 *         channel:
 *           $ref: '#/components/schemas/ChannelDto'
 *
 *     ErrorResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: false
 *         code:
 *           type: integer
 *           example: 40001
 *         message:
 *           type: string
 *           example: "Error message"
 *         errors:
 *           type: array
 *           items:
 *             type: object
 *
 *     TemplateDto:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *           example: "550e8400-e29b-41d4-a716-446655440000"
 *           description: Template ID
 *         userId:
 *           type: integer
 *           example: 1
 *           description: Creator user ID
 *         giveawayId:
 *           type: string
 *           format: uuid
 *           example: "550e8400-e29b-41d4-a716-446655440000"
 *           description: Referenced giveaway ID
 *         name:
 *           type: string
 *           nullable: true
 *           example: "My Lottery Template"
 *           description: Optional template name (max 100 characters)
 *         createdAt:
 *           type: string
 *           format: date-time
 *           example: "2024-01-15T10:30:00Z"
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           example: "2024-01-15T10:30:00Z"
 *         giveaway:
 *           $ref: '#/components/schemas/GiveawayDto'
 *         user:
 *           $ref: '#/components/schemas/UserDto'
 *
 *     StatsOwnerSummaryDto:
 *       type: object
 *       properties:
 *         giveawaysCreated:
 *           type: integer
 *           example: 25
 *           description: Total giveaways created in the selected period
 *         lotteryCreated:
 *           type: integer
 *           example: 10
 *           description: Lottery-type giveaways created in the selected period
 *         randomCreated:
 *           type: integer
 *           example: 15
 *           description: Random-type giveaways created in the selected period
 *         totalBoosts:
 *           type: integer
 *           example: 150
 *           description: Total boost tickets earned by participants across all giveaways created in the period
 *         totalReferrals:
 *           type: integer
 *           example: 80
 *           description: Total referrals recorded across all giveaways created in the period
 *
 *     StatsUserSummaryDto:
 *       type: object
 *       properties:
 *         totalParticipations:
 *           type: integer
 *           example: 45
 *         lotteryParticipations:
 *           type: integer
 *           example: 20
 *         randomParticipations:
 *           type: integer
 *           example: 25
 *         totalWins:
 *           type: integer
 *           example: 5
 *           description: Occupied prize places won (main + additional winners; replaced holders excluded)
 *         lotteryWins:
 *           type: integer
 *           example: 3
 *           description: Occupied prize places in lottery giveaways
 *         randomWins:
 *           type: integer
 *           example: 2
 *           description: Occupied prize places in random giveaways
 *
 *     StatsOwnerRecordDto:
 *       type: object
 *       description: Single time-series data point for owner mode
 *       properties:
 *         period:
 *           type: string
 *           format: date-time
 *           example: "2026-03-01T00:00:00.000Z"
 *           description: Start of the time bucket (hour/day/week/month depending on timeline)
 *         total:
 *           type: integer
 *           example: 3
 *         lottery:
 *           type: integer
 *           example: 1
 *         random:
 *           type: integer
 *           example: 2
 *
 *     StatsUserRecordDto:
 *       type: object
 *       description: Single time-series data point for user mode
 *       properties:
 *         period:
 *           type: string
 *           format: date-time
 *           example: "2026-03-01T00:00:00.000Z"
 *         participations:
 *           type: integer
 *           example: 3
 *         wins:
 *           type: integer
 *           example: 1
 *         lottery:
 *           type: integer
 *           example: 2
 *         random:
 *           type: integer
 *           example: 1
 *
 *     TopOwnerEntryDto:
 *       type: object
 *       properties:
 *         rank:
 *           type: integer
 *           example: 1
 *         id:
 *           type: integer
 *           example: 5
 *         username:
 *           type: string
 *           nullable: true
 *           example: "creator_user"
 *         first_name:
 *           type: string
 *           example: "Anna"
 *         last_name:
 *           type: string
 *           nullable: true
 *           example: null
 *         photo_url:
 *           type: string
 *           example: "https://censored-link.com/photo.jpg"
 *         giveawaysCreated:
 *           type: integer
 *           example: 42
 *         lotteryCreated:
 *           type: integer
 *           example: 20
 *         randomCreated:
 *           type: integer
 *           example: 22
 *         totalBoosts:
 *           type: integer
 *           example: 310
 *         totalReferrals:
 *           type: integer
 *           example: 180
 *
 *     TopUserEntryDto:
 *       type: object
 *       properties:
 *         rank:
 *           type: integer
 *           example: 1
 *         id:
 *           type: integer
 *           example: 12
 *         username:
 *           type: string
 *           nullable: true
 *           example: "top_player"
 *         first_name:
 *           type: string
 *           example: "Ivan"
 *         last_name:
 *           type: string
 *           nullable: true
 *           example: "Doe"
 *         photo_url:
 *           type: string
 *           example: "https://censored-link.com/photo.jpg"
 *         totalParticipations:
 *           type: integer
 *           example: 150
 *         lotteryParticipations:
 *           type: integer
 *           example: 80
 *         randomParticipations:
 *           type: integer
 *           example: 70
 *         totalWins:
 *           type: integer
 *           example: 15
 *           description: Occupied prize places won (main + additional winners; replaced holders excluded)
 *         lotteryWins:
 *           type: integer
 *           example: 9
 *           description: Occupied prize places in lottery giveaways
 *         randomWins:
 *           type: integer
 *           example: 6
 *           description: Occupied prize places in random giveaways
 *
 *     GiveawayPrizeDto:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           example: 1
 *         ownedGiftId:
 *           type: string
 *           nullable: true
 *           example: "AgADAgADxRYAAhAjSVN0v3HiEr2RAQIDBA"
 *           description: Telegram owned_gift_id (UniqueGift only; null for StandardGift)
 *         prizeType:
 *           type: string
 *           enum: [UniqueGift, StandardGift]
 *           example: "UniqueGift"
 *           description: UniqueGift = NFT deposited to business account; StandardGift = catalog gift bought at delivery time
 *         telegramGiftId:
 *           type: string
 *           nullable: true
 *           example: "gift_5Pmvsk3gD4u3aH"
 *           description: Telegram catalog gift ID (StandardGift only; null for UniqueGift)
 *         starCount:
 *           type: integer
 *           nullable: true
 *           example: 50
 *           description: Catalog price in Stars at time of linking (StandardGift only)
 *         claimDeadline:
 *           type: string
 *           format: date-time
 *           nullable: true
 *           example: "2024-01-16T10:30:00Z"
 *           description: Deadline for winner to accept a won prize (ReadyToClaim only; null on Available withdraw rows in GET /prizes/my)
 *         giftName:
 *           type: string
 *           nullable: true
 *           example: "Snoop Dogg"
 *           description: Human-readable display name (base_name for UniqueGift; emoji for StandardGift)
 *         giftNumber:
 *           type: string
 *           nullable: true
 *           example: "5179"
 *           description: Unique serial number of the gift (UniqueGift only; null for StandardGift)
 *         giftNftName:
 *           type: string
 *           nullable: true
 *           example: "SnoopDogg-5179"
 *           description: Unique gift slug used in t.me/nft/ links (UniqueGift only)
 *         giftBaseName:
 *           type: string
 *           nullable: true
 *           example: "Snoop Dogg"
 *           description: Human-readable name of the regular gift this was upgraded from (UniqueGift only)
 *         modelName:
 *           type: string
 *           nullable: true
 *           example: "Snoop Dogg"
 *           description: Name of the unique gift model component (UniqueGift only)
 *         symbolName:
 *           type: string
 *           nullable: true
 *           example: "Cannabis Leaf"
 *           description: Name of the unique gift symbol component (UniqueGift only)
 *         backdropName:
 *           type: string
 *           nullable: true
 *           example: "Purple Haze"
 *           description: Name of the unique gift backdrop component (UniqueGift only)
 *         modelRarityPermille:
 *           type: integer
 *           nullable: true
 *           example: 15
 *           description: Model rarity per 1000 upgraded gifts (UniqueGift only)
 *         symbolRarityPermille:
 *           type: integer
 *           nullable: true
 *           example: 5
 *           description: Symbol/pattern rarity per 1000 upgraded gifts (UniqueGift only)
 *         backdropRarityPermille:
 *           type: integer
 *           nullable: true
 *           example: 12
 *           description: Backdrop rarity per 1000 upgraded gifts (UniqueGift only)
 *         backdropCenterColor:
 *           type: integer
 *           nullable: true
 *           example: 1179392
 *           description: Backdrop center color as Telegram RGB24 int (UniqueGift only)
 *         backdropEdgeColor:
 *           type: integer
 *           nullable: true
 *           example: 12303291
 *           description: Backdrop edge color as Telegram RGB24 int (UniqueGift only)
 *         backdropPatternColor:
 *           type: integer
 *           nullable: true
 *           example: 16759788
 *           description: Backdrop pattern color as Telegram RGB24 int (UniqueGift only)
 *         backdropTextColor:
 *           type: integer
 *           nullable: true
 *           example: 16777215
 *           description: Backdrop text color as Telegram RGB24 int (UniqueGift only)
 *         modelStickerFileId:
 *           type: string
 *           nullable: true
 *           example: "CAACAgIAAxkBAAI..."
 *           description: Telegram file_id of the model TGS sticker (UniqueGift model; or base sticker for regular gifts)
 *         symbolStickerFileId:
 *           type: string
 *           nullable: true
 *           example: "CAACAgIAAxkBAAI..."
 *           description: Telegram file_id of the symbol TGS sticker (UniqueGift only)
 *         modelStickerPath:
 *           type: string
 *           nullable: true
 *           example: "/static/gift-stickers/5436132693433672122.tgs"
 *           description: Server path to the downloaded model TGS animation file (typically named by Telegram sticker file_id)
 *         symbolStickerPath:
 *           type: string
 *           nullable: true
 *           example: "/static/gift-stickers/5301072507598550489-thumb.webp"
 *           description: Static preview for symbol (jpg/png/webp thumb from MTProto)
 *         modelStickerGifPath:
 *           type: string
 *           nullable: true
 *           example: "/static/gift-stickers/5436132693433672122.gif"
 *           description: Looping GIF animation for model (frontend img tag; null if ffmpeg conversion unavailable)
 *         symbolStickerGifPath:
 *           type: string
 *           nullable: true
 *           example: "/static/gift-stickers/5301072507598550489.gif"
 *           description: Looping GIF animation for symbol pattern (null if not convertible)
 *         modelStickerGifPosterPath:
 *           type: string
 *           nullable: true
 *           example: "/static/gift-stickers/5436132693433672122-poster.png"
 *           description: Static PNG — first frame of model GIF (use when animation is paused or for lists)
 *         symbolStickerGifPosterPath:
 *           type: string
 *           nullable: true
 *           example: "/static/gift-stickers/5301072507598550489-poster.png"
 *           description: Static PNG — first frame of symbol GIF animation
 *         commissionTransactionId:
 *           type: string
 *           nullable: true
 *           description: Wallet transaction id when claim commission was charged
 *         status:
 *           type: string
 *           enum: [Available, Linked, ReadyToClaim, Processing, Cooldown, Transferred, Failed]
 *           example: "Linked"
 *         winPlace:
 *           type: integer
 *           nullable: true
 *           example: 1
 *           description: Place this prize is assigned to (1 = 1st place), null if unordered
 *         commissionPaid:
 *           type: boolean
 *           example: false
 *           description: Whether the creator has pre-paid the transfer fee for this prize
 *         nextTransferDate:
 *           type: string
 *           format: date-time
 *           nullable: true
 *           example: null
 *           description: Earliest date to retry transfer (set when status is Cooldown)
 *         transferredAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *           example: null
 *         depositedByUserId:
 *           type: integer
 *           example: 42
 *         giveawayId:
 *           type: string
 *           format: uuid
 *           nullable: true
 *           example: "550e8400-e29b-41d4-a716-446655440000"
 *         winnerUserId:
 *           type: integer
 *           nullable: true
 *           example: null
 *         createdAt:
 *           type: string
 *           format: date-time
 *           example: "2024-01-15T10:30:00Z"
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           example: "2024-01-15T10:30:00Z"
 */
