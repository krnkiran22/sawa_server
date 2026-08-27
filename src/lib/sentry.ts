import dotenv from 'dotenv';
import * as Sentry from '@sentry/node';

// This module is the FIRST import of server.ts so instrumentation sees the
// whole boot. dotenv runs here (idempotent — env.ts runs it again later)
// because process.env must be populated before the init decision.
dotenv.config();

/**
 * Error monitoring, DSN-optional like storage and push: without SENTRY_DSN
 * the module is inert and the server behaves exactly as before. With it,
 * unhandled errors and the Express error path report to Sentry.
 */
const dsn = process.env.SENTRY_DSN;

export const sentryEnabled = Boolean(dsn);

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    // Keep tracing cheap; errors are the point, performance is a bonus.
    tracesSampleRate: 0.1,
    // Never send request bodies/PII by default — phone numbers are the
    // identity key of this product and must not land in a third-party tool.
    sendDefaultPii: false,
  });
}

export { Sentry };
