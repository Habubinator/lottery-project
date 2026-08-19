export type Language = 'en' | 'ru' | 'ua';

/**
 * Determine user's preferred language
 * Priority: picked_language > language_code > default 'en'
 */
export function getUserLanguage(user: {
  picked_language?: string;
  language_code?: string;
}): Language {
  const lang = user.picked_language || user.language_code || 'en';
  if (lang.startsWith('uk') || lang.startsWith('ua')) return 'ua';
  if (lang.startsWith('ru')) return 'ru';
  return 'en';
}

/**
 * Normalize giveaway language to internal language code
 * Maps 'uk' → 'ua' for consistency
 */
export function normalizeGiveawayLanguage(giveawayLang?: string): Language {
  if (!giveawayLang) return 'en';

  const lang = giveawayLang.toLowerCase();
  if (lang.startsWith('uk') || lang.startsWith('ua')) return 'ua';
  if (lang.startsWith('ru')) return 'ru';
  return 'en';
}

const LANGUAGE_LOCALES: Record<Language, string> = {
  en: 'en-US',
  ru: 'ru-RU',
  ua: 'uk-UA',
};

export function formatUtcDateForLanguage(date: Date, lang: Language): string {
  return `${new Intl.DateTimeFormat(LANGUAGE_LOCALES[lang], {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(date)} UTC`;
}

export const WELCOME_MESSAGES = {
  en: '🎉 Thank you for adding! Your chat is now connected to our bot.',
  ru: '🎉 Спасибо за добавление! Теперь ваш чат подключен к нашему боту.',
  ua: '🎉 Дякуємо за додавання! Тепер ваш чат підключено до нашого бота.',
};

export const START_MESSAGES = {
  welcomeText: {
    en: `🍀 GIVEAWAY & BATTLES — a new level of giveaways!

🎉 Giveaways are no longer limited to simple participation conditions.
We've created a tool that meets modern requirements and helps you work with your audience effectively.

📱 Convenience
Intuitive interface and simple management — everything for comfortable use without unnecessary complexity.

⚙️ Powerful functionality
With our bot you can:
• attract your target audience to channels and groups
• create and edit giveaways
• filter participants by required parameters
• automate the entire process

🛡 Protection and control
Control every stage of the giveaway, verify participants and ensure a fair result.`,

    ru: `🍀 GIVEAWAY & BATTLES — новый уровень розыгрышей!

🎉 Розыгрыши больше не ограничиваются простыми условиями участия.
Мы создали инструмент, отвечающий современным требованиям и помогающий эффективно работать с аудиторией.

📱 Удобство
Интуитивный интерфейс и простое управление — всё для комфортного использования без лишних сложностей.

⚙️ Мощный функционал
С нашим ботом вы можете:
• привлекать целевую аудиторию в каналы и группы
• создавать и редактировать розыгрыши
• фильтровать участников по нужным параметрам
• автоматизировать процессы проведения

🛡 Защита и контроль
Контролируйте каждый этап розыгрыша, проверяйте участников и обеспечивайте честный результат.`,

    ua: `🍀 GIVEAWAY & BATTLES — новий рівень розіграшів!

🎉 Розіграші більше не обмежуються простими умовами участі.
Ми створили інструмент, який відповідає сучасним вимогам та допомагає вам ефективно працювати з аудиторією.

📱 Зручність
Інтуїтивний інтерфейс і просте керування — усе для комфортного користування без зайвих складнощів.

⚙️ Потужний функціонал
З нашим ботом ви можете:
• залучати цільову аудиторію у канали та групи
• створювати та редагувати розіграші
• фільтрувати учасників за потрібними параметрами
• автоматизувати процеси проведення

🛡 Захист та контроль
Контролюйте кожен етап розіграшу, перевіряйте учасників і забезпечуйте чесний результат.`,
  },
  openAppButton: {
    en: '🎮 Open App',
    ru: '🎮 Открыть приложение',
    ua: '🎮 Відкрити додаток',
  },
  adminPanelButton: {
    en: '⚙️ Admin Panel',
    ru: '⚙️ Панель администратора',
    ua: '⚙️ Адмін панель',
  },
};

/**
 * Get medal emoji based on place
 */
export function getMedalEmoji(place: number): string {
  switch (place) {
    case 1:
      return '🥇';
    case 2:
      return '🥈';
    case 3:
      return '🥉';
    default:
      return ` ${place.toString()} `; // Add leading and trailing space for numbers
  }
}

/**
 * Notification translations for giveaway/lottery creation
 */
export const GIVEAWAY_CREATION_MESSAGES = {
  lottery: {
    en: {
      giveawayWord: 'lottery',
      verbForm: 'a new',
      buttonText: 'View lottery',
      caption: (userName: string, channelLinks: string) =>
        `${userName}, we inform you that a new lottery has appeared on the channel ${channelLinks} from your notification list!`,
    },
    ru: {
      giveawayWord: 'лотерея',
      verbForm: 'появилась новая',
      buttonText: 'Посмотреть лотерею',
      caption: (userName: string, channelLinks: string) =>
        `${userName}, сообщаем Вам о том, что на канале ${channelLinks} из списка ваших уведомлений появилась новая лотерея!`,
    },
    ua: {
      giveawayWord: 'лотерея',
      verbForm: "з'явилась нова",
      buttonText: 'Переглянути лотерею',
      caption: (userName: string, channelLinks: string) =>
        `${userName}, повідомляємо Вам про те, що на каналі ${channelLinks} зі списку ваших сповіщень з'явилась нова лотерея!`,
    },
  },
  random: {
    en: {
      giveawayWord: 'giveaway',
      verbForm: 'a new',
      buttonText: 'View giveaway',
      caption: (userName: string, channelLinks: string) =>
        `${userName}, we inform you that a new giveaway has appeared on the channel ${channelLinks} from your notification list!`,
    },
    ru: {
      giveawayWord: 'розыгрыш',
      verbForm: 'появился новый',
      buttonText: 'Посмотреть розыгрыш',
      caption: (userName: string, channelLinks: string) =>
        `${userName}, сообщаем Вам о том, что на канале ${channelLinks} из списка ваших уведомлений появился новый розыгрыш!`,
    },
    ua: {
      giveawayWord: 'розіграш',
      verbForm: "з'явився новий",
      buttonText: 'Переглянути розіграш',
      caption: (userName: string, channelLinks: string) =>
        `${userName}, повідомляємо Вам про те, що на каналі ${channelLinks} зі списку ваших сповіщень з'явився новий розіграш!`,
    },
  },
};

/**
 * Introductory text for giveaway/lottery posts (when no description provided)
 */
export const GIVEAWAY_POST_INTRO = {
  en: {
    lottery: '🎁 The battle for prizes has begun! Grab your ticket.',
    giveaway: '🎁 Ready to win? The giveaway has started!',
  },
  ru: {
    lottery: '🎁 Битва за призы началась! Хватай свой билет.',
    giveaway: '🎁 Готовы выигрывать? Розыгрыш стартовал!',
  },
  ua: {
    lottery: '🎁 Боротьба за призи почалася! Забирай свій квиток.',
    giveaway: '🎁 Готові вигравати? Розіграш стартував!',
  },
};

/**
 * Notification translations for win messages
 */
export const WIN_MESSAGES = {
  lottery: {
    en: {
      giveawayWord: 'lottery',
      buttonText: 'Lottery Results',
      caption: (userName: string) =>
        `🎉<b>${userName}</b>, congratulations on winning the lottery!\nCheck the results in the app and await news from the lottery owner!`,
    },
    ru: {
      giveawayWord: 'лотереи',
      buttonText: 'Результаты лотереи',
      caption: (userName: string) =>
        `🎉<b>${userName}</b>, поздравляем с победой в лотерее!\nПроверьте результаты в приложении и ожидайте новостей от владельца лотереи!`,
    },
    ua: {
      giveawayWord: 'лотереї',
      buttonText: 'Результати лотереї',
      caption: (userName: string) =>
        `🎉<b>${userName}</b>, вітаємо з перемогою у лотереї!\nПеревірте результати в додатку, та очікуйте новин від власника лотереї!`,
    },
  },
  random: {
    en: {
      giveawayWord: 'giveaway',
      buttonText: 'Giveaway Results',
      caption: (userName: string) =>
        `🎉<b>${userName}</b>, congratulations on winning the giveaway!\nCheck the results in the app and await news from the giveaway owner!`,
    },
    ru: {
      giveawayWord: 'розыгрыше',
      buttonText: 'Результаты розыгрыша',
      caption: (userName: string) =>
        `🎉<b>${userName}</b>, поздравляем с победой в розыгрыше!\nПроверьте результаты в приложении и ожидайте новостей от владельца розыгрыша!`,
    },
    ua: {
      giveawayWord: 'розіграші',
      buttonText: 'Результати розіграшу',
      caption: (userName: string) =>
        `🎉<b>${userName}</b>, вітаємо з перемогою у розіграші!\nПеревірте результати в додатку, та очікуйте новин від власника розіграшу!`,
    },
  },
};

/**
 * Notification translations for winner replacement
 */
