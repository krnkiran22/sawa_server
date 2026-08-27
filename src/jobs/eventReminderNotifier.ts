import { prisma } from '../lib/prisma';
import { cacheGet, cacheSet, invalidateNotifUnreadCount } from '../lib/cache';
import { pushToCouple } from '../services/push.service';
import { i18nData, renderNotif } from '../i18n/notif';
import { logger } from '../utils/logger';

/**
 * Event Reminder Notifier Job
 * ─────────────────────────────────────────────────────────────────────────
 * The day before a confirmed couple date (a row in `planned_dates`, which only
 * exists once BOTH partners have accepted it), this job reminds the whole
 * couple:  "📅 You both have a date tomorrow — {activity}".
 *
 * Both partners get the reminder (couple-level), so `senderUserId` is set to the
 * shared `coupleId` — that way the mobile client treats it as an Us-space row and
 * shows it to both members (its self-filter only hides rows whose sender equals
 * the viewer's own user id, and a coupleId never matches a user id).
 *
 * Text is localized per recipient device by the push service and re-localized in
 * the in-app list via the attached `i18nKey` / `i18nParams`.
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Today + tomorrow (YYYY-MM-DD) and the current hour, all in IST. */
function istDays(): { today: string; tomorrow: string; hour: number } {
  const now = new Date(Date.now() + IST_OFFSET_MS);
  const today = now.toISOString().slice(0, 10);
  const tomorrow = new Date(now.getTime() + DAY_MS).toISOString().slice(0, 10);
  return { today, tomorrow, hour: now.getUTCHours() };
}

export async function runCheck(): Promise<void> {
  const { today, tomorrow, hour } = istDays();
  // Quiet hours — only remind between 08:00 and 21:00 IST. Dedupe below ensures a
  // given date is announced only once regardless of how often we run.
  if (hour < 8 || hour >= 21) return;

  try {
    // A row in planned_dates is already a confirmed couple date; anything dated
    // for tomorrow needs a reminder.
    const events = await prisma.plannedDate.findMany({
      where: { rawDate: tomorrow },
      select: { id: true, coupleId: true, activity: true, dateLabel: true, rawDate: true, time: true },
    });
    if (!events.length) return;

    let sent = 0;
    for (const ev of events) {
      try {
        const coupleId = ev.coupleId;

        // Send each event's reminder at most once per day.
        const dedupeKey = `us:date_reminder:${coupleId}:${ev.id}:${today}`;
        if (await cacheGet(dedupeKey)) continue;
        await cacheSet(dedupeKey, '1', 2 * 24 * 60 * 60);

        const activity = (ev.activity || 'Your date').trim();
        const timeText = ev.time ? ` · ${ev.time}` : '';
        const params = { activity, timeText };
        const { title, body } = renderNotif('en', 'us.date.reminder', params); // client re-localizes

        await prisma.notification.create({
          data: {
            recipientId: coupleId,
            senderId: coupleId,
            type: 'system',
            title,
            message: body,
            data: {
              subtype: 'us_date_reminder',
              senderUserId: coupleId, // couple-level: both partners see it
              navigate: 'UsSpace',
              id: ev.id,
              activity,
              rawDate: ev.rawDate,
              ...(ev.time ? { time: ev.time } : {}),
              ...(ev.dateLabel ? { dateLabel: ev.dateLabel } : {}),
              ...i18nData('us.date.reminder', params),
            },
            read: false,
          },
        });
        await invalidateNotifUnreadCount(coupleId);

        const io = (global as any).io;
        if (io) io.to(`couple:${coupleId}`).emit('notification:new', { type: 'us_date_reminder' });

        pushToCouple(coupleId, {
          title,
          body,
          data: {
            type: 'us_date_reminder',
            subtype: 'us_date_reminder',
            navigate: 'UsSpace',
            activity,
            rawDate: ev.rawDate,
            ...i18nData('us.date.reminder', params),
          },
          collapseKey: `us_date_reminder:${ev.id}`,
        }).catch(() => null);

        sent += 1;
        logger.info(`[EventReminder] reminded couple ${coupleId} about "${activity}" on ${ev.rawDate}`);
      } catch (err: any) {
        logger.warn(`[EventReminder] couple ${ev.coupleId} failed: ${err.message}`);
      }
    }

    if (sent) logger.info(`[EventReminder] sent ${sent} date reminder(s) for ${tomorrow}`);
  } catch (err: any) {
    logger.warn(`[EventReminder] run failed: ${err.message}`);
  }
}

