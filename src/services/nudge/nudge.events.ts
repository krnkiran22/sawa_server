import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';
import { familyFromPushData, HARD_EXCLUDED_FAMILIES } from '../../constants/nudge';

/**
 * The outbox. Producers write an EngagementEvent row; the worker
 * (jobs/nudgeWorker.ts → nudge.engine.processOutbox) turns it into per-recipient
 * channel deliveries. Writing a row is cheap and never throws to the caller:
 * a nudge that fails to record must never fail the moment that caused it.
 *
 * Two entry points:
 *   • emitDomainEvent  — explicit, for moments with no push (signup verified,
 *     journeys) or callers that already know their recipients. Accepts a
 *     transaction client so the row commits with the write it announces.
 *   • recordPushEvent  — the bridge from the existing 21 push call sites:
 *     push.service calls it with the push payload and the engine derives the
 *     family from `data.subtype`/`data.type`. No call site had to change.
 */

type Db = PrismaClient | Prisma.TransactionClient;

export interface DomainEventInput {
  /** Family key (constants/nudge.ts). */
  type: string;
  coupleId: string;
  actorUserId?: string | null;
  recipientUserIds: string[];
  payload?: Record<string, unknown>;
}

export async function emitDomainEvent(input: DomainEventInput, db: Db = prisma): Promise<string | null> {
  try {
    const row = await db.engagementEvent.create({
      data: {
        type: input.type,
        coupleId: input.coupleId,
        actorUserId: input.actorUserId ?? null,
        recipientUserIds: input.recipientUserIds,
        payload: (input.payload ?? undefined) as Prisma.InputJsonValue | undefined,
      },
      select: { id: true },
    });
    return row.id;
  } catch (err: any) {
    logger.warn(`[Nudge] emitDomainEvent(${input.type}) failed: ${err?.message ?? err}`);
    return null;
  }
}

export type PushScope = { kind: 'user'; userId: string } | { kind: 'couple'; coupleId: string };

export interface PushLikePayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/**
 * Bridge a push into the outbox. Fire-and-forget by design (push.service must
 * never wait on us). Recipients: the pushed user, or both partners minus the
 * sender for couple pushes. The actor is the other partner for Us-space
 * moments so the conversion tracker can credit the right nudge.
 */
export function recordPushEvent(scope: PushScope, payload: PushLikePayload): void {
  void (async () => {
    const family = familyFromPushData(payload.data);
    if (HARD_EXCLUDED_FAMILIES.has(family) || family === 'unknown') return;

    const senderUserId = typeof payload.data?.senderUserId === 'string' ? payload.data.senderUserId : null;
    let coupleId: string;
    let recipients: string[];
    let actor: string | null = senderUserId;

    if (scope.kind === 'user') {
      const u = await prisma.user.findUnique({ where: { id: scope.userId }, select: { coupleId: true } });
      if (!u?.coupleId) return;
      coupleId = u.coupleId;
      recipients = [scope.userId];
      if (!actor && family.startsWith('us_')) {
        const partner = await prisma.user.findFirst({
          where: { coupleId, id: { not: scope.userId } },
          select: { id: true },
        });
        actor = partner?.id ?? null;
      }
    } else {
      coupleId = scope.coupleId;
      const users = await prisma.user.findMany({ where: { coupleId }, select: { id: true } });
      recipients = users.map((u) => u.id).filter((id) => id !== senderUserId);
    }
    if (recipients.length === 0) return;

    await emitDomainEvent({
      type: family,
      coupleId,
      actorUserId: actor,
      recipientUserIds: recipients,
      payload: { title: payload.title, body: payload.body, data: payload.data ?? {} },
    });
  })().catch((err) => logger.warn(`[Nudge] recordPushEvent failed: ${err?.message ?? err}`));
}
