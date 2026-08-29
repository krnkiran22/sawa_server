# Runbook — error triage (Sentry)

Org `sawa-technologies-private-limi` · projects `sawa-server`, `sawa-mobile`,
`sawa-admin` · the server separates staging/production by the `environment` tag.

- Coverage contract: every `logger.error` anywhere in the server becomes a
  Sentry event (winston bridge in `src/utils/logger.ts`); the app reports
  crashes, render errors, and API-failure breadcrumbs; the admin panel reports
  server, client, and root-layout errors. If something broke silently, that is
  itself a bug — find the swallowed error and route it through a logger.
- Privacy contract: phone numbers NEVER reach Sentry (redaction in every
  layer). Keep manual notes on issues clean too.
- **Resolved must mean fixed.** Resolve an issue only when the fix is
  committed AND the runtime that reported it will actually receive it
  (server: deployed; app: rides the next build/OTA — say so if it's waiting).
- API access for automated triage uses a Personal token with scopes
  event:read, event:write, project:read, org:read.
