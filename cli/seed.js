const { PrismaClient, Prisma } = require('@prisma/client');
const { Decimal } = Prisma;
const { genSaltSync, hashSync } = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

const loadSeedData = () => {
  const seedFilePath = path.join(__dirname, 'seed.json');
  const seedData = JSON.parse(fs.readFileSync(seedFilePath, 'utf8'));
  return seedData;
};

const bootstrap = async () => {
  const seedData = loadSeedData();

  // Создание ролей
  await prisma.role.createMany({
    data: seedData.roles,
    skipDuplicates: true,
  });
  console.log("Роли созданы");

  await prisma.minTransactionValue.createMany({
    data: [{
      id: 1,
      stars: 100,
      ton: 2,
    }],
    skipDuplicates: true,
  });

  await prisma.withdrawalCommission.createMany({
    data: [{
      id: 1,
      starsPercent: 10,
      tonPercent: 10,
    }],
    skipDuplicates: true,
  });

  await prisma.exchangeRate.createMany({
    data: [{
      id: 1,
      starsInput: new Decimal(100),
      tonOutput: new Decimal(1.165),
    }],
    skipDuplicates: true
  });


  // Создание тарифов
  await prisma.tariff.createMany({
    data: seedData.tariffs,
    skipDuplicates: true,
  });
  console.log("Тарифы созданы");

  // Создание пользователей
  // const createdUsers = [];
  // for (const userData of seedData.users) {
  //   const user = await prisma.user.create({
  //     data: userData,
  //   });
  //   createdUsers.push(user);
  // }
  // console.log(`Создано ${createdUsers.length} пользователей`);

  // // Создание кошельков (привязываем к созданным пользователям)
  // for (let i = 0; i < seedData.wallets.length && i < createdUsers.length; i++) {
  //   const walletData = { ...seedData.wallets[i], userId: createdUsers[i].id };
  //   await prisma.wallet.create({
  //     data: walletData,
  //   });
  // }
  // console.log("Кошельки созданы");

  // // Создание каналов
  // await prisma.channel.createMany({
  //   data: seedData.channels,
  //   skipDuplicates: true,
  // });
  // console.log("Каналы созданы");

  // // Создание спонсорских ссылок
  // const createdSponsorLinks = [];
  // for (const linkData of seedData.sponsorLinks) {
  //   const link = await prisma.sponsorLink.create({
  //     data: linkData,
  //   });
  //   createdSponsorLinks.push(link);
  // }
  // console.log("Спонсорские ссылки созданы");

  // // Создание розыгрышей (привязываем к созданным пользователям)
  // const createdGiveaways = [];
  // for (let i = 0; i < seedData.giveaways.length; i++) {
  //   const giveawayData = {
  //     ...seedData.giveaways[i],
  //     createdById: createdUsers[i % createdUsers.length].id, // Циклично привязываем к пользователям
  //   };
  //   const giveaway = await prisma.giveaway.create({
  //     data: giveawayData,
  //   });
  //   createdGiveaways.push(giveaway);
  // }
  // console.log(`Создано ${createdGiveaways.length} розыгрышей`);

  // console.log("Все тестовые данные успешно загружены!");
};

bootstrap()
  .then(() => console.log('Seed done!'))
  .catch((e) => console.error(e));
