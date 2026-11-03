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
# Python + PyMuPDF for design-kept PDFs (server/layout/pdf_layout.py). --no-deps: PyMuPDF 2.x
# pulls onnxruntime/numpy (~130MB) for features this app doesn't use. PyMuPDF is AGPL-3.0,
# hence this repository's LICENSE.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv \
  && rm -rf /var/lib/apt/lists/* \
  && python3 -m venv /opt/layout \
  && /opt/layout/bin/pip install --no-cache-dir --no-deps pymupdf==2.1
ENV LAYOUT_PYTHON=/opt/layout/bin/python
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY scripts ./scripts
COPY --from=build /app/client/dist ./client/dist
# SQLite database lives on the persistent volume mounted at /var/data
VOLUME /var/data
EXPOSE 3000
CMD ["node", "server/index.js"]
