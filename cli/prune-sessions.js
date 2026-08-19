const { PrismaClient } = require('@prisma/client');
const moment = require('moment');

const bootstrap = async () => {
  const prisma = new PrismaClient();

  const result = await prisma.userSession.deleteMany({
    where: {
      lastActivityAt: {
        lt: moment.utc().subtract(30, 'days').toDate(),
      },
    },
  });

  return result.count;
};

bootstrap()
  .then((data) => console.log(`Done! Data: ${data}`))
  .catch((err) => console.error(err));
