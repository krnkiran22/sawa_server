import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { User } from '../models/User.model';
import { Couple } from '../models/Couple.model';
import { Community } from '../models/Community.model';
import { Message } from '../models/Message.model';
import { Match } from '../models/Match.model';
import { logger } from '../utils/logger';

// Load env from root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/sawa';

const COUPLES = [
  {
    coupleId: 'seed_couple_1',
    primaryPhoto: 'https://images.pexels.com/photos/1024960/pexels-photo-1024960.jpeg?auto=compress&cs=tinysrgb&w=800', // Romantic couple
    secondaryPhotos: [
      'https://images.pexels.com/photos/1024967/pexels-photo-1024967.jpeg?auto=compress&cs=tinysrgb&w=800'
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
    primaryPhoto: 'https://images.pexels.com/photos/1415131/pexels-photo-1415131.jpeg?auto=compress&cs=tinysrgb&w=800', // Travel couple
    secondaryPhotos: ['https://images.pexels.com/photos/1415128/pexels-photo-1415128.jpeg?auto=compress&cs=tinysrgb&w=800'],
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
    primaryPhoto: 'https://images.pexels.com/photos/935789/pexels-photo-935789.jpeg?auto=compress&cs=tinysrgb&w=800', // Cafe couple
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
    primaryPhoto: 'https://images.pexels.com/photos/1266057/pexels-photo-1266057.jpeg?auto=compress&cs=tinysrgb&w=800', // Active couple
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
    primaryPhoto: 'https://images.pexels.com/photos/665044/pexels-photo-665044.jpeg?auto=compress&cs=tinysrgb&w=800', // Music/Art couple
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
    primaryPhoto: 'https://images.pexels.com/photos/1652353/pexels-photo-1652353.jpeg?auto=compress&cs=tinysrgb&w=800', // Nature couple
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
  }
];

const COMMUNITIES = [
  {
    name: 'Gourmet Couples Club',
    description: 'A community for couples who bond over finding the best brunch spots, hidden cafes, and street food. Bring your appetite!',
    city: 'All Cities',
    coverImageUrl: 'https://images.pexels.com/photos/1267320/pexels-photo-1267320.jpeg?auto=compress&cs=tinysrgb&w=800', // Restaurant/Chef image
    tags: ['Food', 'Social', 'Experience']
  },
  {
    name: 'Brew & Bond',
    description: 'We love testing out new microbreweries and hidden culinary gems across Indiranagar, Koramangala and beyond!',
    city: 'Bengaluru',
    coverImageUrl: 'https://images.pexels.com/photos/302899/pexels-photo-302899.jpeg?auto=compress&cs=tinysrgb&w=800', // Cafe image
    tags: ['Coffee', 'Drinks', 'Network']
  },
  {
    name: 'Mumbai Art Crawl',
    description: 'Exploring art galleries, experimental theatre, and vibrant cultural exhibitions through the city together.',
    city: 'Mumbai',
    coverImageUrl: 'https://images.pexels.com/photos/1183992/pexels-photo-1183992.jpeg?auto=compress&cs=tinysrgb&w=800', // Art/Museum image
    tags: ['Art', 'Culture', 'Museums']
  },
  {
    name: 'Beach & Chill',
    description: 'For couples based in or visiting Chennai who love beach volleyball, sunrise yoga, or just watching the waves at Marina.',
    city: 'Chennai',
    coverImageUrl: 'https://images.pexels.com/photos/1430675/pexels-photo-1430675.jpeg?auto=compress&cs=tinysrgb&w=800', // Beach image
    tags: ['Beach', 'Outdoor', 'Relax']
  }
];

const seedData = async () => {
  try {
    if (!process.env.MONGODB_URI) {
      logger.warn('No MONGODB_URI found, using default localhost');
    }
    
    await mongoose.connect(MONGODB_URI);
    logger.info('Connected to MongoDB for Seeding...');

    // FULL FLUSH - Delete everything
    logger.info('Flushing database fully...');
    await User.deleteMany({});
    await Couple.deleteMany({});
    await Community.deleteMany({});
    await Message.deleteMany({});
    await Match.deleteMany({});

    logger.info('Database flushed successfully.');

    // Seed Couples & their base Users
    for (let i = 0; i < COUPLES.length; i++) {
       const cd = COUPLES[i];
       
       const user1 = await User.create({
         phone: `seed_phone1_${i}`,
         name: cd.profileName.split(' & ')[0],
         coupleId: cd.coupleId,
         role: 'primary',
         isPhoneVerified: true
       });

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

    const allCouples = await Couple.find();
    for (let i = 0; i < COMMUNITIES.length; i++) {
        const commData = COMMUNITIES[i];
        // Assign members from seeded couples
        const member1 = allCouples[i % allCouples.length]._id;
        const member2 = allCouples[(i + 1) % allCouples.length]._id;

        await Community.create({
          ...commData,
          members: [member1, member2],
          admins: [member1],
          joinRequests: []
        });
    }

    logger.info(`Successfully seeded ${COMMUNITIES.length} communities!`);
    
    // Add some mutual matches for testing chat immediately
    // Couple 0 and Couple 1 match
    if (allCouples.length >= 2) {
       await Match.create({
         couple1: allCouples[0]._id,
         couple2: allCouples[1]._id,
         status: 'accepted',
         actionBy: allCouples[1]._id
       });
       logger.info('Seeded a mutual match between first two couples for chat testing!');
    }

    process.exit(0);
  } catch (error) {
    logger.error('Error during seeding:', error);
    process.exit(1);
  }
};

seedData();
