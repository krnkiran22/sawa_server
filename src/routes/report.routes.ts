import express from 'express';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/authenticate';

const router = express.Router();

router.post('/', authenticate, async (req: any, res) => {
    try {
        const { targetId, reason, details } = req.body;
        const reporterId = req.user.coupleId;

        if (!targetId || !reason) {
            return res.status(400).json({ success: false, message: 'Missing target or reason' });
        }

        const report = await prisma.report.create({
            data: {
                reporterId: reporterId,
                targetId: targetId,
                reason,
                details: details || '',
                status: 'pending'
            }
        });

        // 1. Add to blocked list in Couple
        await prisma.couple.update({
            where: { coupleId: reporterId },
            data: {
              blocked: {
                push: targetId
              }
            }
        });

        // 2. If it's a community, leave it automatically
        const isComm = await prisma.community.findUnique({ where: { id: targetId } });
        if (isComm) {
            await prisma.communityMember.deleteMany({
                where: {
                    communityId: targetId,
                    coupleId: reporterId
                }
            });
        }

        res.status(201).json({ success: true, data: { ...report, _id: report.id } });
    } catch (err: any) {
        console.error('[REPORT ERROR]', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

export default router;
