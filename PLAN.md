# SAWA Server — Architecture Plan

> **This is the master planning document. Read RULES.md before editing.**

---

## App Overview

**SAWA** is a premium couples' social matching app. Couples create a joint profile, answer compatibility questions, and are matched with other couples for social meetups — via communities (group chats) or private couple-to-couple chats.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 LTS |
| Language | TypeScript 5 |
| Framework | Express.js |
| Database | MongoDB (Mongoose ODM) |
| Auth | JWT (Access + Refresh token pattern) |
| OTP | Twilio (SMS) / Custom provider |
| Real-time | Socket.io |
| File Storage | AWS S3 / Cloudinary |
| Caching | Redis (sessions, OTPs, rate limit) |
| Validation | Zod |
| Logging | Winston + Morgan |
| Testing | Jest + Supertest |
| CI/CD | GitHub Actions |

---

## Folder Structure

```
server/
├── src/
│   ├── config/           # App configuration & env validation
│   │   ├── env.ts        # Zod-validated environment variables
│   │   └── db.ts         # MongoDB connection
│   │
│   ├── constants/        # App-wide constants
│   │   ├── index.ts      # General constants (pagination, limits)
│   │   └── socketEvents.ts # Socket.io event name constants
│   │
│   ├── models/           # Mongoose schemas & models
│   │   ├── User.model.ts
│   │   ├── Couple.model.ts
│   │   ├── Match.model.ts
│   │   ├── Community.model.ts
│   │   ├── Message.model.ts
│   │   └── OtpToken.model.ts
│   │
│   ├── repositories/     # DB query layer (called by services only)
│   │   ├── user.repository.ts
│   │   ├── couple.repository.ts
│   │   ├── match.repository.ts
│   │   ├── community.repository.ts
│   │   └── message.repository.ts
│   │
│   ├── services/         # Business logic layer
│   │   ├── auth.service.ts
│   │   ├── user.service.ts
│   │   ├── couple.service.ts
│   │   ├── match.service.ts
│   │   ├── community.service.ts
│   │   ├── chat.service.ts
│   │   ├── otp.service.ts
│   │   └── upload.service.ts
│   │
│   ├── controllers/      # HTTP request handlers
│   │   ├── auth.controller.ts
│   │   ├── user.controller.ts
│   │   ├── couple.controller.ts
│   │   ├── match.controller.ts
│   │   ├── community.controller.ts
│   │   └── chat.controller.ts
│   │
│   ├── routes/           # Express route definitions
│   │   ├── index.ts      # Master router — mounts all sub-routers
│   │   ├── auth.routes.ts
│   │   ├── user.routes.ts
│   │   ├── couple.routes.ts
│   │   ├── match.routes.ts
│   │   ├── community.routes.ts
│   │   └── chat.routes.ts
│   │
│   ├── middleware/       # Express middleware
│   │   ├── authenticate.ts      # JWT auth guard
│   │   ├── errorHandler.ts      # Global error handler
│   │   ├── rateLimiter.ts       # Rate limiting (auth routes)
│   │   ├── validate.ts          # Zod request validation
│   │   └── upload.ts            # Multer file upload
│   │
│   ├── sockets/          # Socket.io handlers
│   │   ├── index.ts             # Socket server setup
│   │   ├── chat.socket.ts       # Private & group chat events
│   │   └── match.socket.ts      # Match notifications
│   │
│   ├── types/            # TypeScript types & interfaces
│   │   ├── express.d.ts         # Augmented Express Request type
│   │   └── index.ts             # Shared app types
│   │
│   └── utils/            # Shared utilities
│       ├── AppError.ts          # Custom error class
│       ├── asyncHandler.ts      # Async controller wrapper
│       ├── logger.ts            # Winston logger
│       ├── jwt.ts               # JWT sign/verify helpers
│       └── response.ts          # Standard API response helpers
│
├── app.ts                # Express app factory
├── server.ts             # Entry point — HTTP + Socket.io server
├── .env.example          # Environment variable template
├── .gitignore            # Excludes .env, node_modules, dist
├── tsconfig.json         # TypeScript config
├── package.json          # Dependencies & scripts
├── RULES.md              # ← Always read this first
├── PLAN.md               # This file
└── CHANGELOG.md          # Change log
```

---

## Data Models

### User
```
id, phone, email?, passwordHash, isPhoneVerified, createdAt, updatedAt
```

### Couple
```
id, partner1 (ref: User), partner2 (ref: User), profileName, bio,
avatarUrl, location, answers (onboarding Q&A JSON), isProfileComplete,
preferences, createdAt, updatedAt
```