export const WINNER_REPLACEMENT_MESSAGES = {
  oldWinner: {
    lottery: {
      en: {
        buttonText: 'Lottery results',
        caption: (userName: string) =>
          `<b>${userName}</b>, we inform you that you have been reassigned in the lottery.`,
      },
      ru: {
        buttonText: 'Результаты лотереи',
        caption: (userName: string) =>
          `<b>${userName}</b>, сообщаем Вам о том, что вы были переназначены в лотерее.`,
      },
      ua: {
        buttonText: 'Результати лотереї',
        caption: (userName: string) =>
          `<b>${userName}</b>, повідомляємо Вам про те, що ви були переназначені в лотереї.`,
      },
    },
    random: {
      en: {
        buttonText: 'Giveaway results',
        caption: (userName: string) =>
          `<b>${userName}</b>, we inform you that you have been reassigned in the giveaway.`,
      },
      ru: {
        buttonText: 'Результаты розыгрыша',
        caption: (userName: string) =>
          `<b>${userName}</b>, сообщаем Вам о том, что вы были переназначены в розыгрыше.`,
      },
      ua: {
        buttonText: 'Результати розіграшу',
        caption: (userName: string) =>
          `<b>${userName}</b>, повідомляємо Вам про те, що ви були переназначені в розіграші.`,
      },
    },
  },
  newWinner: {
    lottery: {
      en: {
        buttonText: 'Lottery results',
        caption: (userName: string, place?: number) =>
          place
            ? `${userName}, congratulations! You have been selected as a new winner in the lottery and received ${getMedalEmoji(place)} place!`
            : `${userName}, congratulations! You have been selected as a new winner in the lottery!`,
      },
      ru: {
        buttonText: 'Результаты лотереи',
        caption: (userName: string, place?: number) =>
          place
            ? `${userName}, поздравляем! Вы были выбраны новым победителем лотереи и получили ${getMedalEmoji(place)} место!`
            : `${userName}, поздравляем! Вы были выбраны новым победителем лотереи!`,
      },
      ua: {
        buttonText: 'Результати лотереї',
        caption: (userName: string, place?: number) =>
          place
            ? `${userName}, вітаємо! Вас обрано новим переможцем лотереї і ви отримали ${getMedalEmoji(place)} місце!`
            : `${userName}, вітаємо! Вас обрано новим переможцем лотереї!`,
      },
    },
    random: {
      en: {
        buttonText: 'Giveaway results',
        caption: (userName: string) =>
          `${userName}, congratulations! You have been selected as a new winner in the giveaway!`,
      },
      ru: {
        buttonText: 'Результаты розыгрыша',
        caption: (userName: string) =>
          `${userName}, поздравляем! Вы были выбраны новым победителем розыгрыша!`,
      },
      ua: {
        buttonText: 'Результати розіграшу',
        caption: (userName: string) =>
          `${userName}, вітаємо! Вас обрано новим переможцем розіграшу!`,
      },
    },
  },
};

/**
 * Notification translations for winner removal
 */
export const WINNER_REMOVAL_MESSAGES = {
  lottery: {
    en: {
      buttonText: 'Lottery results',
      caption: (userName: string, place?: number) =>
        place
          ? `${userName}, unfortunately, you have been removed from the winners list of the lottery. Your ${getMedalEmoji(place)} place has been revoked.`
          : `${userName}, unfortunately, you have been removed from the winners list of the lottery.`,
    },
    ru: {
      buttonText: 'Результаты лотереи',
      caption: (userName: string, place?: number) =>
        place
          ? `${userName}, к сожалению, вас удалили из списка победителей лотереи. Ваше ${getMedalEmoji(place)} место было аннулировано.`
          : `${userName}, к сожалению, вас удалили из списка победителей лотереи.`,
    },
    ua: {
      buttonText: 'Результати лотереї',
      caption: (userName: string, place?: number) =>
        place
          ? `${userName}, на жаль, вас видалено зі списку переможців лотереї. Ваше ${getMedalEmoji(place)} місце було анульовано.`
          : `${userName}, на жаль, вас видалено зі списку переможців лотереї.`,
    },
  },
  random: {
    en: {
      buttonText: 'Giveaway results',
      caption: (userName: string) =>
        `${userName}, unfortunately, you have been removed from the winners list of the giveaway.`,
    },
    ru: {
      buttonText: 'Результаты розыгрыша',
      caption: (userName: string) =>
        `${userName}, к сожалению, вас удалили из списка победителей розыгрыша.`,
    },
    ua: {
      buttonText: 'Результати розіграшу',
      caption: (userName: string) =>
        `${userName}, на жаль, вас видалено зі списку переможців розіграшу.`,
    },
  },
};

/**
 * Giveaway requirements translations
 */
export const REQUIREMENTS_MESSAGES = {
  en: {
    boost: 'Make Boost',
    onlyPremium: 'Only Premium users',
    referrals: (count: number) => `Invite ${count} Friends or Acquaintances`,
    participationPrice: (price: number, currency: string) =>
      `Pay participiation fee <b>${price} ${currency}</b>`,
    staySubscribed:
      'Stay subscribed to all channels until the end of the giveaway',
    captcha: 'Pass captcha verification',
    geoRestrictions: 'Geographic restrictions apply',
  },
  ru: {
    boost: 'Сделать Boost',
    onlyPremium: 'Только пользователи с Premium',
    referrals: (count: number) => `Пригласить ${count} Друзей или Знакомых`,
    participationPrice: (price: number, currency: string) =>
      `Оплатить участие <b>${price} ${currency}</b>`,
    staySubscribed: 'Оставайтесь подписаны на все каналы до конца розыгрыша',
    captcha: 'Пройти проверку капча',
    geoRestrictions: 'Присутствуют географические ограничения',
  },
  ua: {
    boost: 'Зробити Boost',
    onlyPremium: 'Тільки користувачі з Premium',
    referrals: (count: number) => `Запросити ${count} Друзів або Знайомих`,
    participationPrice: (price: number, currency: string) =>
      `Оплатити участь <b>${price} ${currency}</b>`,
    staySubscribed: 'Залишайтесь підписані на всі канали до кінця розіграшу',
    captcha: 'Пройти перевірку капча',
    geoRestrictions: 'Присутні географічні обмеження',
  },
};

/**
 * Completion condition translations
 */
export const COMPLETION_CONDITION_MESSAGES = {
  en: {
    byCapacity: (count: number) => `${count} participants`,
    byCapacityTickets: (count: number) => `${count} tickets`,
    byTime: 'by time',
  },
  ru: {
    byCapacity: (count: number) => `${count} участников`,
    byCapacityTickets: (count: number) => `${count} билетов`,
    byTime: 'по времени',
  },
  ua: {
    byCapacity: (count: number) => `${count} учасників`,
    byCapacityTickets: (count: number) => `${count} квитків`,
    byTime: 'за часом',
  },
};

/**
 * Giveaway message format translations
 */
export const GIVEAWAY_MESSAGE_FORMAT = {
  en: {
    locale: 'en-US',
    information: 'Information:',
    ending: 'Ending:',
    completionConditions: 'Completion conditions:',
    subscriptions: 'Subscriptions:',
    otherLinks: 'Other links:',
    requirements: 'Requirements:',
  },
  ru: {
    locale: 'ru-RU',
    information: 'Информация:',
    ending: 'Завершение:',
    completionConditions: 'Условия завершения:',
    subscriptions: 'Подписки:',
    otherLinks: 'Другие ссылки:',
    requirements: 'Требования:',
  },
  ua: {
    locale: 'uk-UA',
    information: 'Інформація:',
    ending: 'Завершення:',
    completionConditions: 'Умови завершення:',
    subscriptions: 'Підписки:',
    otherLinks: 'Інші посилання:',
    requirements: 'Вимоги:',
  },
};

/**
 * Button text translations for giveaway participation
 */
export const BUTTON_TEXT_MESSAGES = {
  en: {
    participate: 'Participate',
    lotteryEnded: 'Lottery ended',
    giveawayEnded: 'Giveaway ended',
  },
  ru: {
    participate: 'Принять участие',
    lotteryEnded: 'Лотерея завершилась',
    giveawayEnded: 'Розыгрыш завершился',
  },
  ua: {
    participate: 'Прийняти участь',
    lotteryEnded: 'Лотерея завершилась',
    giveawayEnded: 'Розіграш завершився',
  },
};

/**
 * Localized strings for gift prizes sections in giveaway posts and notifications
 */
