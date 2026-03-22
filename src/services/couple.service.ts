import { prisma } from '../lib/prisma';
import { AppError } from '../utils/AppError';
import { logger } from '../utils/logger';

export class CoupleService {
  /**
   * Upsert the couple document and update both users' details
   */
  async setupProfile(
    primaryUserId: string,
    coupleId: string,
    data: {
      yourName: string;
      yourDob?: string;
      yourEmail?: string;
      partnerName: string;
      partnerDob?: string;
      partnerEmail?: string;
      relationshipStatus?: string;
      location?: { city?: string; country?: string };
    }
  ) {
    // 0. Preliminary validation: Ensure both emails are not the same
    if (data.yourEmail && data.partnerEmail && data.yourEmail.toLowerCase() === data.partnerEmail.toLowerCase()) {
        logger.warn(`[CoupleService.setupProfile] Partners attempted to use same email: ${data.yourEmail}`);
    }

    // 1. Identify roles
    const users = await prisma.user.findMany({ where: { coupleId } });
    const primaryUser = users.find((u: any) => u.role === 'primary');
    const partnerUser = users.find((u: any) => u.role === 'partner');

    // 2. Update the Primary User (Top form field)
    if (primaryUser) {
        try {
            await prisma.user.update({
                where: { id: primaryUser.id },
                data: { 
                    name: data.yourName || undefined, 
                    dob: data.yourDob || undefined, 
                    email: data.yourEmail || undefined 
                }
            });
        } catch (err: any) {
            if (err.code === 'P2002' && err.meta?.target?.includes('email')) {
                logger.warn(`[CoupleService.setupProfile] Primary email conflict, skipping.`);
                await prisma.user.update({
                    where: { id: primaryUser.id },
                    data: { name: data.yourName || undefined, dob: data.yourDob || undefined }
                });
            }
        }
    }

    // 3. Update the Partner User (Pink form field)
    if (partnerUser) {
        try {
            await prisma.user.update({
                where: { id: partnerUser.id },
                data: { 
                    name: data.partnerName || undefined, 
                    dob: data.partnerDob || undefined, 
                    email: data.partnerEmail || undefined 
                }
            });
        } catch (err: any) {
            if (err.code === 'P2002' && err.meta?.target?.includes('email')) {
                logger.warn(`[CoupleService.setupProfile] Partner email conflict, skipping.`);
                await prisma.user.update({
                    where: { id: partnerUser.id },
                    data: { name: data.partnerName || undefined, dob: data.partnerDob || undefined }
                });
            }
        }
    }

    // 4. Update the Couple Profile
    const profileName = `${data.yourName} & ${data.partnerName}`;

    await prisma.couple.upsert({
        where: { coupleId },
        create: {
            coupleId,
            partner1Id: primaryUser?.id || null,
            partner2Id: partnerUser?.id || null,
            profileName,
            relationshipStatus: data.relationshipStatus,
            locationCity: data.location?.city || 'Unknown',
            locationCountry: data.location?.country || 'India',
            isProfileComplete: false,
        },
        update: {
            partner1Id: primaryUser?.id || undefined,
            partner2Id: partnerUser?.id || undefined,
            profileName,
            relationshipStatus: data.relationshipStatus,
            locationCity: data.location?.city || undefined,
            locationCountry: data.location?.country || undefined,
        }
    });
  }

  /**
   * Upload photos
   */
  async uploadPhotos(
    coupleId: string,
    data: { 
      primaryPhotoBase64?: string; 
      secondaryPhotosBase64?: string[]; 
      keepSecondaryPhotoUrls?: string[];
    }
  ) {
    const updateData: any = {};
    
    if (data.primaryPhotoBase64 && data.primaryPhotoBase64.length > 10) {
      const prefix = data.primaryPhotoBase64.startsWith('data:') ? '' : 'data:image/jpeg;base64,';
      updateData.primaryPhoto = prefix + data.primaryPhotoBase64;
    }

    const existingToKeep = data.keepSecondaryPhotoUrls || [];
    const newPhotos = (data.secondaryPhotosBase64 || [])
      .filter(b64 => b64 && b64.length > 10)
      .map(b64 => (b64.startsWith('data:') ? b64 : 'data:image/jpeg;base64,' + b64));

    if (data.keepSecondaryPhotoUrls !== undefined || data.secondaryPhotosBase64 !== undefined) {
      updateData.secondaryPhotos = [...existingToKeep, ...newPhotos].slice(0, 3);
    }

    await prisma.couple.update({
        where: { coupleId },
        data: updateData
    });
  }

