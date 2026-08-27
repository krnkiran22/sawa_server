# syntax=docker/dockerfile:1
# Sawa API server. Runs on ECS Fargate behind an ALB (sawa_infra).
# Contract preserved from the Railway era: `npm start` applies the Prisma
# schema (db push) and then boots pm2-runtime with ecosystem.config.js,
# which self-limits to ONE worker when REDIS_URL is absent (Socket.io
# events only cross workers through the Redis adapter).

# ---- build: full deps, generated Prisma client, tsc ----
FROM node:22-slim AS build
WORKDIR /app
# Prisma engines want OpenSSL present even on bookworm-slim.
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# --ignore-scripts: postinstall runs `prisma generate && tsc`, which cannot
# work before prisma/ and src/ are copied; both run explicitly below.
RUN npm ci --ignore-scripts
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

# ---- runtime: production deps only ----
FROM node:22-slim AS runtime
WORKDIR /app
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
# prisma CLI, @prisma/client, and pm2 are production dependencies, so the
# pruned install still carries everything `npm start` touches.
COPY prisma ./prisma
RUN npx prisma generate
COPY ecosystem.config.js ./
COPY --from=build /app/dist ./dist
EXPOSE 5000
CMD ["npm", "start"]
