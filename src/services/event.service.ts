import { prisma } from '../lib/prisma';
import { AppError } from '../utils/AppError';
import { logger } from '../utils/logger';
import { emitRealtimeNotification } from '../utils/realtime';
import { i18nData } from '../i18n/notif';
import { cacheGet, cacheSet, cacheInvalidatePattern } from '../lib/cache';
import { materializeImageLoose } from '../lib/storage';
import { EventCategory, EventStatus } from '@prisma/client';

// Events are dated happenings, distinct from Community circles (ongoing).
// Couple-proposed events are born `pending` and become visible only after an
// admin approves them; Sawa-listed events (admin panel) are born `approved`.
// See prisma/schema.prisma (Event / EventRsvp) and PLAN.md for the contract.

/** Normalize a cover image field (base64/data-uri/url) to a stored S3 URL. */
async function materializeCover(
  value: string | undefined | null,
  coupleId?: string,
): Promise<string | undefined> {
  return (await materializeImageLoose(value, coupleId)) ?? undefined;
}

// Feed cache mirrors the communities list cache: short TTL, Redis-backed with
// in-process fallback, invalidated on every write that changes what a feed
// shows. Keys are per-couple (isGoing is baked into the shape).
const EVENT_CACHE_TTL_SECONDS = 30;

function eventFeedCacheKey(coupleId: string, city?: string, category?: string) {
  return `sawa:eventfeed:${coupleId}:${city ?? ''}:${category ?? ''}`;
}

/** Any event mutation changes what feeds show — drop them all. */
async function invalidateEventCaches(): Promise<void> {
  await cacheInvalidatePattern('sawa:eventfeed:*');
}

/** The one shape the app receives for an event, list and detail alike. */
export interface EventCard {
  id: string;
  title: string;
  description: string | null;
  city: string;
  category: EventCategory;
  coverImageUrl: string | null;
  venueName: string | null;
  startsAt: Date;
  endsAt: Date | null;
  capacity: number | null;
  status: EventStatus;
  /** 'sawa' rows render the "by Sawa" badge client-side. */
  source: 'couple' | 'sawa';
  communityId: string | null;
  communityName: string | null;
  creatorName: string | null;
  goingCount: number;
  isGoing: boolean;
  isMine: boolean;
  /** Only ever present on the creator's own rejected rows. */
  rejectionNote?: string | null;
}

const cardSelect = {
  id: true,
  title: true,
  description: true,
  city: true,
  category: true,
  coverImageUrl: true,
  venueName: true,
  startsAt: true,
  endsAt: true,
  capacity: true,
  status: true,
  source: true,
  rejectionNote: true,
  createdById: true,
  communityId: true,
  community: { select: { name: true } },
  createdBy: { select: { profileName: true } },
  _count: { select: { rsvps: true } },
} as const;

type EventRow = {
  id: string;
  title: string;
  description: string | null;
  city: string;
  category: EventCategory;
  coverImageUrl: string | null;
  venueName: string | null;
  startsAt: Date;
  endsAt: Date | null;
  capacity: number | null;
  status: EventStatus;
  source: 'couple' | 'sawa';
  rejectionNote: string | null;
  createdById: string | null;
  communityId: string | null;
  community: { name: string } | null;
  createdBy: { profileName: string | null } | null;
  _count: { rsvps: number };
};

function toCard(row: EventRow, viewerCoupleId: string, goingIds: Set<string>): EventCard {
  const isMine = row.createdById === viewerCoupleId;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    city: row.city,
    category: row.category,
    coverImageUrl: row.coverImageUrl,
    venueName: row.venueName,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    capacity: row.capacity,
    status: row.status,
    source: row.source,
    communityId: row.communityId,
    communityName: row.community?.name ?? null,
    creatorName: row.createdBy?.profileName ?? null,
    goingCount: row._count.rsvps,
    isGoing: goingIds.has(row.id),
    isMine,
    // The team's note is for the creator alone — never leak it into a feed.
    ...(isMine && row.status === 'rejected' ? { rejectionNote: row.rejectionNote } : {}),
  };
}

/** RSVP'd event ids for a couple, to bake isGoing into card shapes. */
async function goingSetFor(coupleId: string, eventIds: string[]): Promise<Set<string>> {
  if (eventIds.length === 0) return new Set();
  const rows = await prisma.eventRsvp.findMany({
    where: { coupleId, eventId: { in: eventIds } },
    select: { eventId: true },
  });
  return new Set(rows.map((r) => r.eventId));
}

