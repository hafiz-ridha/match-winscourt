# match.wins-court.com — image produksi
# Node 24: menjalankan TypeScript langsung (type stripping) dan punya SQLite bawaan (node:sqlite).

# ---------- tahap build: bundel frontend ----------
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html vite.config.ts tsconfig.json ./
COPY public ./public
COPY src ./src
COPY shared ./shared
RUN npm run build

# ---------- tahap runtime ----------
FROM node:24-alpine
ENV NODE_ENV=production \
    PORT=8787 \
    DB_FILE=/app/data/match.db
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY shared ./shared
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
EXPOSE 8787
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8787/api/config >/dev/null || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.ts"]
