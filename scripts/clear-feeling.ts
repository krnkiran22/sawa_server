import Redis from 'ioredis';
import * as dotenv from 'dotenv';
dotenv.config();

const COUPLE_ID = '8c220c4b-283e-4fc1-8f7c-dc8a78910761';
const STELLA_USER_ID = 'cmqs67pyd0024o11gswrbon4y';
const KEY = `us:feeling:${COUPLE_ID}:${STELLA_USER_ID}`;

(async () => {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) { console.error('REDIS_URL not set'); process.exit(1); }

  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  const current = await redis.get(KEY);
  console.log('Current value:', current ?? '(none)');

  const deleted = await redis.del(KEY);
  console.log(deleted ? `✓ Deleted key: ${KEY}` : `Key not found (already gone): ${KEY}`);

  await redis.quit();
})();
