import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import path from 'path';

// Models are expected to be available via ts-node transpile or relative imports
import { Community } from '../src/models/Community.model';
import { Couple } from '../src/models/Couple.model';

dotenv.config({ path: path.join(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI not found in .env');
  process.exit(1);
}

async function listData() {
  try {
    console.log('📡 Connecting to Railway MongoDB...');
    await mongoose.connect(MONGODB_URI!);
    console.log('✅ Connected');

    const communities = await Community.find({});
    console.log(`\n🏘️  COMMUNITIES (${communities.length}):`);
    communities.forEach((c: any) => {
      console.log(`- [${c._id}] ${c.name} (${c.city}) - Members: ${c.members?.length || 0}`);
    });

    const couples = await Couple.find({});
    console.log(`\n👫  COUPLES (${couples.length}):`);
    couples.forEach((c: any) => {
      console.log(`- [${c._id}] ${c.profileName || 'Unknown'} (${c.location?.city || 'Unknown'}) - ID: ${c.coupleId}`);
    });

    await mongoose.disconnect();
    console.log('\n👋 Disconnected');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

listData();