  /**
   * Submit questionnaire answers and mark onboarding COMPLETE
   */
  async submitAnswers(coupleId: string, answers: any[]) {
    // Prisma treats arrays of JSON objects as Json[] in PostgreSQL if defined so, 
    // but in schema.prisma I defined them as specific models if they were important.
    // However, I used Json for answers if I remember correctly.
    // Let's check schema.prisma
    
    await prisma.couple.update({
      where: { coupleId },
      data: { 
          answers: {
              deleteMany: {},
              create: answers.map((a: any) => ({
                  questionId: a.questionId,
                  selectedOptionIds: a.selectedOptionIds
              }))
          },
          isProfileComplete: true 
      }
    });

    // ─── AI BIO GENERATION (SYNCHRONOUS FOR ONBOARDING RESPONSE) ───────────
    try {
        const questionMap: Record<string, string> = {
          q1: 'Life Stage', q2: 'Couple Personality', q3: 'Favorite Activities',
          q4: 'Meeting Frequency', q5: 'What makes a good match', q6: 'Things to avoid',
        };
        const optionLabelMap: Record<string, string> = {
          'q1-career': 'Building careers', 'q1-family': 'Family first', 'q1-settled': 'Newly settled', 'q1-living': 'Living it up',
          'q2-hosts': "The Hosts", 'q2-yes-couple': "The 'yes' couple", 'q2-planners': 'The Planners', 'q2-explorers': 'The Explorers',
          'q3-dinners-home': 'Dinners at home', 'q3-restaurants': 'Exploring new restaurants', 'q3-outdoor': 'Outdoor activities/nature',
          'q3-cultural': 'Cultural events/museums', 'q3-drinks': 'Casual drinks', 'q3-trips': 'Weekend trips/travel',
          'q4-once-month': 'Meeting once a month', 'q4-twice-month': 'Meeting twice a month', 'q4-once-week': 'Meeting once a week', 'q4-when-fits': 'Meeting whenever it fits',
          'q5-similar-stage': 'Matches in a similar life stage', 'q5-shared-interests': 'Shared interests', 'q5-small-groups': 'Small group settings',
          'q5-structured-plans': 'Structured plans', 'q5-clear-boundaries': 'Clear boundaries', 'q5-weekend-availability': 'Weekend availability',
          'q6-late-night': 'Avoiding late-night plans', 'q6-large-groups': 'Avoiding very large groups', 'q6-alcohol-centric': 'Avoiding alcohol-centric meetups',
          'q6-last-minute': 'Avoiding last-minute/spontaneous plans',
        };

        const qaData = answers.map((a: any) => ({
          question: questionMap[a.questionId] || 'About us',
          answers: a.selectedOptionIds.map((id: string) => optionLabelMap[id] || id),
        }));

        const { generateCoupleBio } = require('../utils/ai');
        const aiResponse = await generateCoupleBio(qaData);

        if (aiResponse) {
          const updateObj: any = {};
          if (aiResponse.bio) updateObj.bio = aiResponse.bio;
          if (aiResponse.matchCriteria && aiResponse.matchCriteria.length > 0) {
            updateObj.matchCriteria = aiResponse.matchCriteria;
          }
          await prisma.couple.update({ where: { coupleId }, data: updateObj });
        }
    } catch (aiErr) {
        logger.error(`[CoupleService] AI background generation failed:`, aiErr);
    }
  }

