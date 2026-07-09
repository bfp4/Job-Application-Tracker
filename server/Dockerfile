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
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

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
