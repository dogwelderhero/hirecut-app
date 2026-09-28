# syntax=docker/dockerfile:1.7
#
# hirecute production image (DigitalOcean App Platform).
#
# Build from the REPO ROOT, not web/: the hirecute worker runs career-ops root
# scripts (build-cv-html.mjs, generate-pdf.mjs, providers/, templates/, modes/)
# at request time, so they must be in the image.
#
#   docker buildx build --platform linux/amd64 -f web/Dockerfile -t hirecute:latest .
#
# The context is filtered by web/Dockerfile.dockerignore (an ALLOWLIST), which
# BuildKit picks up automatically for `-f web/Dockerfile`. The repo root holds
# the operator's personal data (cv.md, data/, reports/, config/profile.yml);
# none of it may reach the image.
#
# This is NOT the root ./Dockerfile — that one is the career-ops dev container
# and has its own pin test.

ARG NODE_IMAGE=node:22.23.3-bookworm-slim

# ── Root career-ops runtime deps (playwright, js-yaml, dotenv) ──────────────
FROM ${NODE_IMAGE} AS root-deps
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: the root postinstall downloads full Chromium; the runtime
# stage installs only the headless shell instead.
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

# ── web/ production deps ─────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS web-deps
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ── Build the Next app (needs devDeps: tailwind, typescript) ────────────────
FROM ${NODE_IMAGE} AS web-build
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
# No build-time env: every setting, including NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
# is read server-side at runtime (config.ts looks it up by name, which Next does
# not inline) and reaches the browser only through publicConfig().
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ── Runtime ──────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS runtime

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080 \
    HIRECUTE_CODE_ROOT=/app \
    HIRECUTE_DATA_DIR=/app/var/hirecute \
    HIRECUTE_PUBLIC_BUILD=true \
    HIRECUTE_SUBMISSION_ENABLED=false

WORKDIR /app

# tini reaps the Chromium processes the PDF step spawns; node as PID 1 does not.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/*

COPY --from=root-deps /app/node_modules ./node_modules
# Headless shell only (generate-pdf.mjs launches with headless: true), plus the
# system libraries it needs. Version follows the root lockfile's playwright.
#
# Installed at Playwright's DEFAULT path for the runtime user, deliberately not
# via a PLAYWRIGHT_BROWSERS_PATH env var: the worker spawns render children with
# an allowlisted env (paths.ts childEnv keeps PATH/HOME/... only), so any such
# var is stripped and Playwright falls back to $HOME/.cache/ms-playwright.
RUN PLAYWRIGHT_BROWSERS_PATH=/home/node/.cache/ms-playwright \
    node_modules/.bin/playwright install --with-deps --only-shell chromium \
 && chown -R node:node /home/node/.cache \
 && rm -rf /var/lib/apt/lists/* /root/.cache /root/.npm

# career-ops code root (already filtered to the allowlist by the dockerignore).
COPY --chown=node:node package.json tracker-aliases.json *.mjs ./
COPY --chown=node:node lib ./lib
COPY --chown=node:node providers ./providers
COPY --chown=node:node templates ./templates
COPY --chown=node:node modes ./modes

# web/: the worker (web/workers) imports web/src/lib/hirecute/*.mjs directly, so
# the source ships alongside the build output rather than a standalone bundle.
COPY --from=web-deps --chown=node:node /app/web/node_modules ./web/node_modules
COPY --from=web-build --chown=node:node /app/web/.next ./web/.next
COPY --chown=node:node web/package.json web/next.config.mjs ./web/
COPY --chown=node:node web/public ./web/public
COPY --chown=node:node web/fixtures ./web/fixtures
COPY --chown=node:node web/workers ./web/workers
COPY --chown=node:node web/src ./web/src

# Writable data dir. EPHEMERAL on App Platform: wiped on every deploy/restart.
RUN mkdir -p /app/var/hirecute && chown -R node:node /app/var

USER node
WORKDIR /app/web
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
# `next start` listens on $PORT (App Platform sets it).
CMD ["node", "node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0"]
