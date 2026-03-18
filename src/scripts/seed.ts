import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { User } from '../models/User.model';
import { Couple } from '../models/Couple.model';
import { Community } from '../models/Community.model';
import { logger } from '../utils/logger';

// Load env from root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/sawa';

const COUPLES = [
  {
    coupleId: 'seed_couple_1',
    primaryPhoto: 'https://images.unsplash.com/photo-1510060938367-e94025ad5323?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80',
    secondaryPhotos: [
      'https://images.unsplash.com/photo-1494774157365-9e04c6720e47?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1521404099395-ac99fb8dffa9?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80'
    ],
    profileName: 'Aisha & Rohan',
    bio: 'Big foodies looking to explore new cafes and host weekend dinners!',
    relationshipStatus: 'Married',
    location: { city: 'Bengaluru', country: 'India' },
    isProfileComplete: true,
    answers: [
      { questionId: 'q1', selectedOptionIds: ['q1-career'] },
      { questionId: 'q3', selectedOptionIds: ['q3-restaurants', 'q3-dinners-home', 'q3-trips'] },
      { questionId: 'q4', selectedOptionIds: ['q4-once-week'] },
      { questionId: 'q5', selectedOptionIds: ['q5-shared-interests', 'q5-structured-plans'] },
      { questionId: 'q8', selectedOptionIds: ['q8-1'] }
    ]
  },
  {
    coupleId: 'seed_couple_2',
    primaryPhoto: 'https://images.unsplash.com/photo-1516059129528-94b6330ce4f7?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80',
    secondaryPhotos: ['https://images.unsplash.com/photo-1520694478166-daaaaaec74b4?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80'],
    profileName: 'Priya & Rahul',
    bio: 'Avid travelers and hikers. Always planning the next weekend trip.',
    relationshipStatus: 'Engaged',
    location: { city: 'Mumbai', country: 'India' },
    isProfileComplete: true,
    answers: [
      { questionId: 'q1', selectedOptionIds: ['q1-living'] },
      { questionId: 'q3', selectedOptionIds: ['q3-outdoor', 'q3-trips'] },
      { questionId: 'q4', selectedOptionIds: ['q4-twice-month'] },
      { questionId: 'q5', selectedOptionIds: ['q5-similar-stage'] },
      { questionId: 'q8', selectedOptionIds: ['q8-1'] }
    ]
  },
  {
    coupleId: 'seed_couple_3',
    primaryPhoto: 'https://images.unsplash.com/photo-1542157585-ef20bfcce579?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80',
    secondaryPhotos: [],
    profileName: 'Simran & Kunal',
    bio: 'Introverted couple who love art, cultural events, and quiet wine nights.',
    relationshipStatus: 'Dating',
    location: { city: 'New Delhi', country: 'India' },
    isProfileComplete: true,
    answers: [
      { questionId: 'q1', selectedOptionIds: ['q1-settled'] },
      { questionId: 'q3', selectedOptionIds: ['q3-cultural', 'q3-drinks'] },
      { questionId: 'q4', selectedOptionIds: ['q4-once-month'] },
      { questionId: 'q5', selectedOptionIds: ['q5-small-groups'] },
      { questionId: 'q8', selectedOptionIds: ['q8-2'] }
    ]
  },
  {
    coupleId: 'seed_couple_4',
    primaryPhoto: 'https://images.unsplash.com/photo-1523438885200-e635ba2c371e?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80',
    secondaryPhotos: [],
    profileName: 'Kavita & Amit',
    bio: 'Tennis partners and fitness enthusiasts. Looking for other active couples!',
    relationshipStatus: 'Married',
    location: { city: 'Bengaluru', country: 'India' },
    isProfileComplete: true,
    answers: [
      { questionId: 'q1', selectedOptionIds: ['q1-settled'] },
      { questionId: 'q3', selectedOptionIds: ['q3-fitness', 'q3-outdoor'] },
      { questionId: 'q4', selectedOptionIds: ['q4-once-week'] },
      { questionId: 'q5', selectedOptionIds: ['q5-structured-plans'] }
    ]
  },
  {
    coupleId: 'seed_couple_5',
    primaryPhoto: 'https://images.unsplash.com/photo-1533228892549-78356748ed2c?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80',
    secondaryPhotos: [],
    profileName: 'Zara & Neel',
    bio: 'Techies by day, musicians by night. Love jam sessions and live gigs.',
    relationshipStatus: 'Dating',
    location: { city: 'Bengaluru', country: 'India' },
    isProfileComplete: true,
    answers: [
      { questionId: 'q1', selectedOptionIds: ['q1-career'] },
      { questionId: 'q3', selectedOptionIds: ['q3-cultural', 'q3-drinks'] },
      { questionId: 'q4', selectedOptionIds: ['q4-twice-month'] }
    ]
  },
  {
    coupleId: 'seed_couple_6',
    primaryPhoto: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80',
    secondaryPhotos: [],
    profileName: 'Anjali & Vikram',
    bio: 'Passionate about sustainable living and weekend farming.',
    relationshipStatus: 'Married',
    location: { city: 'Pune', country: 'India' },
    isProfileComplete: true,
    answers: [
      { questionId: 'q1', selectedOptionIds: ['q1-settled'] },
      { questionId: 'q3', selectedOptionIds: ['q3-outdoor'] },
      { questionId: 'q4', selectedOptionIds: ['q4-once-month'] }
    ]
  },
  {
    coupleId: 'seed_couple_7',
    primaryPhoto: 'https://images.unsplash.com/photo-1522529599102-193c0d76b5b6?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80',
    secondaryPhotos: [],
    profileName: 'Sana & Kabir',
    bio: 'Just moved to the city! Looking for friends to explore local board game cafes.',
    relationshipStatus: 'Dating',
    location: { city: 'Bengaluru', country: 'India' },
    isProfileComplete: true,
    answers: [
      { questionId: 'q1', selectedOptionIds: ['q1-career'] },
      { questionId: 'q3', selectedOptionIds: ['q3-restaurants', 'q3-cultural'] },
      { questionId: 'q4', selectedOptionIds: ['q4-once-week'] }
    ]
  },
  {
    coupleId: 'seed_couple_8',
    primaryPhoto: 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80',
    secondaryPhotos: [],
    profileName: 'Maya & Ishaan',
    bio: 'Photographers who love chasing sunsets and capturing city life.',
    relationshipStatus: 'Engaged',
    location: { city: 'Hyderabad', country: 'India' },
    isProfileComplete: true,
    answers: [
      { questionId: 'q1', selectedOptionIds: ['q1-living'] },
      { questionId: 'q3', selectedOptionIds: ['q3-trips', 'q3-outdoor'] },
      { questionId: 'q4', selectedOptionIds: ['q4-twice-month'] }
    ]
  }
];

