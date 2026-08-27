import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';

dotenv.config({ path: path.join(__dirname, '../.env') });

import { User } from '../src/models/User.model';
import { Couple } from '../src/models/Couple.model';

const MONGO_URI = process.env.MONGODB_URI;

async function seedTestCouples() {
    if (!MONGO_URI) {
        console.error('❌ MONGODB_URI is not defined in .env');
        process.exit(1);
    }

    try {
        console.log('🚀 Connecting to MongoDB to create Real Test Couples...');
        await mongoose.connect(MONGO_URI, { dbName: 'sawa_db' });

        // Cleanup any previous entries with these numbers (to allow re-run)
        const phones = ['1111111111', '2222222222', '3333333333', '4444444444'];
        const existingUsers = await User.find({ phone: { $in: phones } });
        const existingCoupleIds = [...new Set(existingUsers.map(u => u.coupleId))];
        
        await User.deleteMany({ phone: { $in: phones } });
        await Couple.deleteMany({ coupleId: { $in: existingCoupleIds } });

        console.log('✨ Cleanup complete, creating new profiles...');

        // ─── COUPLE 1: Arjun & Meera (Bangalore) ───────────────────────────────────
        const c1Id = crypto.randomUUID();
        const u1 = await User.create({
            phone: '1111111111',
            coupleId: c1Id,
            role: 'primary',
            name: 'Arjun',
            isPhoneVerified: true
        });
        const u2 = await User.create({
            phone: '2222222222',
            coupleId: c1Id,
            role: 'partner',
            name: 'Meera',
            isPhoneVerified: true
        });

        await Couple.create({
            coupleId: c1Id,
            partner1: u1._id,
            partner2: u2._id,
            profileName: 'Arjun & Meera',
            bio: 'Adventure seekers who love exploring hidden cafes and weekend treks. Moving to Bangalore has opened up so many hiking trails for us!',
            isProfileComplete: true,
            location: { city: 'Bangalore', country: 'India' },
            primaryPhoto: 'https://images.unsplash.com/photo-1621112904887-419379ce6824?auto=format&fit=crop&w=800&q=80',
            secondaryPhotos: [
                'https://images.unsplash.com/photo-1596464716127-f2a82984de30?auto=format&fit=crop&w=800&q=80'
            ],
            answers: [
                { questionId: 'q1', selectedOptionIds: ['q1-career'] },
                { questionId: 'q2', selectedOptionIds: ['q2-explorers'] },
                { questionId: 'q3', selectedOptionIds: ['q3-outdoor', 'q3-restaurants'] }
            ]
        });

        // ─── COUPLE 2: Vikram & Priya (Mumbai) ─────────────────────────────────────
        const c2Id = crypto.randomUUID();
        const u3 = await User.create({
            phone: '3333333333',
            coupleId: c2Id,
            role: 'primary',
            name: 'Vikram',
            isPhoneVerified: true
        });
        const u4 = await User.create({
            phone: '4444444444',
            coupleId: c2Id,
            role: 'partner',
            name: 'Priya',
            isPhoneVerified: true
        });

        await Couple.create({
            coupleId: c2Id,
            partner1: u3._id,
            partner2: u4._id,
            profileName: 'Vikram & Priya',
            bio: 'Street foodies by heart, designers by profession. We believe Mumbai nights are the best for exploring the city!',
            isProfileComplete: true,
            location: { city: 'Mumbai', country: 'India' },
            primaryPhoto: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=800&q=80',
            secondaryPhotos: [
                'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=800&q=80'
            ],
            answers: [
                { questionId: 'q1', selectedOptionIds: ['q1-living'] },
                { questionId: 'q2', selectedOptionIds: ['q2-hosts'] },
                { questionId: 'q3', selectedOptionIds: ['q3-restaurants', 'q3-cultural'] }
            ]
        });

        console.log('✅ 2 TEST COUPLES CREATED SUCCESSFULLY!');
        console.log('📱 Couple 1: 1111111111 / 2222222222 (Arjun & Meera)');
        console.log('📱 Couple 2: 3333333333 / 4444444444 (Vikram & Priya)');

    } catch (err: any) {
        console.error('❌ Error during seeding:', err.message);
    } finally {
        await mongoose.disconnect();
        console.log('👋 Database disconnected.');
    }
}

seedTestCouples();