const SUPPORTED_CITIES = ['Bangalore', 'Chennai', 'New Delhi', 'Delhi', 'Mumbai', 'Gurgaon', 'Noida', 'Hyderabad', 'Goa'];

export class EventService {
  /**
   * The Events feed: approved, not-yet-over events, soonest first.
   * Bounded by nature (2-4 curated events per city per month is the plan), so
   * a capped findMany instead of cursor pagination — revisit if supply ever
   * outgrows the cap.
   */
  async getEvents(requestingCoupleId: string, cityFilter?: string, category?: string) {
    const cacheKey = eventFeedCacheKey(requestingCoupleId, cityFilter, category);
    const cachedRaw = await cacheGet(cacheKey);
    if (cachedRaw) {
      try {
        return JSON.parse(cachedRaw);
      } catch {
        /* corrupt entry — fall through and rebuild */
      }
    }

    const where: Record<string, unknown> = {
      status: 'approved',
      // "Not over yet": events linger until their end (or start, if open-ended,
      // with a 3h grace so tonight's dinner doesn't vanish at 00:01).
      OR: [
        { endsAt: { gte: new Date() } },
        { endsAt: null, startsAt: { gte: new Date(Date.now() - 3 * 60 * 60 * 1000) } },
      ],
    };
    if (cityFilter && !['All City', 'All Cities', 'Unknown'].includes(cityFilter)) {
      const isSupported = SUPPORTED_CITIES.some((c) => cityFilter.toLowerCase().includes(c.toLowerCase()));
      if (isSupported) {
        where.city = { contains: cityFilter, mode: 'insensitive' };
      }
    }
    if (category && (Object.values(EventCategory) as string[]).includes(category)) {
      where.category = category;
    }

    const rows = await prisma.event.findMany({
      where,
      select: cardSelect,
      orderBy: { startsAt: 'asc' },
      take: 200,
    });

    const going = await goingSetFor(requestingCoupleId, rows.map((r) => r.id));
    const result = rows.map((r) => toCard(r as EventRow, requestingCoupleId, going));

    await cacheSet(cacheKey, JSON.stringify(result), EVENT_CACHE_TTL_SECONDS);
    return result;
  }

  /**
   * "Yours": everything the couple created (any status — pending and rejected
   * rows are visible only here) plus everything they RSVP'd to, upcoming first.
   */
  async getMyEvents(requestingCoupleId: string) {
    const rows = await prisma.event.findMany({
      where: {
        OR: [
          { createdById: requestingCoupleId },
          { rsvps: { some: { coupleId: requestingCoupleId } } },
        ],
      },
      select: cardSelect,
      orderBy: { startsAt: 'asc' },
      take: 200,
    });

    const going = await goingSetFor(requestingCoupleId, rows.map((r) => r.id));
    return rows.map((r) => toCard(r as EventRow, requestingCoupleId, going));
  }

