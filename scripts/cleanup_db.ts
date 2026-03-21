import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { User } from '../src/models/User.model';
import { Couple } from '../src/models/Couple.model';

dotenv.config({ path: path.join(__dirname, '../.env') });

const MONGO_URI = process.env.MONGODB_URI;
const KEEP_COUPLE_IDS = [
    '904d77de-0889-4823-bb57-7463283f8acd',
    'b7a4efe5-6a4f-4e7b-a59f-d09e718dc039',
    '5ffbfc10-591f-4466-9d70-883e2ed79f54'
];

async function cleanupDb() {
    if (!MONGO_URI) {
        console.error('❌ MONGODB_URI is not defined in .env');
        process.exit(1);
    }

    try {
        console.log('🚀 Starting DB Cleanup...');
        await mongoose.connect(MONGO_URI, { dbName: 'sawa_db' });

        // Cleanup Users
        const userDeleteRes = await User.deleteMany({
            coupleId: { $nin: KEEP_COUPLE_IDS }
        });
        console.log(`✅ Deleted ${userDeleteRes.deletedCount} Users.`);

        // Cleanup Couples
        const coupleDeleteRes = await Couple.deleteMany({
            coupleId: { $nin: KEEP_COUPLE_IDS }
        });
        console.log(`✅ Deleted ${coupleDeleteRes.deletedCount} Couples.`);

        console.log('\n--- DATA KEPT ---');
        const remainingCouples = await Couple.find({});
        remainingCouples.forEach(c => console.log(`- ${c.profileName || 'Unnamed'} (${c.coupleId})`));

    } catch (err: any) {
        console.error('❌ Error during cleanup:', err.message);
    } finally {
        await mongoose.disconnect();
        console.log('👋 Database disconnected.');
    }
}

cleanupDb();
