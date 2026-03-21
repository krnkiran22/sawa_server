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
  '69be5c7719d1d5ed0b4a1ac5',
  '69be5c7719d1d5ed0b4a1ac2',
  '69be5a5a862b36f6bcbd6b19',
  '69be5a5a862b36f6bcbd6b16',
  '69be5a32422700774d1a977c',
  '69be5a31422700774d1a9779',
  '69be5a1d1ebcab1b10aae8d6',
  '69be59ed971e411acbaeffa7',
  '69be59ed971e411acbaeffa4'
];

const COUPLE_IDS_TO_DELETE = [
  '966c39da-7efa-4575-9cbe-df64e224bf02',
  'b921d7f2-67ed-4828-ac90-528e52193f21',
  '6bd1bf0b-560e-4e0d-b29b-893c269632da',
  '5c0b3317-0254-4f86-87be-20d395880d07',
  'e0f2824b-3294-4632-aba9-77ed4600122e'
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