### Match
```
id, couple1 (ref: Couple), couple2 (ref: Couple), status (pending|accepted|rejected),
matchScore, createdAt
```

### Community
```
id, name, description, coverImageUrl, members [ref: Couple],
admins [ref: Couple], isPrivate, maxMembers, tags, createdAt
```

### Message
```
id, chatId (polymorphic: match | community), senderId (ref: Couple),
content, contentType (text|image|gif), readBy [ref: Couple],
createdAt
```

### OtpToken
```
id, phone, otpHash, expiresAt, attempts, createdAt
```

---

### Nudge Layer (2026-08-31)

`NudgePreference` (per-user WhatsApp consent; no row = ON) · `EngagementEvent` (the outbox:
family, coupleId, actorUserId, recipientUserIds, payload, processedAt) · `NudgeDelivery` (one row
per recipient per channel attempt: status, suppressedReason, providerMessageId, linkToken,
clicked/opened/converted stamps) · `NudgeTemplate` (family+locale → provider template name,
variables, category, enabled) · `Journey` (proactive nudges as data). See
`src/services/nudge/*` and Architecture Decisions below.

## API Reference

> Base prefix: `/api/v1`

### Health
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | ❌ | Server health check |

### Auth (`/auth`)
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/send-otp` | ❌ | Send OTP to phone |
| POST | `/auth/verify-otp` | ❌ | Verify OTP, return tokens |
| POST | `/auth/refresh` | ❌ | Refresh access token |
| POST | `/auth/logout` | ✅ | Revoke refresh token |

### User (`/users`)
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/users/me` | ✅ | Get current user |
| PATCH | `/users/me` | ✅ | Update user profile |

### Couple (`/couples`)
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/couples` | ✅ | Create couple profile |
| GET | `/couples/me` | ✅ | Get my couple profile |
| PATCH | `/couples/me` | ✅ | Update couple profile |
| POST | `/couples/me/answers` | ✅ | Submit onboarding answers |
| POST | `/couples/me/invite` | ✅ | Invite partner (generate link/code) |
| POST | `/couples/me/avatar` | ✅ | Upload couple avatar |

### Matching (`/matches`)
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/matches` | ✅ | Get suggested couples |
| POST | `/matches/:matchId/accept` | ✅ | Accept a match |
| POST | `/matches/:matchId/reject` | ✅ | Reject a match |
| GET | `/matches/accepted` | ✅ | Get all accepted matches |

### Communities (`/communities`)
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/communities` | ✅ | List all communities |
| POST | `/communities` | ✅ | Create a community |
| GET | `/communities/:id` | ✅ | Get community detail |
| POST | `/communities/:id/join` | ✅ | Join a community |
| POST | `/communities/:id/leave` | ✅ | Leave a community |
| GET | `/communities/mine` | ✅ | My communities |

### Chat (`/chats`)
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/chats/private/:matchId` | ✅ | Get private chat messages — **cursor-paginated**, see below |
| GET | `/chats/group/:communityId` | ✅ | Get group chat messages |
| POST | `/chats/private/:matchId` | ✅ | Send private message |
| POST | `/chats/group/:communityId` | ✅ | Send group message |

### Us space (`/us`)
> The wider `/us` surface (feelings, planned dates, fridge notes, cycle, game
> state) predates this reference and is not yet tabulated — see
> `src/routes/us.routes.ts`. All of it now lives behind `src/services/us.service.ts`
> (the route file is a thin HTTP layer). New/changed endpoints documented here:

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/us/mood-history` | ✅ | Couple's last 30 days of mood events `{ userId, mood, at }` (both partners, newest first), read from the `us_mood` Notification rows |
| GET | `/us/planned-dates` | ✅ | Planned dates (earliest first) — **cursor-paginated**, see below |
| PATCH | `/us/planned-dates/:id` | ✅ | Edit a planned date (`activity?/date?/rawDate?/time?/note?`). **Update-only, never upsert** — an unaccepted date request has no server row and must stay creator-local, so missing → 404, foreign couple → 403. Idempotency-Key honored (offline-queue replay safe). Returns the updated plan in the standard envelope |
| GET | `/us/fridge-notes` | ✅ | Sticky notes (newest first) — **cursor-paginated**, see below |

### Nudges (`/nudges`) — WhatsApp consent + link resolution
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/nudges/preferences` | ✅ | `{ preferences: { whatsappOptIn, mutedFamilies, whatsappOptOutAt } }` (defaults when no row) |
| PUT | `/nudges/preferences` | ✅ | `{ whatsappOptIn?, mutedFamilies? }` → saved preferences |
| GET | `/nudges/links/:token` | ✅ | The app opened on `https://<host>/l/:token`; returns `{ target }` (tap-router payload), couple-scoped; 404 otherwise |
| GET | `/nudges/pending-intent` | ✅ | Newest clicked, unconsumed link target for the caller (first login after a tap without the app), consumed on read |

