# Build from the repo root: docker build -f apps/web/Dockerfile .
FROM oven/bun:1.3.14 AS base
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/todos/package.json packages/todos/
COPY packages/indexer/package.json packages/indexer/
COPY apps/cli/package.json apps/cli/
COPY apps/web/package.json apps/web/

FROM base AS build
RUN bun install --frozen-lockfile
COPY . .
# Coolify passes the deployed commit as SOURCE_COMMIT; it becomes the /api/health version.
ARG SOURCE_COMMIT=dev
RUN ATLAS_VERSION=$SOURCE_COMMIT bun run --cwd apps/web build

FROM base AS run
# The server bundle imports react-dom and friends at runtime, so it needs a production install.
RUN bun install --frozen-lockfile --production
COPY --from=build /app/packages packages
COPY --from=build /app/apps/web/dist apps/web/dist
COPY apps/web/server.ts apps/web/
USER bun
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["bun", "apps/web/server.ts"]