  async updateProfile(
    coupleId: string,
    data: {
      bio?: string;
      relationshipStatus?: string;
      preferences?: any;
      yourName?: string; yourDob?: string; yourEmail?: string;
      partnerName?: string; partnerDob?: string; partnerEmail?: string;
      // Added photo support directly in update
      primaryPhotoBase64?: string;
      secondaryPhotosBase64?: string[];
      keepSecondaryPhotoUrls?: string[];
    },
    requestingUserId?: string
  ) {
    const coupleDoc = await prisma.couple.findUnique({ where: { coupleId } });
    if (!coupleDoc) throw new AppError('Couple not found', 404);

    const updateData: any = {};
    if (data.bio !== undefined) updateData.bio = data.bio;
    if (data.relationshipStatus !== undefined) updateData.relationshipStatus = data.relationshipStatus;
    
    // 1. Photos processing
    if (data.primaryPhotoBase64 && data.primaryPhotoBase64.length > 10) {
      updateData.primaryPhoto = data.primaryPhotoBase64.startsWith('data:') 
        ? data.primaryPhotoBase64 
        : 'data:image/jpeg;base64,' + data.primaryPhotoBase64;
    }

    if (data.secondaryPhotosBase64 !== undefined || data.keepSecondaryPhotoUrls !== undefined) {
      const existingToKeep = data.keepSecondaryPhotoUrls || [];
      const newPhotos = (data.secondaryPhotosBase64 || [])
        .filter(b64 => b64 && b64.length > 10)
        .map(b64 => b64.startsWith('data:') ? b64 : 'data:image/jpeg;base64,' + b64);
      updateData.secondaryPhotos = [...existingToKeep, ...newPhotos].slice(0, 3);
    }

    // 2. Map preferences if provided
    if (data.preferences) {
        if (data.preferences.meetingFrequency) updateData.meetingFrequency = data.preferences.meetingFrequency;
        if (data.preferences.socialVibes) updateData.socialVibes = data.preferences.socialVibes;
        if (data.preferences.activities) updateData.activities = data.preferences.activities;
        if (data.preferences.avoidances) updateData.avoidances = data.preferences.avoidances;
        
        if (data.preferences.matchCriteria) {
            updateData.matchCriteria = Array.isArray(data.preferences.matchCriteria) 
                ? data.preferences.matchCriteria 
                : [data.preferences.matchCriteria];
        }
    }
    // Explicit check for matchCriteria at top level (if app sends it that way)
    if ((data as any).matchCriteria) {
        updateData.matchCriteria = Array.isArray((data as any).matchCriteria)
            ? (data as any).matchCriteria
            : [(data as any).matchCriteria];
    }

    // 3. Identity roles for names update
    const users = await prisma.user.findMany({ where: { coupleId } });
    const primaryUser = users.find((u: any) => u.role === 'primary');
    const partnerUser = users.find((u: any) => u.role === 'partner');

    if (data.yourName || data.partnerName) {
      const pName = data.yourName || primaryUser?.name || 'User 1';
      const sName = data.partnerName || partnerUser?.name || 'User 2';
      updateData.profileName = `${pName} & ${sName}`;
    }

    await prisma.couple.update({ where: { coupleId }, data: updateData });

    // 4. Update individual Users based on Roles (Top form -> Primary, Bottom form -> Partner)
    if (primaryUser && (data.yourName || data.yourDob || data.yourEmail)) {
      try {
        await prisma.user.update({
            where: { id: primaryUser.id },
            data: {
              name: data.yourName || undefined,
              dob: data.yourDob || undefined,
              email: data.yourEmail || undefined,
            }
        });
      } catch (err: any) {
        if (err.code === 'P2002' && err.meta?.target?.includes('email')) {
             logger.warn(`[CoupleService.updateProfile] Email conflict for primaryUser, skipping email update.`);
             await prisma.user.update({
                where: { id: primaryUser.id },
                data: { name: data.yourName || undefined, dob: data.yourDob || undefined }
             });
        }
      }
    }

    if (partnerUser && (data.partnerName || data.partnerDob || data.partnerEmail)) {
      try {
        await prisma.user.update({
            where: { id: partnerUser.id },
            data: {
              name: data.partnerName || undefined,
              dob: data.partnerDob || undefined,
              email: data.partnerEmail || undefined,
            }
        });
      } catch (err: any) {
        if (err.code === 'P2002' && err.meta?.target?.includes('email')) {
             logger.warn(`[CoupleService.updateProfile] Email conflict for partnerUser, skipping email update.`);
             await prisma.user.update({
                where: { id: partnerUser.id },
                data: { name: data.partnerName || undefined, dob: data.partnerDob || undefined }
             });
        }
      }
    }

    const updated = await prisma.couple.findUnique({ where: { coupleId }, include: { partner1: true, partner2: true } });
    return this._formatCouple(updated);
  }

