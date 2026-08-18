# ── Stage 1: build ──────────────────────────────────────────────
FROM node:22 AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/ ./packages/
RUN npm ci

COPY tsconfig.json tsconfig.runtime.json tsconfig.build.json ./
COPY src/ ./src/
COPY mock/ ./mock/

RUN npm run build:runtime
RUN npx tsc -p tsconfig.build.json
RUN find src -name '*.md' -exec sh -c 'mkdir -p "dist/src/$(dirname "${1#src/}")" && cp "$1" "dist/src/${1#src/}"' _ {} \;

# ── Stage 2: production ─────────────────────────────────────────
FROM node:22-slim AS production
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/packages ./packages
COPY --from=build /app/mock ./mock
COPY --from=build /app/package.json ./

COPY web/ ./web/
COPY data/ ./data/
COPY migrations/ ./migrations/

ENV NODE_ENV=production
EXPOSE 9600
CMD ["node", "dist/src/adapters/web/index.js"]