### Webhooks (`/webhooks`)
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/webhooks/wati?secret=…` | shared secret | WATI events: delivered/read/failed → funnel; inbound `STOP`/`START` → consent; quick-reply button titles → actions. Always 200 once authenticated |

### Admin nudges (`/admin/nudges`, adminAuth)
| Method | Path | Description |
|---|---|---|
| GET | `/admin/nudges/overview?days=7` | Funnel per family, suppressed reasons, provider state, queue depth |
| GET/POST | `/admin/nudges/templates` | Registry; POST upserts by (family, locale) |
| PATCH/DELETE | `/admin/nudges/templates/:id` | Enable/rename/re-categorise; delete |
| GET | `/admin/nudges/journeys` · PATCH `/:id` | Journeys; toggle enabled, edit config |
| POST | `/admin/nudges/test-send` | `{ phone, family, locale? }` → one template with sample variables, recorded as `test_<family>` |
| GET | `/admin/nudges/deliveries?limit&cursor&family&status` | Keyset-paginated deliveries (phones masked) |

### Public (no prefix)
| Method | Path | Description |
|---|---|---|
| GET | `/l/:token` | WhatsApp nudge link when the app is not installed: records the click, renders the store page, leaves the intent for first login. App Link / Universal Link path when installed |

### Cursor pagination (v2, additive / backward-compatible)

Three previously-unbounded (or fixed-`take`) list reads gained **keyset (cursor)
pagination**. All are **additive** — no existing field moved — so the current
mobile build keeps working untouched; the new `cursor`/`limit` params and
`nextCursor` field are opt-in for the follow-up.

- **Query params (all optional):** `?limit=<1..100>` (per-endpoint default when
  omitted) and `?cursor=<opaque>`. Send no params for the first page; pass the
  previous response's `nextCursor` to fetch the next page. A `nextCursor` of
  `null` means no more pages. The cursor is an opaque base64url token
  (`src/utils/cursor.ts`) — never parse it client-side.
- `GET /chats/private/:matchId` → `data: { matchId, messages, nextCursor }`.
  `messages` stays exactly where it was (oldest→newest). **Default `limit` 50**
  (was a fixed `take: 100`). Paging walks **backwards in time** (older history) —
  the mobile follow-up wires "load older messages on scroll-up" using
  `nextCursor`.
- `GET /us/planned-dates` → `data: [...]` (unchanged array, earliest `rawDate`
  first) **plus a sibling** `nextCursor`. Default `limit` **100** (was
  unbounded).
- `GET /us/fridge-notes` → `data: [...]` (unchanged array, newest first) **plus a
  sibling** `nextCursor`. Default `limit` **30** (the collection is hard-capped
  at 30 on write, so `nextCursor` is effectively always `null` today; the
  mechanism is in place for consistency).

**Mobile follow-up (not yet done):** read `nextCursor`; on chat, adopt the
`cursor`/`limit` params to restore or extend history depth (the default dropped
100→50) and to load older messages on demand.

---

## Socket.io Events

| Event | Direction | Description |
|---|---|---|
| `chat:join` | Client → Server | Join a chat room |
| `chat:leave` | Client → Server | Leave a chat room |
| `chat:message` | Client → Server | Send a message |
| `chat:message` | Server → Client | Receive a message |
| `chat:read` | Client → Server | Mark messages as read |
| `match:new` | Server → Client | New match notification |
| `match:accepted` | Server → Client | Match accepted notification |
| `us:partner:presence` | Server → Client | Ambient partner presence in the couple room: `{ userId, online }` on first-socket connect / last-socket disconnect. Socket-only — no notification, no push |

---

## Implementation Phases

### ✅ Phase 0 — Scaffold (Current)
- [x] Project structure & TypeScript config
- [x] Express app factory
- [x] MongoDB connection
- [x] Health check endpoint
- [x] Env validation
- [x] Logger, AppError, asyncHandler utilities
- [x] Global error handler
- [x] .gitignore, README, RULES, PLAN, CHANGELOG

### 🔲 Phase 1 — Auth
- [ ] OtpToken model
- [ ] User model
- [ ] OTP send/verify
- [ ] JWT access + refresh token flow
- [ ] Auth middleware

### 🔲 Phase 2 — Couple Profiles
- [ ] Couple model
- [ ] Couple CRUD + avatar upload
- [ ] Partner invite system
- [ ] Onboarding answers persistence

### 🔲 Phase 3 — Matching
- [ ] Match model + algorithm
- [ ] Accept / reject flow
- [ ] Socket match notifications

### 🔲 Phase 4 — Communities & Chat
- [ ] Community model & CRUD
- [ ] Message model
- [ ] REST message history
- [ ] Socket.io real-time chat

### 🔲 Phase 5 — Polish & Production
- [ ] Rate limiting
- [ ] Input sanitization
- [ ] Comprehensive error handling
- [ ] Unit + integration tests
- [ ] CI/CD pipeline

## Architecture Decisions

### 2026-08-31 — Nudge Layer: Postgres outbox, pure policy, channel adapters (WATI)

Every meaningful moment must be able to reach the other partner on WhatsApp with one tap back
into the exact screen (Arfam). Shape: producers write an `EngagementEvent` (the existing push
payload IS the event; `push.service` calls `recordPushEvent`, so 21 call sites changed nothing)
→ the worker (`jobs/nudgeWorker.ts`, pm2 worker 0) claims events with `FOR UPDATE SKIP LOCKED`
→ `nudge.policy.decide()` (pure: excluded family, channel on, template enabled, phone, opt-in,
muted, online/active, family cooldown, daily cap, global cap; NO quiet hours by decision) →
`NudgeDelivery` rows → the dispatcher renders template variables and calls the provider behind
`WhatsAppProvider` (WATI in production, Twilio retained). Postgres is the queue on purpose: no new
dependency, works without Redis, and the DB was the durable store anyway; a dedicated worker
task can drain the same tables later (`NUDGE_WORKER_ENABLED`). Templates seed disabled and are
enabled by admin once approved at the BSP: "approved" is a DB flag, so nothing fires before Meta
says yes. Links are unguessable tokens (`/l/<token>`) resolved couple-scoped so one couple can
never read another's target; the browser fallback keeps a deferred intent for the partner who
has no app yet. Consent is a server preference (`/nudges/preferences`), flipped by STOP/START
on WhatsApp itself or the Settings toggle. Chat and cycle are hard-excluded from WhatsApp.

## Security Decisions

### 2026-08-20 — SMS abuse guard sits in the send funnel, not the route layer

Every OTP/invite SMS passes `src/services/abuseGuard.ts` from inside
`otp.service.ts` (`generateAndStore` / `sendInvitation`) — the single funnel to
`twilioClient.messages.create` — so no current or future caller can send an
SMS unguarded. Layers, each with its own Redis day-bucket key: corridor
allowlist (`SMS_ALLOWED_PREFIXES`, default `+91`), per-phone daily cap,
per-8-digit-prefix daily cap (blocks sequential-range pumping), per-IP daily
budget (on top of the 15-min burst limiter), and a global daily kill-switch
(`SMS_DAILY_GLOBAL_CAP`) incremented LAST so refused probes cannot drain the
platform budget. Redis outage degrades to per-process counters (bounded at
workers × cap), never to unbounded spend and never to a login outage. First
trip of any layer per UTC day → `logger.error` + optional `ALERT_WEBHOOK_URL`
POST (fire-and-forget). All knobs in `src/config/env.ts`, optional with
defaults.

### 2026-08-20 — Access-token TTL stays 7d; logout revokes via Redis (H4)

`JWT_ACCESS_EXPIRES_IN` remains `7d`: the admin panel authenticates with the
same access tokens and has NO refresh flow, so a shorter default would log
admins out mid-session. Logout containment is Redis-side instead, on two axes
checked in parallel by `middleware/authenticate.ts` and the Socket.io
handshake: a per-token `jti` denylist (`utils/jwt.ts`, kills exactly the token
presented at logout, TTL = its remaining life) and a per-user issued-before
watermark (`services/tokenDenylist.ts`, kills EVERY access token issued before
the logout — including older copies an attacker may hold from before a refresh
rotation). Fail-open on Redis outage (bounded by token `exp`; refresh is
already dead because logout clears the refresh hash). Shortening the TTL later
requires an admin-panel refresh flow first and a PLAN.md entry (RULES §3).