/**
 * Hour-before reminder (Arfam 2026-08-22): plans that carry a time get a
 * second, sharper nudge ~1 hour out. Epoch-based (rawDate + "h:mm AM/PM"
 * parsed in IST) so the day boundary can't drop a 00:30 date's reminder.
 * Runs every 10 minutes; the (0, 60] window + per-plan dedupe means exactly
 * one send, ~50–60 minutes before. Deliberately NOT quiet-hours gated — an
 * imminent plan the couple made themselves is wanted at any hour.
 */
const parsePlanEpochIST = (rawDate: string, time: string): number | null => {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(rawDate.trim());
  const tm = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(time.trim());
  if (!d || !tm) return null;
  let hour = Number(tm[1]) % 12;
  if (/pm/i.test(tm[3])) hour += 12;
  // The wall-clock moment in IST, expressed as a UTC epoch.
  return Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), hour, Number(tm[2])) - IST_OFFSET_MS;
};

export async function runSoonCheck(): Promise<void> {
  const now = Date.now();
  const { today, tomorrow } = istDays();
  try {
    // Today + tomorrow covers the midnight edge (a 00:30 date reminds at ~23:35).
    const events = await prisma.plannedDate.findMany({
      where: { rawDate: { in: [today, tomorrow] }, time: { not: null } },
      select: { id: true, coupleId: true, activity: true, rawDate: true, time: true },
    });
    for (const ev of events) {
      try {
        const target = ev.time ? parsePlanEpochIST(ev.rawDate, ev.time) : null;
        if (target == null) continue;
        const minsAway = (target - now) / 60_000;
        if (minsAway <= 0 || minsAway > 60) continue;

        const dedupeKey = `us:date_reminder_soon:${ev.coupleId}:${ev.id}`;
        if (await cacheGet(dedupeKey)) continue;
        await cacheSet(dedupeKey, '1', 24 * 60 * 60);

        const activity = (ev.activity || 'Your date').trim();
        const params = { activity, time: ev.time as string };
        const { title, body } = renderNotif('en', 'us.date.reminderSoon', params);

        await prisma.notification.create({
          data: {
            recipientId: ev.coupleId,
            senderId: ev.coupleId,
            type: 'system',
            title,
            message: body,
            data: {
              subtype: 'us_date_reminder_soon',
              senderUserId: ev.coupleId,
              navigate: 'UsSpace',
              id: ev.id,
              activity,
              rawDate: ev.rawDate,
              time: ev.time,
              ...i18nData('us.date.reminderSoon', params),
            },
            read: false,
          },
        });
        await invalidateNotifUnreadCount(ev.coupleId);

        const io = (global as any).io;
        if (io) io.to(`couple:${ev.coupleId}`).emit('notification:new', { type: 'us_date_reminder_soon' });

        pushToCouple(ev.coupleId, {
          title,
          body,
          data: {
            type: 'us_date_reminder_soon',
            subtype: 'us_date_reminder_soon',
            navigate: 'UsSpace',
            activity,
            rawDate: ev.rawDate,
            time: ev.time as string,
            ...i18nData('us.date.reminderSoon', params),
          },
          collapseKey: `us_date_soon:${ev.id}`,
        }).catch(() => null);

        logger.info(`[EventReminder] hour-before nudge for couple ${ev.coupleId} — "${activity}" at ${ev.time}`);
      } catch (err: any) {
        logger.warn(`[EventReminder] soon-check couple ${ev.coupleId} failed: ${err.message}`);
      }
    }
  } catch (err: any) {
    logger.warn(`[EventReminder] soon-check run failed: ${err.message}`);
  }
}

/** Start the notifier — day-before check after boot then every 3 hours; the
 *  hour-before check every 10 minutes. */
export const startEventReminderNotifier = (): void => {
  setTimeout(() => runCheck().catch(() => {}), 20_000); // after sockets/db settle
  setInterval(() => runCheck().catch(() => {}), 3 * 60 * 60 * 1000);
  setTimeout(() => runSoonCheck().catch(() => {}), 30_000);
  setInterval(() => runSoonCheck().catch(() => {}), 10 * 60 * 1000);
  logger.info('📅 Event reminder notifier scheduled (every 3h, 08–21 IST)');
};
