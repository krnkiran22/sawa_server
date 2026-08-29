import winston from 'winston';
import Transport from 'winston-transport';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import { env } from '../config/env';
import { Sentry, sentryEnabled } from '../lib/sentry';

const { combine, timestamp, printf, colorize, errors, json } = winston.format;

const devFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ timestamp: ts, level, message, stack }) => {
    return stack
      ? `[${ts}] ${level}: ${message}\n${stack}`
      : `[${ts}] ${level}: ${message}`;
  }),
);

const prodFormat = combine(timestamp(), errors({ stack: true }), json());

const transports: winston.transport[] = [];

if (env.NODE_ENV === 'development') {
  transports.push(new winston.transports.Console({ format: devFormat }));
} else {
  transports.push(new winston.transports.Console({ format: prodFormat }));
  transports.push(
    new DailyRotateFile({
      filename: path.join('logs', 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxFiles: '14d',
      format: prodFormat,
    }),
  );
  transports.push(
    new DailyRotateFile({
      filename: path.join('logs', 'combined-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxFiles: '14d',
      format: prodFormat,
    }),
  );
}

/**
 * Sentry bridge (coverage audit 2026-08-29): the Express error handler only
 * sees request-path throws — socket handlers, cron jobs and fire-and-forget
 * paths all catch-and-log instead. Every one of those already calls
 * `logger.error`/`logger.warn`, so this transport is the ONE seam that makes
 * "logged" mean "reported": error-level entries become Sentry events (with
 * the stack when present), warn-level entries become breadcrumbs that give
 * the next event its trail. Phone-shaped digit runs are redacted — the phone
 * number is this product's identity key and must not land in a third-party
 * tool. Inert without SENTRY_DSN, like lib/sentry itself.
 */
class SentryBridgeTransport extends Transport {
  constructor() {
    super({ level: 'warn' });
  }

  log(info: winston.Logform.TransformableInfo, callback: () => void): void {
    setImmediate(() => this.emit('logged', info));
    try {
      const raw = typeof info.message === 'string' ? info.message : String(info.message);
      const message = raw.replace(/\+?\d[\d\s-]{8,}\d/g, '[redacted]');
      if (info.level === 'error') {
        const stack = typeof info.stack === 'string' ? info.stack : undefined;
        if (stack) {
          const err = new Error(message);
          err.stack = stack;
          Sentry.captureException(err);
        } else {
          Sentry.captureMessage(message, 'error');
        }
      } else {
        Sentry.addBreadcrumb({ category: 'log', level: 'warning', message });
      }
    } catch {
      /* the reporter must never take the process down */
    }
    callback();
  }
}

if (sentryEnabled) {
  transports.push(new SentryBridgeTransport());
}

export const logger = winston.createLogger({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  transports,
});
