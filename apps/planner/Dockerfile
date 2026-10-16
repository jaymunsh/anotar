FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=127.0.0.1 PORT=8794 PLANNER_DATA_DIR=/data
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY server ./server
COPY scripts/backup.mjs ./scripts/backup.mjs
COPY scripts/restore.mjs ./scripts/restore.mjs
USER node
CMD ["node", "server/index.mjs"]
