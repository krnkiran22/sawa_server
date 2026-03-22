import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import path from 'path';

// Load models
import { Community } from '../src/models/Community.model';
import { Couple } from '../src/models/Couple.model';
import { User } from '../src/models/User.model';

dotenv.config({ path: path.join(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI not found in .env');
  process.exit(1);
}

async function cleanup() {
  try {
    console.log('📡 Connecting to Railway MongoDB...');
    await mongoose.connect(MONGODB_URI!);
    console.log('✅ Connected');

    // 1. Delete the specific user profile requested (Rathi & Gokul)
    const targetUserId = '79b4a304-ab42-4837-a430-bc3b8bc120e4';
    const couple = await Couple.findOne({ coupleId: targetUserId });
    
    if (couple) {
      console.log(`👫 Deleting couple: ${couple.profileName} [${couple._id}]`);
      
      // Delete associated individuals (users)
      if (couple.partner1) await User.deleteOne({ _id: couple.partner1 });
      if (couple.partner2) await User.deleteOne({ _id: couple.partner2 });
      
      // Delete the couple profile
      await Couple.deleteOne({ _id: couple._id });
      console.log('✅ Couple and associated users deleted.');
    } else {
      console.log(`⚠️ Couple with ID ${targetUserId} not found.`);
    }

    // 2. Delete the dummy communities
    const dummyNames = [
      'Wanderlusters Club',
      'Weekend Foodies',
      'Board Game Knights',
      'Weekend  Foodies',
      'Board  Game Knights',
      'Wanderlusters  Club'
    ];
    
    console.log('🏘️  Deleting dummy communities...');
    const result = await Community.deleteMany({
      name: { $in: dummyNames }
    });
    console.log(`✅ Deleted ${result.deletedCount} dummy communities.`);

    await mongoose.disconnect();
    console.log('\n👋 Cleanup finished.');
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    process.exit(1);
  }
}

cleanup();
