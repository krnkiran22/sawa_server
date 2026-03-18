# SAWA Backend — Rules & Conventions

> **Always read this file before making any changes to the backend.**

---

## 1. Brand & Identity Rules

- The backend serves the **SAWA** couples social app — a premium, safety-first platform for couple-to-couple social matching.
- Brand palette (for emails / push templates): Dark Teal `#1E5559`, Gin Fizz `#FFF8E2`, Hickory Gold `#D09B64`, Sweet Orange `#F7C3A6`.
- Do NOT alter the brand name, colors, or tone in any API response messages. Keep messaging warm, inclusive, and pair-focused.

---

## 2. Architecture Rules

- **No architecture changes** without updating `PLAN.md` first and adding an entry in `CHANGELOG.md`.
- Follow the **layered architecture** strictly:
  ```
  Route → Controller → Service → Repository → Model (Mongoose)
  ```
- **Never** put business logic in a route file or model file.
- **Never** query the DB directly from a controller — always go through the service layer.
- All database operations must live in `src/repositories/`.
- All business logic must live in `src/services/`.
- All HTTP handlers must live in `src/controllers/`.
- All route definitions must live in `src/routes/`.
- All Mongoose schemas/models must live in `src/models/`.

---

## 3. Code Quality Rules

- Use **TypeScript** for all source files. No `.js` source files.
- All functions must have explicit return type annotations.
- All async functions must use `async/await` — no raw Promise chains.
- Use `zod` for all request body & query param validation in controllers.
- Errors must be thrown using the custom `AppError` class (`src/utils/AppError.ts`).
- Use the central `asyncHandler` wrapper for all controller functions.
- Constants go in `src/constants/` — never use magic strings/numbers inline.

---

## 4. API Rules

- All routes are prefixed with `/api/v1/`.
- Responses must follow this shape:
  ```json
  { "success": true, "data": {}, "message": "..." }
  { "success": false, "error": "...", "code": 400 }
  ```
- HTTP status codes must always be semantically correct.
- Pagination: use `page` + `limit` query params. Max `limit` is 100.
- All list endpoints must return `{ data: [], total, page, limit }`.

---

## 5. Auth & Security Rules

- JWT access tokens expire in **15 minutes**. Refresh tokens expire in **30 days**.
- Refresh tokens are stored hashed in MongoDB.
- Never log or expose JWT secrets, passwords, or phone numbers in plain text.
- Passwords must be hashed with `bcrypt` (min 12 rounds).
- Phone numbers must be verified via OTP before account activation.
- Every protected route must use the `authenticate` middleware.
- Rate limiting is **mandatory** on auth endpoints (`/auth/*`).
- CORS origins must be whitelisted — no wildcard `*` in production.

---

## 6. Real-Time (Socket.io) Rules

- Socket events must be defined in `src/constants/socketEvents.ts`.
- All socket handlers must authenticate via JWT on the `auth` handshake object.
- Rooms follow the naming pattern:
  - `chat:${chatId}` — private chat
  - `group:${groupId}` — community group chat
  - `match:${matchId}` — match notification room

---

## 7. File & Naming Conventions

- Files: `camelCase.ts` for utilities/services, `PascalCase.ts` for models.
- Route files: `featureName.routes.ts`
- Controller files: `featureName.controller.ts`
- Service files: `featureName.service.ts`
- Repository files: `featureName.repository.ts`
- Model files: `FeatureName.model.ts`
- Type/Interface files: `featureName.types.ts`

---

## 8. Environment & Config Rules

- **Never commit `.env` files.** Use `.env.example` only.
- **Never commit `node_modules/`.** It is gitignored.
- All environment variables must be validated at startup via `src/config/env.ts`.
- The app must not start if required env vars are missing.

---

## 9. Logging Rules

- Use the centralized logger (`src/utils/logger.ts`) — no raw `console.log` in production code.
- Log levels: `error`, `warn`, `info`, `debug`.
- HTTP requests are automatically logged by the `morgan` middleware.
- Sensitive data (tokens, passwords, OTP codes) must NEVER appear in logs.

---

## 10. Documentation Rules

- **Every change must be logged** in `CHANGELOG.md` with date, author context, and description.
- `PLAN.md` must be kept up-to-date with architecture decisions.
- New API endpoints must be documented in `PLAN.md` under the API Reference section.
- `README.md` contains only setup/run instructions — not architecture docs.
