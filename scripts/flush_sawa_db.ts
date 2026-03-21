import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const MONGO_URI = process.env.MONGODB_URI;

async function flushDb() {
    if (!MONGO_URI) {
        console.error('❌ MONGODB_URI is not defined in .env');
        process.exit(1);
    }

    try {
        console.log('🚀 Connecting to MongoDB for total flush...');
        await mongoose.connect(MONGO_URI, { dbName: 'sawa_db' });

        const db = mongoose.connection.db;
        if (!db) throw new Error('Could not access database object');

        console.log(`🧹 Dropping entire database: sawa_db...`);
        await db.dropDatabase();
        
        console.log('✅ DATABASE FLUSHED SUCCESSFULLY! All users, couples, and notifications are gone.');

    } catch (err: any) {
        console.error('❌ Error during flush:', err.message);
    } finally {
        await mongoose.disconnect();
        console.log('👋 Database disconnected.');
    }
}

flushDb();