export const GIFT_PRIZE_MESSAGES = {
  en: {
    giftsHeader: '🎁 Gifts:',
    yourGift: '🎁Your gift:',
    claimGift: '🎁 Claim Gift',
    writeToGiftBank: '🏦 Write to Gift Bank',
    giftTransferred: (userName: string, giftName: string, giftNumber: string) =>
      `🎉<b>${userName}</b>, a gift has been sent to you, check it in your profile!\n\n🎁Your gift: ${giftName} #${giftNumber}`,
    giftTransferredBtn: 'View Gift',
    noConversation: (businessUsername: string) =>
      `🔥 Please send any sticker or text to @${businessUsername}\n\nYou will receive your gift within a few minutes of sending.`,
    claimCooldownUntil: (availableAt: string) =>
      `This gift is on cooldown and will become available after ${availableAt}.`,
    claimCooldownUnknown:
      'This gift is on cooldown and will become available later.',
    claimBankBalanceLow:
      'Insufficient balance on the gift bank account. Please try again later.',
  },
  ru: {
    giftsHeader: '🎁 Подарки:',
    yourGift: '🎁Ваш подарок:',
    claimGift: '🎁 Забрать подарок',
    writeToGiftBank: '🏦 Написать в банк подарков',
    giftTransferred: (userName: string, giftName: string, giftNumber: string) =>
      `🎉<b>${userName}</b>, Вам был передан подарок, просмотрите его в своём профиле!\n\n🎁Ваш подарок: ${giftName} #${giftNumber}`,
    giftTransferredBtn: 'Посмотреть подарок',
    noConversation: (businessUsername: string) =>
      `🔥 Пожалуйста, отправьте любой стикер или текст @${businessUsername}\n\nВы получите подарок в течение нескольких минут после отправки.`,
    claimCooldownUntil: (availableAt: string) =>
      `Этот подарок на кулдауне и снова станет доступен после ${availableAt}.`,
    claimCooldownUnknown:
      'Этот подарок сейчас на кулдауне и станет доступен позже.',
    claimBankBalanceLow:
      'В банковом аккаунте нехватка баланса. Повторите позже',
  },
  ua: {
    giftsHeader: '🎁 Подарунки:',
    yourGift: '🎁Ваш подарунок:',
    claimGift: '🎁 Забрати подарунок',
    writeToGiftBank: '🏦 Написати в банк подарунків',
    giftTransferred: (userName: string, giftName: string, giftNumber: string) =>
      `🎉<b>${userName}</b>, Вам був переданий подарунок, перегляньте його у своєму профілі!\n\n🎁Ваш подарунок: ${giftName} #${giftNumber}`,
    giftTransferredBtn: 'Переглянути подарунок',
    noConversation: (businessUsername: string) =>
      `🔥 Будь ласка, надішліть будь-яку наліпку або текст @${businessUsername}\n\nВи отримаєте подарунок протягом кількох хвилин після його відправлення.`,
    claimCooldownUntil: (availableAt: string) =>
      `Цей подарунок зараз на cooldown і знову стане доступним після ${availableAt}.`,
    claimCooldownUnknown:
      'Цей подарунок зараз на cooldown і стане доступним пізніше.',
    claimBankBalanceLow:
      'На банківському акаунті недостатньо балансу. Спробуйте пізніше',
  },
};

/**
 * Winners announcement translations
 */
export const WINNERS_ANNOUNCEMENT_MESSAGES = {
  en: {
    lottery: {
      title: "🏁 Lottery ended! It's time to find out who got lucky.",
      checkResults: 'CHECK RESULTS',
      checkResultsWithIcon: '🔍 Check results',
    },
    giveaway: {
      title: "🏁 Giveaway ended! It's time to find out who got lucky.",
      checkResults: 'CHECK RESULTS',
      checkResultsWithIcon: '🔍 Check results',
    },
    winners: '🏆Winners:',
    additionalWinners: '🏆Additional Winners:',
    claimWindowHint:
      'Winners have 24 hours to claim their gifts, after which replacement will be available.',
  },
  ru: {
    lottery: {
      title: '🏁 Лотерея завершена! Настало время узнать, кому повезло.',
      checkResults: 'ПРОВЕРИТЬ РЕЗУЛЬТАТЫ',
      checkResultsWithIcon: '🔍 Проверить результаты',
    },
    giveaway: {
      title: '🏁 Розыгрыш завершен! Настало время узнать, кому повезло.',
      checkResults: 'ПРОВЕРИТЬ РЕЗУЛЬТАТЫ',
      checkResultsWithIcon: '🔍 Проверить результаты',
    },
    winners: '🏆Победители:',
    additionalWinners: '🏆Дополнительные победители:',
    claimWindowHint:
      'У победителей есть 24 часа, чтобы забрать подарки, после чего будет доступна замена.',
  },
  ua: {
    lottery: {
      title: '🏁 Лотерею завершено! Настав час дізнатися, кому пощастило.',
      checkResults: 'ПЕРЕВІРИТИ РЕЗУЛЬТАТИ',
      checkResultsWithIcon: '🔍 Перевірити результати',
    },
    giveaway: {
      title: '🏁 Розіграш завершено! Настав час дізнатися, кому пощастило.',
      checkResults: 'ПЕРЕВІРИТИ РЕЗУЛЬТАТИ',
      checkResultsWithIcon: '🔍 Перевірити результати',
    },
    winners: '🏆Переможці:',
    additionalWinners: '🏆Додаткові переможці:',
    claimWindowHint:
      'В переможців є 24 години щоб забрати подарунки, після чого буде доступна заміна.',
  },
};

/**
 * Giveaway cancellation messages
 */
export const GIVEAWAY_CANCEL_MESSAGES = {
  en: {
    // Manual cancellation by organizer
    defaultCancel: 'The giveaway has been cancelled by the organizer.',
    // Automatic cancellation due to no participants
    autoCancel:
      'The giveaway was automatically cancelled due to lack of participants.',
    // Button text for cancelled giveaway
    cancelledButton: 'Giveaway Cancelled',
    // Button text for cancelled lottery
    lotteryCancelledButton: 'Lottery Cancelled',
    // Blockquote header
    cancelReason: 'Cancellation Reason:',
  },
  ru: {
    defaultCancel: 'Проведение розыгрыша отменено организатором.',
    autoCancel:
      'Проведение розыгрыша автоматически отменено из-за отсутствия участников.',
    cancelledButton: 'Розыгрыш отменён',
    lotteryCancelledButton: 'Лотерея отменена',
    cancelReason: 'Причина отмены:',
  },
  ua: {
    defaultCancel: 'Проведення розіграшу скасовано організатором.',
    autoCancel:
      'Проведення розіграшу автоматично скасовано через відсутність учасників.',
    cancelledButton: 'Розіграш скасований',
    lotteryCancelledButton: 'Лотерея скасована',
    cancelReason: 'Причина скасування:',
  },
};

export const WINNERS_UPDATED_MESSAGES = {
  en: 'UPD: Changes made!',
  ru: 'UPD: Внесены изменения!',
  ua: 'UPD: Внесені зміни!',
};

/**
 * Giveaway error messages
 */