  private _formatCouple(couple: any) {
    if (!couple) return null;
    const formatted = { 
        ...couple, 
        _id: couple.id,
        // Add legacy alias for "What we are looking for"
        lookingFor: (couple.matchCriteria && couple.matchCriteria.length > 0) ? couple.matchCriteria[0] : ""
    };
    if (formatted.partner1) formatted.partner1._id = formatted.partner1.id;
    if (formatted.partner2) formatted.partner2._id = formatted.partner2.id;
    return formatted;
  }

  async getCouple(coupleId: string): Promise<any | null> {
    const couple = await prisma.couple.findUnique({
      where: { coupleId },
      include: {
        partner1: true,
        partner2: true,
        communityMembers: {
            include: { community: true }
        }
      }
    });

    if (!couple) return null;

    const communities = couple.communityMembers.map((m: any) => ({
      id: m.community.id,
      title: m.community.name,
      subtitle: m.community.city,
      note: m.community.description,
      imageUri: m.community.coverImageUrl
    }));

    return this._formatCouple({
      ...couple,
      communities
    });
  }

  async subscribe(coupleId: string) {
    return prisma.couple.update({
      where: { coupleId },
      data: { isSubscribed: true }
    });
  }

  async blockCouple(meId: string, targetId: string) {
    const me = await prisma.couple.findUnique({ where: { id: meId } });
    const blocked = me?.blocked || [];
    if (!blocked.includes(targetId)) {
        return prisma.couple.update({
            where: { id: meId },
            data: { blocked: { set: [...blocked, targetId] } }
        });
    }
    return me;
  }

  async unblockCouple(meId: string, targetId: string) {
    const me = await prisma.couple.findUnique({ where: { id: meId } });
    const blocked = (me?.blocked || []).filter((id: string) => id !== targetId);
    return prisma.couple.update({
        where: { id: meId },
        data: { blocked: { set: blocked } }
    });
  }

  async getBlockedCouples(meId: string) {
    const me = await prisma.couple.findUnique({ where: { id: meId } });
    if (!me?.blocked.length) return [];
    return prisma.couple.findMany({
        where: { id: { in: me.blocked } },
        select: { id: true, profileName: true, primaryPhoto: true, locationCity: true, coupleId: true }
    });
  }

  async deleteMyCouple(coupleId: string) {
    const couple = await prisma.couple.findUnique({ where: { coupleId } });
    if (!couple) return { success: true };

    // Delete dependent records manually to satisfy foreign key constraints
    await prisma.onboardingAnswer.deleteMany({ where: { coupleId } });
    await prisma.message.deleteMany({ where: { senderId: coupleId } });
    await prisma.notification.deleteMany({ 
      where: { OR: [{ recipientId: coupleId }, { senderId: coupleId }] } 
    });
    
    await prisma.match.deleteMany({
      where: { OR: [{ couple1Id: coupleId }, { couple2Id: coupleId }, { actionById: coupleId }] }
    });
    
    await prisma.communityMember.deleteMany({ where: { coupleId } });
    await prisma.communityAdmin.deleteMany({ where: { coupleId } });
    await prisma.communityJoinRequest.deleteMany({ where: { coupleId } });
    
    await prisma.report.deleteMany({
      where: { OR: [{ reporterId: coupleId }, { targetId: coupleId }] }
    });

    // 2. Delete the associated Users and finally the Couple
    await prisma.user.deleteMany({ where: { coupleId } });
    await prisma.couple.delete({ where: { coupleId } });

    return { success: true };
  }
}

export const coupleService = new CoupleService();
