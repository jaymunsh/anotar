FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
COPY shared ./shared
COPY public ./public
COPY docs/architecture-overview.html ./docs/architecture-overview.html
COPY docs/design ./docs/design
COPY scripts/build-offline-manifest.mjs ./scripts/build-offline-manifest.mjs
RUN npm run build

FROM node:24-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 DATA_DIR=/data
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && mkdir -p /data
COPY server ./server
COPY shared ./shared
COPY scripts/backup-data.mjs ./scripts/backup-data.mjs
COPY scripts/auth-setup.mjs ./scripts/auth-setup.mjs
COPY scripts/host-site.mjs ./scripts/host-site.mjs
COPY --from=build /app/dist ./dist
EXPOSE 8787
VOLUME /data
CMD ["node", "server/index.mjs"]