export const GIVEAWAY_ERROR_MESSAGES = {
  en: {
    cannotFinishNoParticipants:
      'Cannot finish giveaway with no participants. Please cancel instead.',
    cannotFinishInsufficientParticipantsForGifts:
      'Cannot finish early: need at least as many participants as linked gifts so every prize place can be awarded. Cancel the giveaway instead.',
    cannotAddMultiplePhotos:
      'Cannot add multiple photos at once. Please add one photo first, then update to multiple photos.',
    cannotChangeSingleToMultiple:
      'Cannot change from single photo to multiple photos. This would change message type. Please delete existing banner first, then add multiple banners.',
    cannotChangeMultipleToSingle:
      'Cannot change from multiple photos to single photo. Please delete all existing banners first, then add a single banner.',
    negativeBalance:
      'Participation blocked: negative Stars balance. Please top up your balance.',
    cannotCancelActiveLottery: 'Cannot cancel an active lottery.',
    cannotCancelActiveGiveawayWithSponsorship:
      'Cannot cancel an active giveaway while sponsorship is enabled.',
    cannotChangeGiftsOnUpdate:
      'Gifts cannot be changed while editing a giveaway.',
    cannotChangeGiftsViaGiveawayUpdate:
      'Gifts cannot be changed via giveaway update.',
    cannotChangeWinningTicketCountLottery:
      'Winning ticket count cannot be changed for a lottery.',
    cannotDisableSponsorSearchLottery:
      'Sponsor search cannot be disabled or reduced for a lottery.',
    cannotDisableSponsorSearch:
      'Sponsor search cannot be disabled or reduced while sponsorship is enabled.',
    cannotRemoveSponsorLinks:
      'Sponsor links cannot be removed while sponsorship is enabled.',
    winnerCountFixedByLinkedGifts:
      'Winner count is set by linked gifts and cannot be changed.',
    winnerCountBelowMinimum: (min: number) =>
      `Winner count cannot be below ${min} (current participants or winners).`,
    ticketCapacityBelowMinimum: (min: number) =>
      `Ticket capacity cannot be below ${min} (winning tickets or tickets already sold).`,
    participantCapacityBelowWinnerCount: (count: number) =>
      `Participant capacity cannot be below the winner count (${count}).`,
    participantCapacityIncreaseOnlyWithSponsorship:
      'Participant capacity can only be increased while sponsorship is enabled.',
    participantCapacityBelowParticipantCount: (count: number) =>
      `Participant capacity cannot be below the current participant count (${count}).`,
    endTimeCannotBeBeforeNow: 'End time cannot be earlier than now.',
    endTimeCannotBeBeforeStart:
      'End time cannot be earlier than the start time.',
    startTimeCannotBeBeforeNow: 'Start time cannot be earlier than now.',
    endTimeExtendOnlyWithSponsorship:
      'End time can only be extended while sponsorship is enabled.',
    ticketPriceIncreaseOnlyActiveLottery:
      'Ticket price can only be increased for an active lottery.',
    cannotAddStandardGiftToLottery:
      'Standard catalog gifts cannot be added to a lottery.',
    winnerReplaceWaitClaimDeadline:
      'Winner replacement will be available in 24 hours!',
    winnerReplaceGiftClaimed:
      'Cannot replace this winner — they have already claimed their gift.',
    winnerReplaceGiftDelivered:
      'Cannot replace this winner — their gift has already been delivered.',
    winnerReplaceGiftLinkedToPlace:
      'Cannot remove or replace this winner — a gift is linked to their prize place.',
    additionalTicketsSourceRequired:
      'One of these parameters must be filled: referrals per ticket or boosts per ticket.',
    additionalTicketsMaxRequired:
      'Specify the maximum number of additional tickets.',
    boostChannelsRequired:
      'Select at least one channel or group for boost tickets.',
    boostedChannelRequired:
      'Select a channel or group for the boost requirement.',
    additionalTicketsRefsConflictNeededReferals:
      'Referral extra tickets cannot be enabled together with required friend invites for participation.',
    additionalTicketsBoostConflictRequired:
      'Boost extra tickets cannot be enabled together with required channel boost for participation.',
  },
  ru: {
    cannotFinishNoParticipants:
      'Невозможно завершить розыгрыш без участников. Пожалуйста, отмените его.',
    cannotFinishInsufficientParticipantsForGifts:
      'Нельзя завершить досрочно: участников должно быть не меньше, чем привязанных подарков, чтобы распределить все призовые места. Вместо этого отмените розыгрыш.',
    cannotAddMultiplePhotos:
      'Невозможно добавить несколько фото сразу. Сначала добавьте одно фото, затем обновите до нескольких.',
    cannotChangeSingleToMultiple:
      'Невозможно изменить одно фото на несколько. Это изменит тип сообщения. Сначала удалите существующий баннер, затем добавьте несколько.',
    cannotChangeMultipleToSingle:
      'Невозможно изменить несколько фото на одно. Сначала удалите все существующие баннеры, затем добавьте один.',
    negativeBalance:
      'Участие заблокировано: отрицательный баланс Stars. Пожалуйста, пополните баланс.',
    cannotCancelActiveLottery: 'Нельзя отменить активную лотерею.',
    cannotCancelActiveGiveawayWithSponsorship:
      'Нельзя отменить активный розыгрыш при включённом спонсорстве.',
    cannotChangeGiftsOnUpdate:
      'Подарки нельзя изменять при редактировании розыгрыша.',
    cannotChangeGiftsViaGiveawayUpdate:
      'Подарки нельзя изменить через обновление розыгрыша.',
    cannotChangeWinningTicketCountLottery:
      'Количество выигрышных билетов нельзя изменить в лотерее.',
    cannotDisableSponsorSearchLottery:
      'Поиск спонсоров нельзя отключить или уменьшить в лотерее.',
    cannotDisableSponsorSearch:
      'Поиск спонсоров нельзя отключить или уменьшить при включённом спонсорстве.',
    cannotRemoveSponsorLinks:
      'Ссылки спонсоров нельзя удалять при включённом спонсорстве.',
    winnerCountFixedByLinkedGifts:
      'Количество победителей задано подарками и не может быть изменено.',
    winnerCountBelowMinimum: (min: number) =>
      `Количество победителей не может быть меньше ${min} (текущие участники или победители).`,
    ticketCapacityBelowMinimum: (min: number) =>
      `Ёмкость билетов не может быть меньше ${min} (выигрышные билеты или уже проданные).`,
    participantCapacityBelowWinnerCount: (count: number) =>
      `Лимит участников не может быть меньше числа победителей (${count}).`,
    participantCapacityIncreaseOnlyWithSponsorship:
      'Лимит участников можно только увеличить при включённом спонсорстве.',
    participantCapacityBelowParticipantCount: (count: number) =>
      `Лимит участников не может быть меньше текущего числа участников (${count}).`,
    endTimeCannotBeBeforeNow:
      'Время окончания не может быть раньше текущего момента.',
    endTimeCannotBeBeforeStart:
      'Время окончания не может быть раньше времени старта.',
    startTimeCannotBeBeforeNow:
      'Время старта не может быть раньше текущего момента.',
    endTimeExtendOnlyWithSponsorship:
      'Время окончания можно только продлить при включённом спонсорстве.',
    ticketPriceIncreaseOnlyActiveLottery:
      'Цену билета можно только повысить для активной лотереи.',
    cannotAddStandardGiftToLottery:
      'Обычные подарки из каталога нельзя добавить в лотерею.',
    winnerReplaceWaitClaimDeadline:
      'Замена победителя будет доступна через 24 часа!',
    winnerReplaceGiftClaimed:
      'Нельзя заменить этого победителя — он уже забрал подарок.',
    winnerReplaceGiftDelivered:
      'Нельзя заменить этого победителя — подарок уже доставлен.',
    winnerReplaceGiftLinkedToPlace:
      'Нельзя удалить или заменить этого победителя — к призовому месту привязан подарок.',
    additionalTicketsSourceRequired:
      'Один из этих параметров должен быть заполнен: рефералы на билет или бусты на билет.',
    additionalTicketsMaxRequired:
      'Укажите максимальное количество дополнительных билетов.',
    boostChannelsRequired:
      'Выберите хотя бы один канал или группу для билетов за буст.',
    boostedChannelRequired: 'Выберите канал или группу для требования буста.',
    additionalTicketsRefsConflictNeededReferals:
      'Дополнительные билеты за приглашения нельзя включать вместе с обязательным приглашением друзей для участия.',
    additionalTicketsBoostConflictRequired:
      'Дополнительные билеты за буст нельзя включать вместе с обязательным бустом канала для участия.',
  },
  ua: {
    cannotFinishNoParticipants:
      'Неможливо завершити розіграш без учасників. Будь ласка, скасуйте його.',
    cannotFinishInsufficientParticipantsForGifts:
      'Неможливо завершити достроково: учасників має бути не менше, ніж прив’язаних подарунків, щоб роздати всі призові місця. Замість цього скасуйте розіграш.',
    cannotAddMultiplePhotos:
      'Неможливо додати кілька фото одразу. Спочатку додайте одне фото, потім оновіть до кількох.',
    cannotChangeSingleToMultiple:
      'Неможливо змінити одне фото на кілька. Це змінить тип повідомлення. Спочатку видаліть існуючий банер, потім додайте кілька.',
    cannotChangeMultipleToSingle:
      'Неможливо змінити кілька фото на одне. Спочатку видаліть усі існуючі банери, потім додайте один.',
    negativeBalance:
      "Участь заблокована: від'ємний баланс Stars. Будь ласка, поповніть баланс.",
    cannotCancelActiveLottery: 'Неможливо скасувати активну лотерею.',
    cannotCancelActiveGiveawayWithSponsorship:
      'Неможливо скасувати активний розіграш за увімкненого спонсорства.',
    cannotChangeGiftsOnUpdate:
      'Подарунки не можна змінювати під час редагування розіграшу.',
    cannotChangeGiftsViaGiveawayUpdate:
      'Подарунки не можна змінити через оновлення розіграшу.',
    cannotChangeWinningTicketCountLottery:
      'Кількість виграшних квитків не можна змінити в лотереї.',
    cannotDisableSponsorSearchLottery:
      'Пошук спонсорів не можна вимкнути або зменшити в лотереї.',
    cannotDisableSponsorSearch:
      'Пошук спонсорів не можна вимкнути або зменшити за увімкненого спонсорства.',
    cannotRemoveSponsorLinks:
      'Посилання спонсорів не можна видаляти за увімкненого спонсорства.',
    winnerCountFixedByLinkedGifts:
      'Кількість переможців задана подарунками і не може бути змінена.',
    winnerCountBelowMinimum: (min: number) =>
      `Кількість переможців не може бути меншою за ${min} (поточні учасники або переможці).`,
    ticketCapacityBelowMinimum: (min: number) =>
      `Кількість квитків не може бути меншою за ${min} (виграшні квитки або вже продані).`,
    participantCapacityBelowWinnerCount: (count: number) =>
      `Ліміт учасників не може бути меншим за кількість переможців (${count}).`,
    participantCapacityIncreaseOnlyWithSponsorship:
      'Ліміт учасників можна лише збільшити за увімкненого спонсорства.',
    participantCapacityBelowParticipantCount: (count: number) =>
      `Ліміт учасників не може бути меншим за поточну кількість учасників (${count}).`,
    endTimeCannotBeBeforeNow:
      'Час завершення не може бути раніше за поточний момент.',
    endTimeCannotBeBeforeStart:
      'Час завершення не може бути раніше за час старту.',
    startTimeCannotBeBeforeNow:
      'Час старту не може бути раніше за поточний момент.',
    endTimeExtendOnlyWithSponsorship:
      'Час завершення можна лише подовжити за увімкненого спонсорства.',
    ticketPriceIncreaseOnlyActiveLottery:
      'Вартість квитка можна лише підвищити для активної лотереї.',
    cannotAddStandardGiftToLottery:
      'Звичайні подарунки з каталогу не можна додати до лотереї.',
    winnerReplaceWaitClaimDeadline:
      'Заміна переможця буде доступна через 24 години!',
    winnerReplaceGiftClaimed:
      'Неможливо замінити цього переможця — він уже забрав подарунок.',
    winnerReplaceGiftDelivered:
      'Неможливо замінити цього переможця — подарунок уже доставлено.',
    winnerReplaceGiftLinkedToPlace:
      'Неможливо видалити або замінити цього переможця — до призового місця привʼязано подарунок.',
    additionalTicketsSourceRequired:
      'Один із цих параметрів має бути заповнений: реферали на квиток або бусти на квиток.',
    additionalTicketsMaxRequired:
      'Вкажіть максимальну кількість додаткових квитків.',
    boostChannelsRequired:
      'Оберіть хоча б один канал або групу для квитків за буст.',
    boostedChannelRequired: 'Оберіть канал або групу для вимоги буста.',
    additionalTicketsRefsConflictNeededReferals:
      'Додаткові квитки за запрошення не можна вмикати разом з обовʼязковим запрошенням друзів для участі.',
    additionalTicketsBoostConflictRequired:
      'Додаткові квитки за буст не можна вмикати разом з обовʼязковим бустом каналу для участі.',
  },
};

