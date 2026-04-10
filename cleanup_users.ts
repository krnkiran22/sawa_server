import { prisma } from './src/lib/prisma';
import { coupleService } from './src/services/couple.service';
import { logger } from './src/utils/logger';

async function cleanup() {
  const phones = ['916369758396', '917358723987', '6369758396', '7358723987'];
  
  for (const phone of phones) {
    const user = await prisma.user.findUnique({ where: { phone } });
    if (user && user.coupleId) {
      logger.info(`Cleaning up couple for phone ${phone} (coupleId: ${user.coupleId})`);
      await coupleService.deleteMyCouple(user.coupleId);
      logger.info(`Deleted couple ${user.coupleId}`);
    } else if (user) {
        logger.info(`User ${phone} found but no coupleId. Deleting user.`);
        await prisma.user.delete({ where: { phone } });
    } else {
      logger.info(`User ${phone} not found.`);
    }
  }

  // Cleanup any orphaned OTP tokens for these phones
  await prisma.otpToken.deleteMany({
    where: { phone: { in: phones } }
  });

  process.exit(0);
}

cleanup().catch(err => {
    console.error(err);
    process.exit(1);
});
