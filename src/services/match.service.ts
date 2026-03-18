import mongoose from 'mongoose';
import { Couple } from '../models/Couple.model';
import { Match } from '../models/Match.model';
import { AppError } from '../utils/AppError';
import { logger } from '../utils/logger';

export class MatchService {
  /**
   * Fetches the discovery feed of couples for the current user.
   * If there are no seeded couples in the database other than the requester, 
   * this seeds a dummy couple (Arjun & Meera) to test the UI.
   */
  async getDiscoveryFeed(requestingCoupleId: string) {
    const me = await Couple.findOne({ coupleId: requestingCoupleId });
    if (!me) throw new AppError('Couple profile not found', 404);

    // Get all couple _ids that we have already interacted with
    const interactions = await Match.find({ couple1: me._id }).select('couple2');
    const interactedIds = interactions.map(m => m.couple2);

    // Find couples that are not us, and not interacted with
    let potentialCouples = await Couple.find({
      _id: { $ne: me._id, $nin: interactedIds },
      isProfileComplete: true, 
    }).limit(10); // Fetch up to 10 at a time

    // --- Developer Seed Fallback ---
    // If empty or too few (because it's just the user testing), provide more dummy couples
    if (potentialCouples.length < 3) {
      logger.info(`[MatchService] Discovery feed too small (${potentialCouples.length}), adding dummy fallbacks`);
      
      const dummyData = [
        { name: 'Arjun & Meera', photo: 'https://images.unsplash.com/photo-1511285560929-80b456fea0bc?auto=format&fit=crop&q=80' },
        { name: 'Sameer & Zara', photo: 'https://images.unsplash.com/photo-1533228892549-78356748ed2c?auto=format&fit=crop&q=80' },
        { name: 'Rohan & Ananya', photo: 'https://images.unsplash.com/photo-1510060938367-e94025ad5323?auto=format&fit=crop&q=80' },
        { name: 'Ishaan & Maya', photo: 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?auto=format&fit=crop&q=80' },
      ];

      for (const d of dummyData) {
        // Only add if not already in the list by name
        if (!potentialCouples.some(c => c.profileName === d.name)) {
           // We create temporary transient objects for the feed if they don't exist in DB
           // but for actual interaction safety we should technically check DB
           const mockId = new mongoose.Types.ObjectId();
           potentialCouples.push({
             _id: mockId,
             coupleId: `dummy-${mockId.toString().slice(-6)}`,
             profileName: d.name,
             primaryPhoto: d.photo,
             location: { city: 'New Delhi', country: 'India' },
             isProfileComplete: true,
             answers: []
           } as any);
        }
      }
    }

    // Decorate the couples with dummy insights and tags
    return potentialCouples.map(c => ({
      _id: c._id,
      coupleId: c.coupleId,
      profileName: c.profileName,
      primaryPhoto: c.primaryPhoto || 'https://images.unsplash.com/photo-1511285560929-80b456fea0bc?auto=format&fit=crop&w=400&q=80',
      location: c.location?.city || 'Unknown',
      distance: Math.floor(Math.random() * 10) + 2 + ' km away', // dummy distance
      tags: ['Discovery', 'Adventure', 'Book', 'Fitness'].sort(() => 0.5 - Math.random()).slice(0, 3), 
      matchScore: Math.floor(Math.random() * 20) + 80, 
      insights: [
        'Both career-focused and socially intentional',
        'Similar pace - you both prefer meeting once or twice a month',
      ]
    }));
  }

  /**
   * Say hello (like) to a couple
   */
  async sayHello(requestingCoupleId: string, targetCoupleIdStr: string) {
    const me = await Couple.findOne({ coupleId: requestingCoupleId });
    if (!me) throw new AppError('Profile not found', 404);

    const targetCouple = await Couple.findById(targetCoupleIdStr);
    if (!targetCouple) throw new AppError('Target profile not found', 404);

    // Check if they already liked us (a match)
    const reverseMatch = await Match.findOne({ couple1: targetCouple._id, couple2: me._id, status: 'pending' });
    
    if (reverseMatch) {
      // It's a match!
      reverseMatch.status = 'accepted';
      reverseMatch.actionBy = me._id;
      await reverseMatch.save();

      // create forward match for easier querying
      await Match.create({
        couple1: me._id,
        couple2: targetCouple._id,
        status: 'accepted',
        actionBy: me._id,
      });

      return { isMatch: true };
    }

    // Otherwise, create a pending like
    await Match.create({
      couple1: me._id,
      couple2: targetCouple._id,
      status: 'pending',
      actionBy: me._id,
    });

    return { isMatch: false };
  }

  /**
   * Skip a couple
   */
  async skipCouple(requestingCoupleId: string, targetCoupleIdStr: string) {
    const me = await Couple.findOne({ coupleId: requestingCoupleId });
    if (!me) throw new AppError('Profile not found', 404);

    const targetCouple = await Couple.findById(targetCoupleIdStr);
    if (!targetCouple) throw new AppError('Target profile not found', 404);

    await Match.create({
      couple1: me._id,
      couple2: targetCouple._id,
      status: 'skipped',
      actionBy: me._id,
    });

    return { skipped: true };
  }
}

export const matchService = new MatchService();