  async getEventDetail(requestingCoupleId: string, eventId: string) {
    const row = await prisma.event.findUnique({
      where: { id: eventId },
      select: cardSelect,
    });
    if (!row) throw new AppError('Event not found', 404);

    // Pending/rejected proposals exist only for their creator.
    const isMine = row.createdById === requestingCoupleId;
    if ((row.status === 'pending' || row.status === 'rejected') && !isMine) {
      throw new AppError('Event not found', 404);
    }

    const going = await goingSetFor(requestingCoupleId, [row.id]);
    const card = toCard(row as EventRow, requestingCoupleId, going);

    // A face-row of who's coming: first six couples, name + photo only (S8).
    const attendees = await prisma.eventRsvp.findMany({
      where: { eventId },
      select: {
        couple: { select: { coupleId: true, profileName: true, primaryPhoto: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 6,
    });

    return {
      ...card,
      attendees: attendees.map((a) => ({
        coupleId: a.couple.coupleId,
        name: a.couple.profileName,
        photo: a.couple.primaryPhoto,
      })),
    };
  }

  async createEvent(
    requestingCoupleId: string,
    data: {
      title: string;
      description?: string;
      city: string;
      category: EventCategory;
      startsAt: Date;
      endsAt?: Date;
      venueName?: string;
      capacity?: number;
      coverImageUrl?: string;
      communityId?: string;
    },
  ) {
    const me = await prisma.couple.findUnique({
      where: { coupleId: requestingCoupleId },
      select: { coupleId: true, profileName: true },
    });
    if (!me) throw new AppError('Profile not found', 404);

    if (data.startsAt.getTime() <= Date.now()) {
      throw new AppError('Pick a date that is still ahead of you two.', 400);
    }
    if (data.endsAt && data.endsAt.getTime() <= data.startsAt.getTime()) {
      throw new AppError('The end has to come after the start.', 400);
    }

    // Hosting under a circle's name is a host action — only its admins may.
    let inheritedCover: string | undefined;
    if (data.communityId) {
      const host = await prisma.communityAdmin.findUnique({
        where: { communityId_coupleId: { communityId: data.communityId, coupleId: me.coupleId } },
        select: { community: { select: { coverImageUrl: true } } },
      });
      if (!host) throw new AppError('Only a host of that circle can plan its events.', 403);
      inheritedCover = host.community.coverImageUrl ?? undefined;
    }

    const coverImageUrl = (await materializeCover(data.coverImageUrl, me.coupleId)) ?? inheritedCover;

    const event = await prisma.event.create({
      data: {
        title: data.title,
        description: data.description,
        city: data.city,
        category: data.category,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        venueName: data.venueName,
        capacity: data.capacity,
        coverImageUrl,
        status: 'pending',
        source: 'couple',
        createdById: me.coupleId,
        communityId: data.communityId,
        // The couple planning it is of course coming.
        rsvps: { create: { coupleId: me.coupleId } },
      },
      select: { id: true, title: true, status: true },
    });

    await invalidateEventCaches();
    return event;
  }

  /** RSVP. Idempotent; capacity fails closed inside the transaction. */
  async rsvp(requestingCoupleId: string, eventId: string) {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, status: true, startsAt: true, capacity: true },
    });
    if (!event || event.status !== 'approved') throw new AppError('Event not found', 404);
    if (event.startsAt.getTime() <= Date.now()) {
      throw new AppError('This one has already started.', 409);
    }

    try {
      await prisma.$transaction(async (tx) => {
        const existing = await tx.eventRsvp.findUnique({
          where: { eventId_coupleId: { eventId, coupleId: requestingCoupleId } },
          select: { id: true },
        });
        if (existing) return; // already going — idempotent success
        if (event.capacity != null) {
          const count = await tx.eventRsvp.count({ where: { eventId } });
          if (count >= event.capacity) {
            throw new AppError('This event is full.', 409);
          }
        }
        await tx.eventRsvp.create({ data: { eventId, coupleId: requestingCoupleId } });
      });
    } catch (err) {
      if (err instanceof AppError) throw err;
      // Unique-constraint race between the check and the create = already going.
      const code = (err as { code?: string })?.code;
      if (code !== 'P2002') throw err;
    }

    await invalidateEventCaches();
    return { status: 'going' };
  }

