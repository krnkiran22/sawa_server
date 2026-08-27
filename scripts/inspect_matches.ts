import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import { Match } from '../src/models/Match.model';
import { Couple } from '../src/models/Couple.model';
import { User } from '../src/models/User.model';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/sawa';

async function listMatches() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // List all couples
    const couples = await Couple.find();
    console.log(`\n👥 Found ${couples.length} couples:`);
    for (const c of couples) {
      console.log(`- [${c._id}] ${c.profileName} (${c.location?.city}) — coupleId: ${c.coupleId}`);
    }

    // List all matches
    const matches = await Match.find()
      .populate('couple1', 'profileName')
      .populate('couple2', 'profileName');
    
    console.log(`\n💘 Found ${matches.length} total matches/likes:`);
    for (const m of matches) {
      console.log(`- Match [${m._id}] Status: ${m.status}`);
      console.log(`  ${(m.couple1 as any)?.profileName} ❤️ ${(m.couple2 as any)?.profileName}`);
      console.log(`  Action By: ${m.actionBy}`);
    }

    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
}

listMatches();
