# ---- Stage 1: build web + server -------------------------------------------
FROM node:22-alpine AS build
# better-sqlite3 is a native module; on Alpine it compiles from source unless a
# prebuilt binary is available. Keep the toolchain for install/build time only.
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- Stage 2: runtime -------------------------------------------------------
FROM node:22-alpine
ENV NODE_ENV=production \
    TOSSARR_CONFIG_DIR=/config
WORKDIR /app
COPY package.json package-lock.json ./
# Install prod deps (rebuilds better-sqlite3 for this image), then drop the
# build toolchain to keep the final image small.
RUN apk add --no-cache python3 make g++ \
    && npm ci --omit=dev \
    && apk del --no-network python3 make g++ \
    && npm cache clean --force
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/public ./server/public
USER node
EXPOSE 8901
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
    CMD wget -qO- http://localhost:8901/api/health || exit 1
CMD ["node", "server/dist/src/index.js"]
