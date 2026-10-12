# syntax=docker/dockerfile:1

# Build and runtime use the same OS so Prisma and native modules stay compatible.
FROM node:22-bookworm-slim AS base
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json ./
# npm ci runs the existing postinstall Prisma generation; no database is used.
COPY prisma/schema.prisma ./prisma/schema.prisma
RUN npm ci --no-audit --no-fund
COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build \
    && test -f dist/main.js \
    && test -f dist/components/admin-stay-imports/roster-workbook.worker.js

FROM build AS production-dependencies
# Keep optional dependencies: Sharp needs its platform-specific @img packages.
# Do not rerun postinstall while removing the development-only Prisma CLI.
RUN npm prune --omit=dev --ignore-scripts --no-audit --no-fund

# Optional operator image: migrations and existing interactive/cleanup commands.
# It retains build dependencies without adding them to the API runtime image.
FROM build AS operator
ENV NODE_ENV=production
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node prisma/migrations ./prisma/migrations
USER node
# Safe default: display CLI help without opening a database connection.
CMD ["node", "node_modules/prisma/build/index.js", "--help"]

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
# Preserve the generated Linux client explicitly, independently of npm pruning.
COPY --from=build --chown=node:node /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json
USER node
# These checks load libraries only; they do not start the API or contact a DB/S3.
RUN node -e "require('@prisma/client'); require('sharp'); require('bcrypt')"
EXPOSE 3100
# Application liveness only; database schema and S3 acceptance are separate.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '3100') + '/health', { signal: AbortSignal.timeout(3000) }).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/main.js"]
