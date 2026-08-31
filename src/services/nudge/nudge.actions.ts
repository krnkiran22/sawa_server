import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';
import { sendLoveToPartner } from '../us.service';

/**
 * Quick-reply actions: what a tapped WhatsApp button does inside Sawa without
 * the app being opened. The loop closes on WhatsApp itself; the deep link is
 * still there for "come see it". Every action counts as the nudge's
 * conversion and as a click (engagement happened).
 *
 *   open     acknowledge only (a "Got it" on a fridge note)
 *   us_love  send love back to the partner, exactly as the Us tab does
 */
export type QuickReplyAction = 'open' | 'us_love';

export async function executeQuickReply(
  delivery: { id: string; family: string; coupleId: string; recipientUserId: string },
  action: string,
): Promise<void> {
  const now = new Date();
  try {
    if (action === 'us_love') {
      await sendLoveToPartner({ coupleId: delivery.coupleId, senderUserId: delivery.recipientUserId, via: 'whatsapp' });
    } else if (action !== 'open') {
      logger.info(`[Nudge] unknown quick-reply action '${action}' on ${delivery.family}`);
      return;
    }
    await prisma.nudgeDelivery.update({
      where: { id: delivery.id },
      data: {
        clickedAt: now,
        convertedAt: now,
        convertedEventType: `quick_reply:${action}`,
      },
    });
  } catch (err: any) {
    logger.warn(`[Nudge] quick reply ${action} failed: ${err?.message ?? err}`);
  }
}
