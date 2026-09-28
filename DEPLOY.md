# Deploying hirecute to DigitalOcean App Platform

hirecute ships as a Docker image in DigitalOcean Container Registry (DOCR);
App Platform runs that image. Files involved:

| File | Purpose |
|------|---------|
| `web/Dockerfile` | Production image (multi-stage, non-root, Chromium headless shell) |
| `web/Dockerfile.dockerignore` | Build-context **allowlist** — keeps the repo root's personal data out of the image |
| `web/src/app/health/route.ts` | `GET /health` → `200 ok`, the App Platform health check |
| `.do/app.yaml` | App Platform spec (DOCR image source) |

This is separate from the root `Dockerfile` / `DOCKER.md`, which is the
career-ops local dev container.

> **Storage is ephemeral.** hirecute keeps sessions, runs, generated PDFs and
> billing grants as files under `HIRECUTE_DATA_DIR`. App Platform has no
> persistent volumes, so all of it is lost on every deploy and every restart.
> Fine for a demo/pilot; not for real users. Moving to a persistent host means a
> Droplet + Block Storage volume running the same image, or moving state to
> Spaces/Postgres. Keep `instance_count: 1` — the app assumes one instance.

## Variables used below

```bash
REGISTRY=<your-registry-name>                  # doctl registry get
IMAGE=registry.digitalocean.com/$REGISTRY/hirecute
# git short SHA; "-dirty" when the working tree has uncommitted changes, so a
# tag never claims to be a commit it isn't.
TAG=$(git rev-parse --short HEAD)$(git diff --quiet HEAD || echo -dirty)
APP_ID=<app-id>                                # doctl apps list
```

Run everything from the **repo root** — the image needs root career-ops scripts.

## One-time setup

```bash
brew install doctl
doctl auth init                 # paste an API token (Control Panel → API → Tokens)
doctl account get               # confirm

# Registry (skip if you have one). Starter tier is free but capped at 500 MiB;
# the image is ~590 MB compressed (~1.6 GB uncompressed), and every extra tag
# with changed layers adds to it — Basic tier leaves room for rollbacks.
doctl registry create $REGISTRY --subscription-tier basic --region nyc3
```

App Platform pulls from a DOCR registry in the same account without extra
credentials.

## 1. Build

```bash
docker buildx build --platform linux/amd64 -f web/Dockerfile -t hirecute:latest --load .
```

`linux/amd64` is required: App Platform runs amd64, and Apple Silicon builds
arm64 by default.

## 2. Test locally

```bash
docker run --rm --name hirecute-local -p 8080:8080 \
  --env-file web/.env.local \
  -e HIRECUTE_BASE_URL=http://localhost:8080 \
  -e CAREER_OPS_WEB_ALLOWED_HOSTS=localhost \
  hirecute:latest

curl -i localhost:8080/health          # 200 ok
open http://localhost:8080
```

`--env-file` passes your local secrets at run time; nothing from `.env*` is in
the image.

## 3. Push to DOCR

```bash
doctl registry login
docker tag hirecute:latest $IMAGE:$TAG
docker tag hirecute:latest $IMAGE:latest
docker push $IMAGE:$TAG
docker push $IMAGE:latest
```

Or build and push in one step:

```bash
docker buildx build --platform linux/amd64 -f web/Dockerfile \
  -t $IMAGE:$TAG -t $IMAGE:latest --push .
```

## 4. Create the app (first deploy)

1. In `.do/app.yaml`, set `region` to your registry's region and `tag` to
   `$TAG` (or leave `latest`).
2. Create it:

   ```bash
   doctl apps create --spec .do/app.yaml
   doctl apps list                      # note the app ID
   ```

3. In the dashboard (App → Settings → `web` → Environment Variables), replace
   `REPLACE_IN_DASHBOARD` for `HIRECUTE_MODEL_API_KEY` (and the Stripe secrets
   if enabled). Saving triggers a redeploy.
4. **Pull the live spec back** so the file stops carrying placeholders:

   ```bash
   doctl apps spec get $APP_ID > .do/app.yaml
   ```

   Secrets come back encrypted as `EV[...]` and are safe to commit. Skipping
   this step means the next `doctl apps update` resets your secrets to the
   placeholders. The export drops the file's comments, so copying just the
   `EV[...]` values into the existing file works as well.

   From here on `doctl apps spec validate .do/app.yaml` fails with "secret env
   value must not be encrypted before app is created" — it validates as a new
   app. That is expected; `doctl apps update` accepts the file.

Find the URL with `doctl apps get $APP_ID --format DefaultIngress`.

## 5. Deploy a new version

```bash
TAG=$(git rev-parse --short HEAD)$(git diff --quiet HEAD || echo -dirty)
docker buildx build --platform linux/amd64 -f web/Dockerfile \
  -t $IMAGE:$TAG -t $IMAGE:latest --push .
```

Then point the app at it: set `tag: <TAG>` under `services[0].image` in
`.do/app.yaml` and

```bash
doctl apps update $APP_ID --spec .do/app.yaml
```

Pinning a SHA tag makes each deployment reproducible and rollback exact. If the
spec keeps `tag: latest`, redeploy the freshly pushed `latest` with
`doctl apps create-deployment $APP_ID` instead.

Remember: every deploy wipes the app's data (see the storage note above).

## 6. Logs and status

```bash
doctl apps list-deployments $APP_ID
doctl apps logs $APP_ID web --type run --follow    # application output
doctl apps logs $APP_ID web --type deploy          # image pull / start / health check
```

A deploy that never goes healthy usually shows up in the `deploy` logs:
the health check at `/health` failing, or the container exiting on start.

## 7. Roll back

Set `tag` in `.do/app.yaml` to the previous SHA (see `list-deployments` or
`doctl registry repository list-tags hirecute`) and run
`doctl apps update $APP_ID --spec .do/app.yaml`. The dashboard's Activity tab
also offers a one-click rollback to an earlier deployment.

## Registry housekeeping

```bash
doctl registry repository list-tags hirecute
doctl registry repository delete-tag hirecute <old-tag>
doctl registry garbage-collection start --include-untagged-manifests
```

## Environment variables

| Variable | Notes |
|----------|-------|
| `HIRECUTE_MODEL_API_BASE_URL`, `HIRECUTE_MODEL` | Model endpoint and name |
| `HIRECUTE_MODEL_API_KEY` | **SECRET** |
| `HIRECUTE_MODEL_FAST`, `HIRECUTE_MODEL_JUDGMENT` | Optional; fall back to `HIRECUTE_MODEL` |
| `HIRECUTE_BASE_URL` | Public URL; the spec binds `${APP_URL}` |
| `CAREER_OPS_WEB_ALLOWED_HOSTS` | The app's host (`${APP_DOMAIN}`) plus any custom domain — without it every `/api` call is refused |
| `HIRECUTE_PUBLIC_BUILD` / `HIRECUTE_SUBMISSION_ENABLED` | `true` / `false`, set in the image |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | **SECRET**, only with billing |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Runtime, only with billing; mode must match the secret key |
| `HIRECUTE_CODE_ROOT`, `HIRECUTE_DATA_DIR`, `PORT` | Set by the image (`/app`, `/app/var/hirecute`, `8080`); App Platform sets `PORT` from `http_port` |
