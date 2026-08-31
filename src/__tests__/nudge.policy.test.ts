import { decide, utcDayStart, secondsToUtcDayEnd } from '../services/nudge/nudge.policy';
import type { PolicyConfig, PolicyRecipient } from '../services/nudge/nudge.types';

const now = new Date('2026-08-31T12:00:00.000Z');

const rec = (over: Partial<PolicyRecipient> = {}): PolicyRecipient => ({
  userId: 'u1',
  phone: '919876543210',
  locale: 'en',
  hasPushToken: true,
  lastActiveAt: new Date('2026-08-31T06:00:00.000Z'),
  isOnline: false,
  whatsappOptIn: true,
  mutedFamilies: [],
  sentToday: 0,
  lastFamilySentAt: null,
  ...over,
});

const cfg = (over: Partial<PolicyConfig> = {}): PolicyConfig => ({
  family: 'us_mood',
  channelEnabled: true,
  hasTemplate: true,
  familyExcluded: false,
  activityInsensitive: false,
  dailyCap: 8,
  familyCooldownMin: 30,
  activeGraceSec: 120,
  whatsappDelayMin: 0,
  globalCapReached: false,
  ...over,
});

describe('nudge policy — decide()', () => {
  it('sends immediately by default (no quiet hours, delay 0)', () => {
    const d = decide(rec(), cfg(), now);
    expect(d).toEqual({ send: true, scheduledAt: now });
  });

  it('excluded families never go out, before any other check', () => {
    expect(decide(rec({ phone: null }), cfg({ familyExcluded: true }), now)).toEqual({ send: false, reason: 'excluded' });
  });

  it('channel off → disabled; no template → no_template', () => {
    expect(decide(rec(), cfg({ channelEnabled: false }), now)).toEqual({ send: false, reason: 'disabled' });
    expect(decide(rec(), cfg({ hasTemplate: false }), now)).toEqual({ send: false, reason: 'no_template' });
  });

  it('consent: no phone, opted out, muted family', () => {
    expect(decide(rec({ phone: null }), cfg(), now)).toEqual({ send: false, reason: 'no_phone' });
    expect(decide(rec({ whatsappOptIn: false }), cfg(), now)).toEqual({ send: false, reason: 'optout' });
    expect(decide(rec({ mutedFamilies: ['us_mood'] }), cfg(), now)).toEqual({ send: false, reason: 'muted' });
  });

  it('being in the app right now suppresses a moment nudge', () => {
    expect(decide(rec({ isOnline: true }), cfg(), now)).toEqual({ send: false, reason: 'online' });
    const justNow = new Date(now.getTime() - 30_000);
    expect(decide(rec({ lastActiveAt: justNow }), cfg(), now)).toEqual({ send: false, reason: 'active' });
  });

  it('activity-insensitive families (welcome, invites) ignore online/active', () => {
    const c = cfg({ family: 'welcome', activityInsensitive: true });
    expect(decide(rec({ isOnline: true, lastActiveAt: now }), c, now)).toEqual({ send: true, scheduledAt: now });
  });

  it('same-family cooldown and daily cap', () => {
    const tenMinAgo = new Date(now.getTime() - 10 * 60_000);
    expect(decide(rec({ lastFamilySentAt: tenMinAgo }), cfg(), now)).toEqual({ send: false, reason: 'cooldown' });
    const twoHoursAgo = new Date(now.getTime() - 120 * 60_000);
    expect(decide(rec({ lastFamilySentAt: twoHoursAgo }), cfg(), now).send).toBe(true);
    expect(decide(rec({ sentToday: 8 }), cfg(), now)).toEqual({ send: false, reason: 'cap' });
    expect(decide(rec({ sentToday: 8 }), cfg({ dailyCap: 0 }), now).send).toBe(true);
  });

  it('global cap is the last gate', () => {
    expect(decide(rec(), cfg({ globalCapReached: true }), now)).toEqual({ send: false, reason: 'global_cap' });
  });

  it('escalation delay applies only to recipients who have push', () => {
    const c = cfg({ whatsappDelayMin: 20 });
    const withPush = decide(rec(), c, now);
    expect(withPush).toEqual({ send: true, scheduledAt: new Date(now.getTime() + 20 * 60_000) });
    const noPush = decide(rec({ hasPushToken: false }), c, now);
    expect(noPush).toEqual({ send: true, scheduledAt: now });
  });
});

describe('nudge policy — day helpers', () => {
  it('utcDayStart and secondsToUtcDayEnd agree on the UTC day', () => {
    expect(utcDayStart(now).toISOString()).toBe('2026-08-31T00:00:00.000Z');
    expect(secondsToUtcDayEnd(now)).toBe(12 * 3600);
  });
});
