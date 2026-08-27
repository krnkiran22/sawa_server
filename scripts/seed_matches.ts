import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { Couple } from '../src/models/Couple.model';
import { Match } from '../src/models/Match.model';

dotenv.config({ path: path.join(__dirname, '../.env') });

async function seedMatch() {
  const MONGO_URI = process.env.MONGODB_URI;
  if (!MONGO_URI) {
    console.error('❌ MONGODB_URI not found');
    process.exit(1);
  }

  try {
    await mongoose.connect(MONGO_URI, { dbName: 'sawa_db' });
    console.log('Connected to DB');

    const couples = await Couple.find({ profileName: { $in: ['Arjun & Meera', 'Vikram & Priya'] } });
    if (couples.length < 2) {
      console.error('❌ Could not find the seeded couples. Run seed_test_couples.ts first.');
      process.exit(1);
    }

    const [c1, c2] = couples;

    // Check if match already exists
    const existingMatch = await Match.findOne({
      $or: [
        { couple1: c1._id, couple2: c2._id },
        { couple1: c2._id, couple2: c1._id }
      ]
    });

    if (existingMatch) {
      console.log('✅ Match already exists between Arjun & Meera and Vikram & Priya');
    } else {
      await Match.create({
        couple1: c1._id,
        couple2: c2._id,
        status: 'accepted',
        actionBy: c1._id,
        matchScore: 95,
        matchedAt: new Date(),
        lastInteractionAt: new Date()
      });
      console.log('🚀 Created Match between Arjun & Meera and Vikram & Priya!');
    }

  } catch (err: any) {
    console.error('❌ Error:', err.message);
  } finally {
    await mongoose.disconnect();
  }
}

seedMatch();