const COMMUNITIES = [
  {
    name: 'Weekend Getaways India',
    description: 'A close-knit group for couples strictly interested in escaping the city traffic to find fresh air and calm mountains.',
    city: 'All Cities',
    coverImageUrl: 'https://images.unsplash.com/photo-1506869640319-ce1a46062c92?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80',
    tags: ['Travel', 'Nature', 'Couples']
  },
  {
    name: 'Bangalore Foodies',
    description: 'We love testing out new microbreweries and hidden culinary gems across Indiranagar, Koramangala and beyond!',
    city: 'Bengaluru',
    coverImageUrl: 'https://images.unsplash.com/photo-1511988617509-a57c8a288659?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80',
    tags: ['Food', 'Drinks', 'Nightlife']
  },
  {
    name: 'Mumbai Art Crawl',
    description: 'Exploring art galleries, experimental theatre, and vibrant cultural exhibitions through the city together.',
    city: 'Mumbai',
    coverImageUrl: 'https://images.unsplash.com/photo-1542144612-1b3641ec3459?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80',
    tags: ['Art', 'Culture', 'Museums']
  }
];

const seedData = async () => {
  try {
    if (!process.env.MONGODB_URI) {
      logger.warn('No MONGODB_URI found, using default localhost');
    }
    
    await mongoose.connect(MONGODB_URI);
    logger.info('Connected to MongoDB for Seeding...');

    // Clean up
    await User.deleteMany({ phone: { $regex: '^seed_' } });
    await Couple.deleteMany({ coupleId: { $regex: '^seed_' } });
    await Community.deleteMany(); // Reset all communities

    logger.info('Cleaned up old seeds.');

    // Seed Couples & their base Users
    for (let i = 0; i < COUPLES.length; i++) {
       const cd = COUPLES[i];
       
       // Create dummy user 1
       const user1 = await User.create({
         phone: `seed_phone1_${i}`,
         name: cd.profileName.split(' & ')[0],
         coupleId: cd.coupleId,
         role: 'primary',
         isPhoneVerified: true
       });

       // Create dummy user 2
       const user2 = await User.create({
         phone: `seed_phone2_${i}`,
         name: cd.profileName.split(' & ')[1],
         coupleId: cd.coupleId,
         role: 'partner',
         isPhoneVerified: true
       });

       await Couple.create({
         ...cd,
         partner1: user1._id,
         partner2: user2._id
       });
    }

    logger.info(`Successfully seeded ${COUPLES.length} couples!`);

    // Seed Communities
    // We will attach the seeded couples to these communities as members to make the counts and visuals cool!
    const allCouples = await Couple.find({ coupleId: { $regex: '^seed_' } });
    for (let i = 0; i < COMMUNITIES.length; i++) {
        const commData = COMMUNITIES[i];
        await Community.create({
          ...commData,
          members: [allCouples[i % allCouples.length]._id, allCouples[(i + 1) % allCouples.length]._id],
          admins: [allCouples[i % allCouples.length]._id],
          joinRequests: []
        });
    }

    logger.info(`Successfully seeded ${COMMUNITIES.length} communities!`);

    process.exit(0);
  } catch (error) {
    logger.error('Error during seeding:', error);
    process.exit(1);
  }
};

seedData();
