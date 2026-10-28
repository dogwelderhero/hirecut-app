#!/usr/bin/env bash
# Start hirecute on this computer and open it in the browser.
#
#   ./up.sh              the scenario split decides (as for a new visitor)
#   ./up.sh recruiter    open one scenario (any file in web/scenarios/)
#
# Needs Docker Desktop running. Stop with ./down.sh.
set -euo pipefail
cd "$(dirname "$0")"

NAME=hirecute-local
IMAGE=hirecute:local
PORT="${PORT:-8080}"
URL="http://127.0.0.1:${PORT}"
ENV_FILE=.env.hirecute.local
FLOW="${1:-}"

say() { printf '\n==> %s\n' "$*"; }
fail() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

docker info >/dev/null 2>&1 || fail "Docker is not running. Start Docker Desktop, wait until it says it is running, then run ./up.sh again."

if [ -n "$FLOW" ] && [ ! -f "web/scenarios/${FLOW}.json" ]; then
  known=$(ls web/scenarios/*.json | sed 's#.*/##; s#\.json$##' | tr '\n' ' ')
  fail "There is no scenario \"${FLOW}\". Known scenarios: ${known}"
fi

if [ ! -f "$ENV_FILE" ]; then
  cp .env.hirecute.example "$ENV_FILE"
  fail "Created ${ENV_FILE}. Open it, paste the model key after HIRECUTE_MODEL_API_KEY=, save, and run ./up.sh again."
fi
grep -Eq '^HIRECUTE_MODEL_API_KEY=.+' "$ENV_FILE" || fail "The model key is empty. Open ${ENV_FILE}, paste it after HIRECUTE_MODEL_API_KEY=, save, and run ./up.sh again."

say "Building the app (the first time takes a few minutes; later only changes are rebuilt)"
docker build -f web/Dockerfile -t "$IMAGE" .

say "Starting it"
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" -p "127.0.0.1:${PORT}:8080" --env-file "$ENV_FILE" \
  -e HIRECUTE_BASE_URL="$URL" -e CAREER_OPS_WEB_ALLOWED_HOSTS=127.0.0.1 \
  "$IMAGE" >/dev/null

say "Waiting until it is ready"
for _ in $(seq 1 90); do
  if curl -fsS "${URL}/health" >/dev/null 2>&1; then ready=1; break; fi
  if [ "$(docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null)" != "true" ]; then
    docker logs --tail 40 "$NAME" >&2 || true
    fail "The app stopped while starting (its log is above). A wrong or expired model key is the usual reason."
  fi
  sleep 1
done
[ "${ready:-}" = 1 ] || fail "The app did not become ready in 90 seconds. See: docker logs ${NAME}"

OPEN="${URL}/"
[ -n "$FLOW" ] && OPEN="${URL}/?t=${FLOW}"
say "Ready: ${OPEN}"
echo "    Always use this address (127.0.0.1, not localhost), or uploads are refused."
echo "    To switch scenario after a run has started: \"Start over\", or ./up.sh <scenario>."
echo "    Stop: ./down.sh    Log: docker logs -f ${NAME}"

if command -v open >/dev/null 2>&1; then open "$OPEN"
elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$OPEN" >/dev/null 2>&1 || true
elif command -v cmd.exe >/dev/null 2>&1; then MSYS_NO_PATHCONV=1 cmd.exe /c start "" "$OPEN"
fi
