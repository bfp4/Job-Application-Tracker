# syntax=docker/dockerfile:1

# ---- Build stage: compile TypeScript and generate the Prisma client ----
FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ---- Runtime stage: production deps only ----
# Debian (not alpine): Prisma's engines target debian-openssl-3.0.x natively.
FROM node:22-bookworm-slim
# chromium + supporting libs: puppeteer-core's own Chromium download doesn't
# cover linux-arm64 (this image runs on t4g.micro Graviton), so we install
# Debian's own arm64 Chromium build and point PUPPETEER_EXECUTABLE_PATH at it
# instead (see server/src/services/linkedProfileScraper.ts).
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        openssl ca-certificates curl \
        chromium libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
        libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 \
        libasound2 libpango-1.0-0 libpangocairo-1.0-0 fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# prisma is a production dependency so this image can also run
# `npx prisma migrate deploy` on the instance (CI cannot reach the private RDS).
COPY prisma ./prisma
RUN npx prisma generate

COPY --from=build /app/dist ./dist

EXPOSE 5000
CMD ["node", "dist/index.js"]
