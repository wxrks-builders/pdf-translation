# Build stage: install everything and build the client bundle.
# Debian-slim (not alpine) so better-sqlite3 uses its prebuilt binaries
# instead of compiling against musl.
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
COPY client/package*.json client/
RUN npm ci && npm ci --prefix client
COPY . .
RUN npm run client:build

# Runtime stage: server deps only + built client
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY scripts ./scripts
COPY --from=build /app/client/dist ./client/dist
# SQLite database lives on the persistent volume mounted at /var/data
VOLUME /var/data
EXPOSE 3000
CMD ["node", "server/index.js"]