type GiveawayGuardScalarKey = {
  [K in keyof (typeof GIVEAWAY_ERROR_MESSAGES)['en']]: (typeof GIVEAWAY_ERROR_MESSAGES)['en'][K] extends string
    ? K
    : never;
}[keyof (typeof GIVEAWAY_ERROR_MESSAGES)['en']];

type GiveawayGuardParamKey = {
  [K in keyof (typeof GIVEAWAY_ERROR_MESSAGES)['en']]: (typeof GIVEAWAY_ERROR_MESSAGES)['en'][K] extends (
    min: number,
  ) => string
    ? K
    : never;
}[keyof (typeof GIVEAWAY_ERROR_MESSAGES)['en']];

export type GiveawayGuardMessageKey =
  | GiveawayGuardScalarKey
  | GiveawayGuardParamKey;

/** Slavic plural: one (1/21…), few (2–4/22–24…), many (0/5–20/25–30…). */
function slavicPlural(
  count: number,
  forms: readonly [string, string, string],
): string {
  const abs = Math.abs(count);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
    return forms[1];
  }
  return forms[2];
}

function formatSlavicDurationUnit(
  count: number,
  forms: readonly [string, string, string],
): string {
  return `${count} ${slavicPlural(count, forms)}`;
}

function formatReplaceWaitDuration(
  language: Language,
  remainingMs: number,
): string {
  const totalMinutes = Math.max(1, Math.ceil(remainingMs / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (language === 'ua') {
    const hourForms = ['година', 'години', 'годин'] as const;
    const minuteForms = ['хвилина', 'хвилини', 'хвилин'] as const;
    if (hours > 0 && minutes > 0) {
      return `${formatSlavicDurationUnit(hours, hourForms)} ${formatSlavicDurationUnit(minutes, minuteForms)}`;
    }
    if (hours > 0) return formatSlavicDurationUnit(hours, hourForms);
    return formatSlavicDurationUnit(minutes, minuteForms);
  }

  if (language === 'ru') {
    const hourForms = ['час', 'часа', 'часов'] as const;
    const minuteForms = ['минута', 'минуты', 'минут'] as const;
    if (hours > 0 && minutes > 0) {
      return `${formatSlavicDurationUnit(hours, hourForms)} ${formatSlavicDurationUnit(minutes, minuteForms)}`;
    }
    if (hours > 0) return formatSlavicDurationUnit(hours, hourForms);
    return formatSlavicDurationUnit(minutes, minuteForms);
  }

  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

const WINNER_REPLACE_WAIT_MESSAGES: Record<
  Language,
  (duration: string) => string
> = {
  en: (duration) => `Winner replacement will be available in ${duration}!`,
  ru: (duration) => `Замена победителя будет доступна через ${duration}!`,
  ua: (duration) => `Заміна переможця буде доступна через ${duration}!`,
};

/** Localized replace-winner error while the 24h claim window is still active. */
export function formatWinnerReplaceWaitMessage(
  language: string | null | undefined,
  claimDeadline: Date,
): string {
  const lang = normalizeGiveawayLanguage(language);
  const remainingMs = Math.max(0, claimDeadline.getTime() - Date.now());
  const duration = formatReplaceWaitDuration(lang, remainingMs);
  return WINNER_REPLACE_WAIT_MESSAGES[lang](duration);
}

export function formatGiveawayGuardMessage(
  language: string | null | undefined,
  key: GiveawayGuardScalarKey,
): string;
export function formatGiveawayGuardMessage(
  language: string | null | undefined,
  key: GiveawayGuardParamKey,
  param: number,
): string;
export function formatGiveawayGuardMessage(
  language: string | null | undefined,
  key: GiveawayGuardMessageKey,
  param?: number,
): string {
  const lang = normalizeGiveawayLanguage(language);
  const entry = GIVEAWAY_ERROR_MESSAGES[lang][key];
  if (typeof entry === 'function') {
    return entry(param as number);
  }
  return entry;
}

/**
 * Sponsor approval request messages
 */
export const COOWNER_RESULTS_MESSAGES = {
  en: {
    notification: (
      ownerFirstName: string,
      ownerLastName: string | null,
      channelName: string,
      giveawayType: 'random' | 'lottery',
    ) =>
      `${ownerFirstName}${ownerLastName ? ' ' + ownerLastName : ''}, the ${giveawayType === 'lottery' ? 'lottery' : 'giveaway'} on your channel or group <b>${channelName}</b> has ended!\n\n` +
      `You can manage the results in your profile or publish them using the button below.`,
    manageButton: 'Go to Management',
    publishButton: '🎉 Publish Results',
    publishedStatus: '✅ <b>Published</b>',
  },
  ru: {
    notification: (
      ownerFirstName: string,
      ownerLastName: string | null,
      channelName: string,
      giveawayType: 'random' | 'lottery',
    ) =>
      `${ownerFirstName}${ownerLastName ? ' ' + ownerLastName : ''}, ${giveawayType === 'lottery' ? 'лотерея' : 'розыгрыш'} на вашем канале или группе <b>${channelName}</b> завершился!\n\n` +
      `Вы можете управлять результатами в своём профиле или опубликовать их с помощью кнопки ниже.`,
    manageButton: 'Перейти к управлению',
    publishButton: '🎉 Опубликовать результаты',
    publishedStatus: '✅ <b>Опубликовано</b>',
  },
  ua: {
    notification: (
      ownerFirstName: string,
      ownerLastName: string | null,
      channelName: string,
      giveawayType: 'random' | 'lottery',
    ) =>
      `${ownerFirstName}${ownerLastName ? ' ' + ownerLastName : ''}, ${giveawayType === 'lottery' ? 'лотерея' : 'розіграш'} на вашому каналі або групі <b>${channelName}</b> завершився!\n\n` +
      `Ви можете керувати результатами у своєму профілі або опублікувати їх за допомогою кнопки нижче.`,
    manageButton: 'Перейти до керування',
    publishButton: '🎉 Опублікувати результати',
    publishedStatus: '✅ <b>Опубліковано</b>',
  },
};

export const SPONSOR_APPROVAL_MESSAGES = {
  en: {
    requestMessage: (
      ownerFirstName: string,
      ownerLastName: string,
      channelName: string,
      giveawayType: 'random' | 'lottery',
    ) =>
      `${ownerFirstName}${ownerLastName ? ' ' + ownerLastName : ''}, your channel or group <b>${channelName}</b> has been added to ${giveawayType === 'lottery' ? 'a lottery' : 'a giveaway'} by another user.\n\n` +
      `You can manage the ${giveawayType === 'lottery' ? 'lottery' : 'giveaway'} in your profile or publish it on the channel using the button below.`,
    manageButton: 'Go to Management',
    publishButton: (giveawayType: 'random' | 'lottery') =>
      giveawayType === 'lottery' ? '🎟 Publish Lottery' : '🎁 Publish Giveaway',
    publishedResponse: (giveawayType: 'random' | 'lottery') =>
      `✅ ${giveawayType === 'lottery' ? 'Lottery' : 'Giveaway'} published to your channel!`,
    alreadyResponded: 'You have already responded to this request.',
    expiredRequest: (giveawayType: 'random' | 'lottery') =>
      `This ${giveawayType === 'lottery' ? 'lottery' : 'giveaway'} is no longer active.`,
    notOwner: 'You are not authorized to respond to this request.',
    publishedStatus: '✅ <b>Published</b>',
    managementTakenStatus:
      '🔒 <b>Another administrator has taken over management of this giveaway!</b>',
    managementTakenAlert:
      'Another administrator has already taken over management of this giveaway.',
  },
  ru: {
    requestMessage: (
      ownerFirstName: string,
      ownerLastName: string,
      channelName: string,
      giveawayType: 'random' | 'lottery',
    ) =>
      `${ownerFirstName}${ownerLastName ? ' ' + ownerLastName : ''}, ваш канал или группу <b>${channelName}</b> добавили к ${giveawayType === 'lottery' ? 'лотерее' : 'розыгрышу'} другим пользователем.\n\n` +
      `Вы можете управлять ${giveawayType === 'lottery' ? 'лотереей' : 'розыгрышем'} в своём профиле или опубликовать ${giveawayType === 'lottery' ? 'её' : 'его'} на канале с помощью кнопки ниже.`,
    manageButton: 'Перейти к управлению',
    publishButton: (giveawayType: 'random' | 'lottery') =>
      giveawayType === 'lottery'
        ? '🎟 Опубликовать лотерею'
        : '🎁 Опубликовать розыгрыш',
    publishedResponse: (giveawayType: 'random' | 'lottery') =>
      `✅ ${giveawayType === 'lottery' ? 'Лотерея опубликована' : 'Розыгрыш опубликован'} на вашем канале!`,
    alreadyResponded: 'Вы уже ответили на этот запрос.',
    expiredRequest: (giveawayType: 'random' | 'lottery') =>
      `Эта ${giveawayType === 'lottery' ? 'лотерея' : 'розыгрыш'} больше не активна.`,
    notOwner: 'У вас нет прав отвечать на этот запрос.',
    publishedStatus: '✅ <b>Опубликовано</b>',
    managementTakenStatus:
      '🔒 <b>Управление розыгрышем взял на себя другой администратор!</b>',
    managementTakenAlert:
      'Управление этим розыгрышем уже взял на себя другой администратор.',
  },
  ua: {
    requestMessage: (
      ownerFirstName: string,
      ownerLastName: string,
      channelName: string,
      giveawayType: 'random' | 'lottery',
    ) =>
      `${ownerFirstName}${ownerLastName ? ' ' + ownerLastName : ''}, ваш канал або групу <b>${channelName}</b> було додано до ${giveawayType === 'lottery' ? 'лотереї' : 'розіграшу'} іншим користувачем.\n\n` +
      `Ви можете керувати ${giveawayType === 'lottery' ? 'лотереєю' : 'розіграшем'} у своєму профілі або опублікувати ${giveawayType === 'lottery' ? 'її' : 'його'} на каналі за допомогою кнопки нижче.`,
    manageButton: 'Перейти до керування',
    publishButton: (giveawayType: 'random' | 'lottery') =>
      giveawayType === 'lottery'
        ? '🎟 Опублікувати лотерею'
        : '🎁 Опублікувати розіграш',
    publishedResponse: (giveawayType: 'random' | 'lottery') =>
      `✅ ${giveawayType === 'lottery' ? 'Лотерею опубліковано' : 'Розіграш опубліковано'} на вашому каналі!`,
    alreadyResponded: 'Ві вже відповіли на цей запит.',
    expiredRequest: (giveawayType: 'random' | 'lottery') =>
      `Ця ${giveawayType === 'lottery' ? 'лотерея' : 'розіграш'} більше не активна.`,
    notOwner: 'У вас немає прав відповідати на цей запит.',
    publishedStatus: '✅ <b>Опубліковано</b>',
    managementTakenStatus:
      '🔒 <b>Керування розіграшем взяв на себе інший адміністратор!</b>',
    managementTakenAlert:
      'Керування цим розіграшем уже взяв на себе інший адміністратор.',
  },
};

export const GIVEAWAY_ACTIVATION_MESSAGES = {
  en: {
    started: (giveawayType: 'random' | 'lottery') =>
      `✅ ${giveawayType === 'lottery' ? 'Lottery' : 'Giveaway'} started — it will be published shortly!`,
    coOwnersNotified:
      'The owners of the channels and groups added to the giveaway have already received instructions in the bot on how to publish.',
    manageButton: 'Go to Management',
    postlotShare: (command: string) =>
      `📢 <b>Post to other channels:</b>\nShare the command below with channel admins who want to publish this giveaway:\n<code>${command}</code>`,
  },
  ru: {
    started: (giveawayType: 'random' | 'lottery') =>
      `✅ Старт ${giveawayType === 'lottery' ? 'лотереи' : 'розыгрыша'} состоялся — в ближайшее время он будет опубликован!`,
    coOwnersNotified:
      'Владельцы каналов и групп, добавленных к розыгрышу, уже получили сообщения в боте с инструкциями по публикации.',
    manageButton: 'Перейти к управлению',
    postlotShare: (command: string) =>
      `📢 <b>Опубликовать в других каналах:</b>\nПоделитесь командой ниже с владельцами каналов, которые хотят опубликовать этот розыгрыш:\n<code>${command}</code>`,
  },
  ua: {
    started: (giveawayType: 'random' | 'lottery') =>
      `✅ Старт ${giveawayType === 'lottery' ? 'лотереї' : 'розіграшу'} відбувся — найближчим часом його буде опубліковано!`,
    coOwnersNotified:
      'Власники каналів та груп, доданих до розіграшу, вже отримали повідомлення в боті з інструкціями щодо публікації.',
    manageButton: 'Перейти до керування',
    postlotShare: (command: string) =>
      `📢 <b>Опублікувати в інших каналах:</b>\nПоділіться командою нижче з власниками каналів, які хочуть опублікувати цей розіграш:\n<code>${command}</code>`,
  },
};

export const POSTLOT_MESSAGES = {
  en: {
    notRegistered: 'Please start the bot first: /start',
    giveawayNotFound: 'Giveaway not found or already finished.',
    noChannels:
      'You have no eligible channels. Make sure your channel is added in the bot and the bot has permission to post messages.',
    selectChannel: 'Select a channel to publish the giveaway:',
    alreadyPosted: 'The giveaway has already been published to this channel.',
    managementTaken:
      'Another administrator has already taken over management of this giveaway.',
    success: (channelTitle: string) =>
      `✅ Giveaway successfully published in <b>${channelTitle}</b>!`,
    error: 'Failed to publish. Please try again later.',
    notYourChannel: 'You are not the owner of this channel.',
    userNotFound: 'User not found.',
    botNeedsAdmin:
      'Make the bot an administrator with permission to post messages in this channel.',
    cancelButton: '❌ Cancel',
    cancelled: '❌ Giveaway publication cancelled!',
  },
  ru: {
    notRegistered: 'Сначала запустите бота: /start',
    giveawayNotFound: 'Розыгрыш не найден или уже завершён.',
    noChannels:
      'У вас нет подходящих каналов. Убедитесь, что канал добавлен в боте и бот имеет право публиковать сообщения.',
    selectChannel: 'Выберите канал для публикации розыгрыша:',
    alreadyPosted: 'Розыгрыш уже опубликован в этом канале.',
    managementTaken:
      'Управление этим розыгрышем уже взял на себя другой администратор.',
    success: (channelTitle: string) =>
      `✅ Розыгрыш успешно опубликован в <b>${channelTitle}</b>!`,
    error: 'Ошибка при публикации. Попробуйте позже.',
    notYourChannel: 'Вы не являетесь владельцем этого канала.',
    userNotFound: 'Пользователь не найден.',
    botNeedsAdmin:
      'Сделайте бота администратором с правом публикации сообщений в этом канале.',
    cancelButton: '❌ Отменить',
    cancelled: '❌ Публикация розыгрыша отменена!',
  },
  ua: {
    notRegistered: 'Спочатку запустіть бота: /start',
    giveawayNotFound: 'Розіграш не знайдено або вже завершено.',
    noChannels:
      'У вас немає підходящих каналів. Переконайтесь, що канал додано у боті та бот має права публікувати повідомлення.',
    selectChannel: 'Оберіть канал для публікації розіграшу:',
    alreadyPosted: 'Розіграш вже опубліковано в цьому каналі.',
    managementTaken:
      'Керування цим розіграшем уже взяв на себе інший адміністратор.',
    success: (channelTitle: string) =>
      `✅ Розіграш успішно опубліковано в каналі <b>${channelTitle}</b>!`,
    error: 'Помилка при публікації. Спробуйте пізніше.',
    notYourChannel: 'Ви не є власником цього каналу.',
    userNotFound: 'Користувача не знайдено.',
    botNeedsAdmin:
      'Зробіть бота адміністратором із правом публікувати повідомлення в цьому каналі.',
    cancelButton: '❌ Скасувати',
    cancelled: '❌ Публікація розіграшу скасована!',
  },
};

export const PAYMENT_LABELS = {
  payFromBalance: {
    en: 'Pay from balance',
    ru: 'Оплатить с баланса',
    ua: 'Оплатити з балансу',
  },
  payFromTelegram: {
    en: 'Pay via Telegram',
    ru: 'Оплатить через Telegram',
    ua: 'Оплатити з телеграма',
  },
};

export const LINK_REQUEST_MESSAGES = {
  ua: {
    // Creator side
    creatorRequest: (
      firstName: string,
      lastName: string | null,
      channelName: string,
    ) =>
      `${firstName}${lastName ? ' ' + lastName : ''}, канал/група <b>${channelName}</b> бажає долучитися до спільного розіграшу, створеного вами. Будь ласка, прийміть або відхиліть заявку.`,
    creatorAcceptBtn: '✅ Прийняти',
    creatorDeclineBtn: '❌ Відхилити',
    creatorContactBtn: "Зв'язатися з власником",
    creatorAcceptedStatus:
      '✅ Заявку прийнято. Після початку розіграшу ⭐️Stars будуть зараховані на ваш баланс.',
    creatorDeclinedStatus:
      '❌ Заявку відхилено. Повідомлення про ваше рішення буде надіслано користувачеві.',
    creatorAutoDeclinedStatus:
      '❌ Заявку автоматично відхилено, оскільки ви не встигли розглянути її до початку розіграшу.',
    creatorWithdrawnStatus:
      '❌ Користувач самостійно відкликав подану ним заявку на долучення до спільного розіграшу, створеного вами.',
    notCreator: 'У вас немає прав відповідати на цю заявку.',
    alreadyResponded: 'Ви вже відповіли на цю заявку.',
    // Sender side
    senderSubmitted: (firstName: string, lastName: string | null) =>
      `✅ ${firstName}${lastName ? ' ' + lastName : ''}, вашу заявку успішно подано!\nВона перебуває на розгляді. Про результат буде повідомлено додатково.`,
    senderWithdrawBtn: '❌ Відхилити подану заяву',
    senderWithdrawnStatus:
      '❌ Подану вами заявку відхилено, сплачений внесок буде повернуто на ваш баланс найближчим часом.',
    senderAccepted: (
      firstName: string,
      lastName: string | null,
      channelName: string,
    ) =>
      `✅ ${firstName}${lastName ? ' ' + lastName : ''}, вашу заявку на участь у спільному розіграші схвалено організатором. Канал/групу <b>${channelName}</b> додано до розіграшу.`,
    senderAcceptedStartTime: (dateStr: string) =>
      `Старт розіграшу заплановано на ${dateStr} (UTC).`,
    senderContactBtn: "Зв'язатися з власником",
    senderDeclined: (firstName: string, lastName: string | null) =>
      `❌ ${firstName}${lastName ? ' ' + lastName : ''}, вашу заявку на участь у спільному розіграші відхилено організатором.`,
    senderDeclinedRefund:
      'Сплачений вами внесок буде повернуто найближчим часом на ваш основний баланс.',
    senderAutoDeclined: (firstName: string, lastName: string | null) =>
      `❌ ${firstName}${lastName ? ' ' + lastName : ''}, вашу заявку на участь у спільному розіграші автоматично відхилено, оскільки розіграш уже розпочався, а ваша заявка не була розглянута організатором.`,
    senderAutoDeclinedRefund:
      'Сплачений внесок буде повернуто найближчим часом на ваш основний баланс.',
  },
  ru: {
    // Creator side
    creatorRequest: (
      firstName: string,
      lastName: string | null,
      channelName: string,
    ) =>
      `${firstName}${lastName ? ' ' + lastName : ''}, канал/группа <b>${channelName}</b> хочет присоединиться к совместному розыгрышу, созданному вами. Пожалуйста, примите или отклоните заявку.`,
    creatorAcceptBtn: '✅ Принять',
    creatorDeclineBtn: '❌ Отклонить',
    creatorContactBtn: 'Связаться с владельцем',
    creatorAcceptedStatus:
      '✅ Заявка принята. После начала розыгрыша ⭐️Stars будут зачислены на ваш баланс.',
    creatorDeclinedStatus:
      '❌ Заявка отклонена. Пользователю будет отправлено уведомление о вашем решении.',
    creatorAutoDeclinedStatus:
      '❌ Заявка автоматически отклонена, так как вы не успели её рассмотреть до начала розыгрыша.',
    creatorWithdrawnStatus:
      '❌ Пользователь самостоятельно отозвал поданную им заявку на участие в совместном розыгрыше, созданном вами.',
    notCreator: 'У вас нет прав отвечать на эту заявку.',
    alreadyResponded: 'Вы уже ответили на эту заявку.',
    // Sender side
    senderSubmitted: (firstName: string, lastName: string | null) =>
      `✅ ${firstName}${lastName ? ' ' + lastName : ''}, ваша заявка успешно подана!\nОна находится на рассмотрении. О результате будет сообщено дополнительно.`,
    senderWithdrawBtn: '❌ Отозвать поданную заявку',
    senderWithdrawnStatus:
      '❌ Поданная вами заявка отозвана, уплаченный взнос будет возвращён на ваш баланс в ближайшее время.',
    senderAccepted: (
      firstName: string,
      lastName: string | null,
      channelName: string,
    ) =>
      `✅ ${firstName}${lastName ? ' ' + lastName : ''}, ваша заявка на участие в совместном розыгрыше одобрена организатором. Канал/группа <b>${channelName}</b> добавлена к розыгрышу.`,
    senderAcceptedStartTime: (dateStr: string) =>
      `Начало розыгрыша запланировано на ${dateStr} (UTC).`,
    senderContactBtn: 'Связаться с владельцем',
    senderDeclined: (firstName: string, lastName: string | null) =>
      `❌ ${firstName}${lastName ? ' ' + lastName : ''}, ваша заявка на участие в совместном розыгрыше отклонена организатором.`,
    senderDeclinedRefund:
      'Уплаченный вами взнос будет возвращён в ближайшее время на ваш основной баланс.',
    senderAutoDeclined: (firstName: string, lastName: string | null) =>
      `❌ ${firstName}${lastName ? ' ' + lastName : ''}, ваша заявка на участие в совместном розыгрыше автоматически отклонена, так как розыгрыш уже начался, а ваша заявка не была рассмотрена организатором.`,
    senderAutoDeclinedRefund:
      'Уплаченный взнос будет возвращён в ближайшее время на ваш основной баланс.',
  },
  en: {
    // Creator side
    creatorRequest: (
      firstName: string,
      lastName: string | null,
      channelName: string,
    ) =>
      `${firstName}${lastName ? ' ' + lastName : ''}, channel/group <b>${channelName}</b> wants to join the giveaway you created. Please accept or decline the request.`,
    creatorAcceptBtn: '✅ Accept',
    creatorDeclineBtn: '❌ Decline',
    creatorContactBtn: 'Contact owner',
    creatorAcceptedStatus:
      '✅ Request accepted. After the giveaway starts, ⭐️Stars will be credited to your balance.',
    creatorDeclinedStatus:
      '❌ Request declined. The user will be notified of your decision.',
    creatorAutoDeclinedStatus:
      '❌ Request was automatically declined because the giveaway started before you could review it.',
    creatorWithdrawnStatus:
      '❌ The user withdrew their request to join the giveaway you created.',
    notCreator: 'You are not authorized to respond to this request.',
    alreadyResponded: 'You have already responded to this request.',
    // Sender side
    senderSubmitted: (firstName: string, lastName: string | null) =>
      `✅ ${firstName}${lastName ? ' ' + lastName : ''}, your request has been submitted!\nIt is under review. You will be notified of the result.`,
    senderWithdrawBtn: '❌ Withdraw request',
    senderWithdrawnStatus:
      '❌ Your request has been withdrawn. The paid fee will be refunded to your balance shortly.',
    senderAccepted: (
      firstName: string,
      lastName: string | null,
      channelName: string,
    ) =>
      `✅ ${firstName}${lastName ? ' ' + lastName : ''}, your request to join the shared giveaway has been approved by the organizer. Channel/group <b>${channelName}</b> has been added to the giveaway.`,
    senderAcceptedStartTime: (dateStr: string) =>
      `The giveaway is scheduled to start on ${dateStr} (UTC).`,
    senderContactBtn: 'Contact owner',
    senderDeclined: (firstName: string, lastName: string | null) =>
      `❌ ${firstName}${lastName ? ' ' + lastName : ''}, your request to join the shared giveaway has been declined by the organizer.`,
    senderDeclinedRefund:
      'The fee you paid will be refunded to your main balance shortly.',
    senderAutoDeclined: (firstName: string, lastName: string | null) =>
      `❌ ${firstName}${lastName ? ' ' + lastName : ''}, your request to join the shared giveaway was automatically declined because the giveaway has already started and your request was not reviewed by the organizer.`,
    senderAutoDeclinedRefund:
      'The paid fee will be refunded to your main balance shortly.',
  },
};

export const DESCRIPTION_REQUEST_MESSAGES = {
  prompt: {
    en: '✏️ Send a message — your text will be used as the giveaway post description.\n\nYou have 10 minutes.',
    ru: '✏️ Отправьте сообщение — ваш текст будет добавлен в описание поста розыгрыша.\n\nУ вас есть 10 минут.',
    ua: '✏️ Надішліть повідомлення — ваш текст буде додано до опису поста розіграшу.\n\nУ вас є 10 хвилин.',
  },
  received: {
    en: '✅ Description saved — it will be applied to the giveaway!',
    ru: '✅ Описание сохранено, его будет применено в розыгрыше!',
    ua: '✅ Опис збережено, його буде застосовано в розіграші!',
  },
  descriptionUpdated: {
    en: '✅ Description updated — check the parameters and confirm.',
    ru: '✅ Текст описания изменён, проверьте параметры и подтвердите сохранение.',
    ua: '✅ Текст опису змінено, перевірте параметри та підтвердіть збереження.',
  },
  preview: {
    en: '👁 Preview:',
    ru: '👁 Предпросмотр:',
    ua: '👁 Попередній перегляд:',
  },
  expired: {
    en: '⏳ Your description request has expired. Return to the app to start again.',
    ru: '⏳ Время ожидания описания истекло. Вернитесь в приложение, чтобы начать заново.',
    ua: '⏳ Час очікування опису минув. Повертайтесь до застосунку, щоб почати знову.',
  },
  interrupted: {
    en: '⚠️ Process interrupted! Giveaway creation was cancelled.\nYou can start creating a new giveaway at any time.',
    ru: '⚠️ Процесс прерван! Создание розыгрыша отменено.\nВы можете начать создание нового розыгрыша в любой момент.',
    ua: '⚠️ Процес перервано! Створення розіграшу скасовано.\nВи можете розпочати створення нового розіграшу в будь-який момент.',
  },
  interruptedLottery: {
    en: '⚠️ Process interrupted! Lottery creation was cancelled.\nYou can start creating a new lottery at any time.',
    ru: '⚠️ Процесс прерван! Создание лотереи отменено.\nВы можете начать создание новой лотереи в любой момент.',
    ua: '⚠️ Процес перервано! Створення лотереї скасовано.\nВи можете розпочати створення нової лотереї в будь-який момент.',
  },
};

export const DESC_FLOW_MESSAGES = {
  en: {
    confirmPrompt:
      'Please check the parameters and confirm saving.\nYou can change the participation button name or settings if needed.',
    saveButton: 'Save',
    editButton: 'Edit description',
    customizeButton: 'Customize participation button',
    savedSettings: '✅ Settings saved. You can return to the app to continue.',
    editPrompt:
      '✏️ Send the new description text — it will be updated in the preview.',
    customizeNamePrompt:
      'Enter a custom button label, or choose one of the presets below.\n\n<b>⚠️ Please note:</b> <i>Premium emoji are not supported yet and will be replaced with regular ones.</i>',
    customizeColorPrompt: 'Choose button color:',
    customizeCounterPrompt: 'Configure the counter:',
    expired: '⏳ Session expired. Return to the app to start again.',
    notActive: 'This action is no longer available.',
    busy: '⏳ Please wait…',
    premiumEmojiStripped:
      'Premium emoji were replaced with regular characters.',
  },
  ru: {
    confirmPrompt:
      'Пожалуйста, проверьте параметры и подтвердите сохранение.\nПри необходимости измените название или настройки кнопки участия.',
    saveButton: 'Сохранить',
    editButton: 'Редактировать описание',
    customizeButton: 'Кастомизировать кнопку участия',
    savedSettings:
      '✅ Настройки сохранены. Можете вернуться в приложение, чтобы продолжить.',
    editPrompt:
      '✏️ Отправьте новый текст описания — он будет обновлён в предпросмотре.',
    customizeNamePrompt:
      'Напишите своё название кнопки или выберите один из готовых вариантов.\n\n<b>⚠️ Обратите внимание:</b> <i>Premium-эмодзи пока не поддерживаются и будут автоматически заменены на обычные.</i>',
    customizeColorPrompt: 'Выберите цвет кнопки:',
    customizeCounterPrompt: 'Настройте счётчик:',
    expired: '⏳ Время сессии истекло. Вернитесь в приложение.',
    notActive: 'Это действие больше недоступно.',
    busy: '⏳ Подождите…',
    premiumEmojiStripped: 'Premium-эмодзи заменены на обычные символы.',
  },
  ua: {
    confirmPrompt:
      'Будь ласка, перевірте параметри та підтвердіть збереження.\nЗа потреби змініть назву чи налаштування кнопки участі.',
    saveButton: 'Зберегти',
    editButton: 'Редагувати опис',
    customizeButton: 'Кастомізувати кнопку участі',
    savedSettings:
      '✅ Налаштування збережені. Можете повернутися до застосунку, щоб продовжити.',
    editPrompt:
      '✏️ Надішліть новий текст опису — його буде оновлено та показано в попередньому перегляді.',
    customizeNamePrompt:
      'Напишіть власну назву кнопки, або виберіть один із готових варіантів.\n\n<b>⚠️ Зверніть увагу:</b> <i>Premium-емодзі наразі не підтримуються і будуть автоматично замінені на звичайні.</i>',
    customizeColorPrompt: 'Виберіть колір кнопки:',
    customizeCounterPrompt: 'Налаштуйте лічильник:',
    expired: '⏳ Сесію завершено. Повертайтесь до застосунку.',
    notActive: 'Ця дія більше недоступна.',
    busy: '⏳ Зачекайте…',
    premiumEmojiStripped: 'Premium-емодзі замінено на звичайні символи.',
  },
};

export const PARTICIPATION_BUTTON_PRESETS: Record<
  'en' | 'ru' | 'ua',
  string[]
> = {
  en: [
    'Participate',
    '🎉 Participate',
    "I'm in!",
    "🧸 I'm in!",
    "I'm game",
    "😎 I'm game",
    'Feeling lucky!',
    '🍀 Feeling lucky!',
  ],
  ru: [
    'Принять участие',
    '🎉 Принять участие',
    'Беру участие!',
    '🧸 Беру участие!',
    'Я в деле',
    '😎 Я в деле',
    'Мне повезёт!',
    '🍀 Мне повезёт!',
  ],
  ua: [
    'Прийняти участь',
    '🎉Прийняти участь',
    'Беру участь!',
    '🧸Беру участь!',
    'Я в ділі',
    '😎 Я в ділі',
    'Мені пощастить!',
    '🍀Мені пощастить!',
  ],
};

/** Creator DM when a planned giveaway/lottery is created (not started yet). */
export const GIVEAWAY_PLANNED_MESSAGES = {
  en: {
    giveaway:
      '✅ Done! The giveaway has been scheduled.\nA start notification will be sent at the set time.',
    lottery:
      '✅ Done! The lottery has been scheduled.\nA start notification will be sent at the set time.',
  },
  ru: {
    giveaway:
      '✅ Готово! Розыгрыш запланирован.\nСообщение о старте будет отправлено в назначенное время.',
    lottery:
      '✅ Готово! Лотерея запланирована.\nСообщение о старте будет отправлено в назначенное время.',
  },
  ua: {
    giveaway:
      '✅ Готово! Розіграш заплановано.\nПовідомлення про початок буде відправлено у визначений час.',
    lottery:
      '✅ Готово! Лотерею заплановано.\nПовідомлення про початок буде відправлено у визначений час.',
  },
};

export const ADVERTISING_APPLIED_MESSAGES = {
  en: {
    text: '✅ Advertising applied! Your giveaway is now being promoted.',
    button: '🎁 View Giveaway',
  },
  ru: {
    text: '✅ Реклама активирована! Ваш розыгрыш сейчас продвигается.',
    button: '🎁 Перейти к розыгрышу',
  },
  ua: {
    text: '✅ Рекламу застосовано! Ваш розіграш зараз просувається.',
    button: '🎁 Перейти до розіграшу',
  },
};

export const PAYMENT_SUCCESS_MESSAGES = {
  en: {
    deposit: (amount: number, currency: string, stars: number, ton: number) =>
      `✅ Payment successful!\n💰 Added ${amount} ${currency} to your wallet.\n💳 New balance: ${stars} ⭐ | ${ton} TON`,
    tickets: (amount: number, count: number, stars: number, ton: number) =>
      `✅ Payment successful!\n⭐️ Paid Stars: ${amount}\n🎟 Tickets bought: ${count}\n\n💳 Your balance: ${stars} ⭐ | ${ton} TON`,
    goToLottery: '🎟 Go to Lottery',
    joint:
      '✅ Your request has been submitted! The giveaway creator will review it shortly.',
    giftCommission: (amount: number) =>
      `✅ Gift commission paid!\n⭐️ ${amount} Stars — your NFT gifts are ready to link.`,
    giftCommissionFailed:
      '⚠️ Payment received but commission could not be applied. Please contact support.',
  },
  ru: {
    deposit: (amount: number, currency: string, stars: number, ton: number) =>
      `✅ Оплата успешна!\n💰 Добавлено ${amount} ${currency} на ваш кошелёк.\n💳 Новый баланс: ${stars} ⭐ | ${ton} TON`,
    tickets: (amount: number, count: number, stars: number, ton: number) =>
      `✅ Оплата успешна!\n⭐️ Оплачено Stars: ${amount}\n🎟 Куплено билетов: ${count}\n\n💳 Ваш баланс: ${stars} ⭐ | ${ton} TON`,
    goToLottery: '🎟 Перейти к лотерее',
    joint:
      '✅ Ваша заявка подана! Организатор розыгрыша рассмотрит её в ближайшее время.',
    giftCommission: (amount: number) =>
      `✅ Комиссия за подарки оплачена!\n⭐️ ${amount} Stars — NFT подарки готовы к привязке.`,
    giftCommissionFailed:
      '⚠️ Платёж получен, но комиссию не удалось применить. Обратитесь в поддержку.',
  },
  ua: {
    deposit: (amount: number, currency: string, stars: number, ton: number) =>
      `✅ Оплата успішна!\n💰 Додано ${amount} ${currency} до вашого гаманця.\n💳 Новий баланс: ${stars} ⭐ | ${ton} TON`,
    tickets: (amount: number, count: number, stars: number, ton: number) =>
      `✅ Оплата успішна!\n⭐️ Сплачено Stars: ${amount}\n🎟 Куплено квитків: ${count}\n\n💳 Ваш баланс: ${stars} ⭐ | ${ton} TON`,
    goToLottery: '🎟 Перейти до лотереї',
    joint:
      '✅ Вашу заявку подано! Організатор розіграшу розгляне її найближчим часом.',
    giftCommission: (amount: number) =>
      `✅ Комісію за подарунки сплачено!\n⭐️ ${amount} Stars — NFT подарунки готові до прив’язки.`,
    giftCommissionFailed:
      '⚠️ Платіж отримано, але комісію не вдалося застосувати. Зверніться до підтримки.',
  },
};
