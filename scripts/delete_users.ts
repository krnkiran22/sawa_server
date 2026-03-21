import mongoose from 'mongoose';
import { User } from '../src/models/User.model';
import { Couple } from '../src/models/Couple.model';
import { Match } from '../src/models/Match.model';
import { Message } from '../src/models/Message.model';
import { Notification } from '../src/models/Notification.model';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://kirandev2210_db_user:sawadev@sawa.prqius4.mongodb.net/?appName=sawa';

const USERS_TO_DELETE = [
  '69be3c62fc9e090e05c7bd4e', // Priyan
  '69be3c62fc9e090e05c7bd4b', // Gokul
  '69be3bb9fc9e090e05c7bd17', // Raji (N/A)
  '69be3bb9fc9e090e05c7bd14'  // Kiran
];

const COUPLE_IDS_TO_DELETE = [
  '12bc7bc0-a294-4a9c-a997-62998d0f4f2b',
  'b03f1a6f-ab11-4b1a-9b34-2ddffea26dd0'
];

async function run() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI, { dbName: 'sawa_db' });
    console.log('Connected.\n');

    for (const cId of COUPLE_IDS_TO_DELETE) {
      const coupleDoc = await Couple.findOne({ coupleId: cId });
      
      if (coupleDoc) {
        console.log(`Deleting data for Couple: ${cId} (${coupleDoc._id})`);
        
        await Match.deleteMany({
          $or: [{ couple1: coupleDoc._id }, { couple2: coupleDoc._id }]
        });

        await Message.deleteMany({
          $or: [{ sender: coupleDoc._id }, { chatId: { $in: await Match.find({ $or: [{ couple1: coupleDoc._id }, { couple2: coupleDoc._id }] }).select('_id') } }]
        });

        await Notification.deleteMany({
          $or: [{ recipient: coupleDoc._id }, { sender: coupleDoc._id }]
        });

        await Couple.deleteOne({ _id: coupleDoc._id });
        console.log(`✅ Couple ${cId} deleted.`);
      } else {
        console.log(`⚠️ Couple ${cId} not found.`);
      }
    }

    const userStatus = await User.deleteMany({ _id: { $in: USERS_TO_DELETE } });
    console.log(`✅ Deleted ${userStatus.deletedCount} users.`);

    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

run();
