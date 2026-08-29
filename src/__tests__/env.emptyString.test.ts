/**
 * Empty env strings must mean UNSET, never zero.
 *
 * The AWS secret carries every declared key, so unused settings arrive as ''.
 * zod's .default() only fires on undefined and Number('') === 0 — on
 * 2026-08-29 that turned three SMS-guard caps into 0 and refused every OTP
 * send platform-wide. src/config/env.ts now strips empty-string values before
 * parsing; this suite pins that behaviour.
 */

describe('env: empty strings fall back to defaults', () => {
  const load = () => {
    let env: typeof import('../config/env').env;
    jest.isolateModules(() => {
      env = require('../config/env').env;
    });
    return env!;
  };

  afterEach(() => {
    delete process.env.SMS_PREFIX_DAILY_CAP;
    delete process.env.SMS_IP_DAILY_CAP;
    delete process.env.SMS_DAILY_GLOBAL_CAP;
    delete process.env.RATE_LIMIT_MAX;
  });

  it('treats "" numeric caps as unset (defaults, never 0)', () => {
    process.env.SMS_PREFIX_DAILY_CAP = '';
    process.env.SMS_IP_DAILY_CAP = '';
    process.env.SMS_DAILY_GLOBAL_CAP = '';
    process.env.RATE_LIMIT_MAX = '';
    const env = load();
    expect(env.SMS_PREFIX_DAILY_CAP).toBe(30);
    expect(env.SMS_IP_DAILY_CAP).toBe(20);
    expect(env.SMS_DAILY_GLOBAL_CAP).toBe(2000);
    expect(env.RATE_LIMIT_MAX).toBe(10);
  });

  it('still honours real values', () => {
    process.env.SMS_PREFIX_DAILY_CAP = '200';
    const env = load();
    expect(env.SMS_PREFIX_DAILY_CAP).toBe(200);
  });
});
