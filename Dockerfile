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
  && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && python3 -m venv /opt/layout \
  && /opt/layout/bin/pip install --no-cache-dir --no-deps pymupdf==2.1
ENV LAYOUT_PYTHON=/opt/layout/bin/python
# Scanned PDFs: PyMuPDF has Tesseract built in and needs only the language models. These are
# tessdata_fast 4.1.0 (1–4 MB each, about 75 MB together); keep the list in step with
# TESSERACT in server/services/layout.js.
ARG TESSDATA_LANGS="eng spa por fra deu ita nld pol rus ukr tur swe dan nor fin ces ron hun ell jpn chi_sim chi_tra kor ara heb hin vie ind tha"
RUN mkdir -p /opt/tessdata && /opt/layout/bin/python -c "import sys, urllib.request; [urllib.request.urlretrieve(f'https://github.com/tesseract-ocr/tessdata_fast/raw/4.1.0/{l}.traineddata', f'/opt/tessdata/{l}.traineddata') for l in sys.argv[1:]]" $TESSDATA_LANGS
ENV TESSDATA_PREFIX=/opt/tessdata
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY scripts ./scripts
COPY --from=build /app/client/dist ./client/dist
# SQLite database lives on the persistent volume mounted at /var/data
VOLUME /var/data
EXPOSE 3000
CMD ["node", "server/index.js"]
