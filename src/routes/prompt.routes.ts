import express from 'express';
import { prisma } from '../lib/prisma';

const router = express.Router();

router.get('/active', async (req, res) => {
    try {
        const prompts = await prisma.prompt.findMany({ 
            where: { isActive: true },
            select: { id: true, text: true, category: true }
        });
        const formatted = prompts.map(p => ({ ...p, _id: p.id }));
        res.status(200).json({ success: true, data: formatted });
    } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
    }
});

export default router;