  async unrsvp(requestingCoupleId: string, eventId: string) {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, createdById: true },
    });
    if (!event) throw new AppError('Event not found', 404);
    if (event.createdById === requestingCoupleId) {
      throw new AppError('You planned this one — cancel the event instead.', 409);
    }

    await prisma.eventRsvp.deleteMany({ where: { eventId, coupleId: requestingCoupleId } });
    await invalidateEventCaches();
    return { status: 'not_going' };
  }

  /** Creator calls off their own event; everyone who RSVP'd hears about it. */
  async cancelEvent(requestingCoupleId: string, eventId: string) {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, title: true, city: true, status: true, createdById: true },
    });
    if (!event || event.createdById !== requestingCoupleId) {
      throw new AppError('Event not found', 404);
    }
    if (event.status === 'cancelled') return { status: 'cancelled' };
    if (event.status === 'rejected') {
      throw new AppError('This event was not listed, so there is nothing to call off.', 409);
    }

    const wasVisible = event.status === 'approved';
    await prisma.event.update({ where: { id: eventId }, data: { status: 'cancelled' } });

    if (wasVisible) {
      this.notifyAttendeesCancelled(event.id, event.title, requestingCoupleId).catch((err: unknown) =>
        logger.warn(`[EventService] cancel notify failed: ${(err as Error)?.message}`),
      );
    }

    await invalidateEventCaches();
    return { status: 'cancelled' };
  }

  private async notifyAttendeesCancelled(
    eventId: string,
    title: string,
    creatorCoupleId: string,
  ): Promise<void> {
    const rsvps = await prisma.eventRsvp.findMany({
      where: { eventId, coupleId: { not: creatorCoupleId } },
      select: { coupleId: true },
    });
    if (rsvps.length === 0) return;

    const notifTitle = 'Plan change';
    const notifMessage = `${title} was called off. See you at the next one.`;
    const notifData = { eventId, ...i18nData('event.cancelled', { event: title }) };

    await Promise.all(
      rsvps.map(async (r) => {
        const notif = await prisma.notification.create({
          data: {
            recipientId: r.coupleId,
            senderId: creatorCoupleId,
            type: 'event',
            title: notifTitle,
            message: notifMessage,
            data: notifData,
          },
        });
        emitRealtimeNotification(r.coupleId, {
          notificationId: notif.id,
          type: 'event',
          title: notifTitle,
          message: notifMessage,
          data: notifData,
        });
      }),
    );
  }

  // ── Admin surface (adminAuth routes only) ─────────────────────────────────

  /** Everything, for the panel: pending queue first, then by date. */
  async adminListEvents() {
    const rows = await prisma.event.findMany({
      select: {
        ...cardSelect,
        createdBy: { select: { coupleId: true, profileName: true, locationCity: true } },
        createdAt: true,
      },
      orderBy: [{ startsAt: 'desc' }],
      take: 500,
    });

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      city: r.city,
      category: r.category,
      coverImageUrl: r.coverImageUrl,
      venueName: r.venueName,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      capacity: r.capacity,
      status: r.status,
      source: r.source,
      rejectionNote: r.rejectionNote,
      communityId: r.communityId,
      communityName: r.community?.name ?? null,
      createdBy: r.createdBy
        ? { coupleId: r.createdBy.coupleId, name: r.createdBy.profileName, city: r.createdBy.locationCity }
        : null,
      goingCount: r._count.rsvps,
      createdAt: r.createdAt,
    }));
  }

  /** Sawa-listed events are born approved. */
  async adminCreateEvent(data: {
    title: string;
    description?: string;
    city: string;
    category: EventCategory;
    startsAt: Date;
    endsAt?: Date;
    venueName?: string;
    capacity?: number;
    coverImageUrl?: string;
    coverImageBase64?: string;
  }) {
    const coverImageUrl = await materializeCover(data.coverImageBase64 ?? data.coverImageUrl);

    const event = await prisma.event.create({
      data: {
        title: data.title,
        description: data.description,
        city: data.city,
        category: data.category,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        venueName: data.venueName,
        capacity: data.capacity,
        coverImageUrl,
        status: 'approved',
        source: 'sawa',
      },
      select: { id: true, title: true, city: true, startsAt: true },
    });

    if (event.startsAt.getTime() > Date.now()) {
      this.notifyCityAboutEvent(event.id, event.title, event.city).catch((err: unknown) =>
        logger.warn(`[EventService] city announce failed: ${(err as Error)?.message}`),
      );
    }

    await invalidateEventCaches();
    return event;
  }

  async adminUpdateEvent(
    eventId: string,
    data: Partial<{
      title: string;
      description: string;
      city: string;
      category: EventCategory;
      startsAt: Date;
      endsAt: Date | null;
      venueName: string;
      capacity: number | null;
      coverImageUrl: string;
      coverImageBase64: string;
    }>,
  ) {
    const existing = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true } });
    if (!existing) throw new AppError('Event not found', 404);

    const updateData: Record<string, unknown> = {};
    for (const key of ['title', 'description', 'city', 'category', 'startsAt', 'endsAt', 'venueName', 'capacity'] as const) {
      if (data[key] !== undefined) updateData[key] = data[key];
    }
    if (data.coverImageBase64 && data.coverImageBase64.length > 10) {
      updateData.coverImageUrl = await materializeCover(data.coverImageBase64);
    } else if (data.coverImageUrl !== undefined) {
      updateData.coverImageUrl = data.coverImageUrl;
    }

    const event = await prisma.event.update({
      where: { id: eventId },
      data: updateData,
      select: { id: true, title: true },
    });

    await invalidateEventCaches();
    return event;
  }

  async adminApproveEvent(eventId: string) {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, title: true, city: true, status: true, startsAt: true, createdById: true },
    });
    if (!event) throw new AppError('Event not found', 404);
    if (event.status !== 'pending') throw new AppError('Only a pending event can be approved', 409);

    await prisma.event.update({
      where: { id: eventId },
      data: { status: 'approved', rejectionNote: null },
    });

    if (event.createdById) {
      const title = 'Your event is on';
      const message = `${event.title} is now visible to couples in ${event.city}.`;
      const notifData = {
        eventId: event.id,
        ...i18nData('event.approved', { event: event.title, city: event.city }),
      };
      const notif = await prisma.notification.create({
        data: {
          recipientId: event.createdById,
          type: 'event',
          title,
          message,
          data: notifData,
        },
      });
      emitRealtimeNotification(event.createdById, {
        notificationId: notif.id,
        type: 'event',
        title,
        message,
        data: notifData,
      });
    }

    if (event.startsAt.getTime() > Date.now()) {
      this.notifyCityAboutEvent(event.id, event.title, event.city, event.createdById ?? undefined).catch(
        (err: unknown) => logger.warn(`[EventService] city announce failed: ${(err as Error)?.message}`),
      );
    }

    await invalidateEventCaches();
    return { status: 'approved' };
  }

  async adminRejectEvent(eventId: string, note?: string) {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, title: true, status: true, createdById: true },
    });
    if (!event) throw new AppError('Event not found', 404);
    if (event.status !== 'pending') throw new AppError('Only a pending event can be rejected', 409);

    await prisma.event.update({
      where: { id: eventId },
      data: { status: 'rejected', rejectionNote: note || null },
    });

    if (event.createdById) {
      const title = 'About your event';
      const message = `We could not list ${event.title} this time. Tap for the note from the team.`;
      const notifData = {
        eventId: event.id,
        rejectionNote: note || null,
        ...i18nData('event.rejected', { event: event.title }),
      };
      const notif = await prisma.notification.create({
        data: {
          recipientId: event.createdById,
          type: 'event',
          title,
          message,
          data: notifData,
        },
      });
      emitRealtimeNotification(event.createdById, {
        notificationId: notif.id,
        type: 'event',
        title,
        message,
        data: notifData,
      });
    }

    await invalidateEventCaches();
    return { status: 'rejected' };
  }

  async adminDeleteEvent(eventId: string) {
    const existing = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true } });
    if (!existing) throw new AppError('Event not found', 404);

    await prisma.$transaction([
      prisma.eventRsvp.deleteMany({ where: { eventId } }),
      prisma.event.delete({ where: { id: eventId } }),
    ]);

    await invalidateEventCaches();
    return { status: 'deleted' };
  }

  /** Announce a freshly listed event to every complete couple in its city.
   *  Mirrors notifyCityAboutCommunity; standard pipeline, so FCM push rides
   *  free. Fire-and-forget from the callers. */
  private async notifyCityAboutEvent(
    eventId: string,
    eventTitle: string,
    city: string,
    creatorCoupleId?: string,
  ): Promise<void> {
    if (!city) return;
    const locals = await prisma.couple.findMany({
      where: {
        ...(creatorCoupleId ? { coupleId: { not: creatorCoupleId } } : {}),
        locationCity: city,
        isProfileComplete: true,
        bannedAt: null,
      },
      select: { coupleId: true },
      take: 200,
    });
    if (locals.length === 0) return;

    const title = `A new plan in ${city}`;
    const message = `${eventTitle} just went up. Take a look!`;
    const notifData = {
      eventId,
      city,
      ...i18nData('nearby.event', { city, event: eventTitle }),
    };

    await Promise.all(
      locals.map(async (c) => {
        const notif = await prisma.notification.create({
          data: {
            recipientId: c.coupleId,
            senderId: creatorCoupleId ?? null,
            type: 'event',
            title,
            message,
            data: notifData,
          },
        });
        emitRealtimeNotification(c.coupleId, {
          notificationId: notif.id,
          type: 'event',
          title,
          message,
          data: notifData,
        });
      }),
    );

    logger.info(`[EventService] Announced event ${eventId} to ${locals.length} couple(s) in ${city}`);
  }
}

export const eventService = new EventService();
