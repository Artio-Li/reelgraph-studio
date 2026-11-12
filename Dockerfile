FROM node:22-bookworm-slim AS web-builder

WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev --no-audit --no-fund

COPY server/ ./server/
COPY --from=web-builder /app/web/dist ./web/dist

RUN mkdir -p /app/server/data/media /app/server/data/uploads \
    && chown -R node:node /app

USER node
EXPOSE 8787

CMD ["node", "server/src/index.js"]
