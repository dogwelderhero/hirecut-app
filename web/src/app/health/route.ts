// Liveness probe for the container host (App Platform's health check, Docker's
// HEALTHCHECK). It lives outside /api on purpose: the proxy's origin guard only
// answers loopback Hosts unless an operator opts hosts in, and a platform health
// checker calls from its own network with no browser headers. Nothing here reads
// config, files or the model — a probe that can fail on a dependency restarts a
// healthy process.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return new Response("ok", {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}
