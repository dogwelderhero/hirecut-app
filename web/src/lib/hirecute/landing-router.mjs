/**
 * The landing router: which scenario a visitor arriving at `/` sees, and what
 * the browser remembers about it.
 *
 * Runs in proxy.ts for `/` only. Pure — the proxy supplies the request facts
 * and applies the returned cookies — so every branch is testable without Next.
 *
 * Two cookies, both httpOnly (the browser never needs to read them):
 *   hc_scn   the assigned scenario id. Written on EVERY landing, so whatever
 *            the visitor got — by link, by split, after an unknown or a
 *            switched-off value — sticks on their next visit without one.
 *   hc_attr  attribution of the latest assignment or campaign touch: how the
 *            scenario was chosen, the ?param value, utm_* and the referrer host.
 *            The POST that creates a run carries no query, so this is how the
 *            landing's context reaches run.json.
 */

import { parseScenariosEnv, resolveScenario, scenarioParam, COOKIE } from "./scenarios.mjs";

export const SCENARIO_COOKIE = COOKIE;
export const ATTR_COOKIE = "hc_attr";
/** Request header the proxy hands to the page (never sent to the browser). */
export const SCENARIO_HEADER = "x-hc-scenario";
export const STICKY_MAX_AGE_S = 365 * 24 * 60 * 60;

const UTM = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];
const clip = (v, n = 120) => (typeof v === "string" && v ? v.slice(0, n) : null);

/** base64url JSON, so the cookie value needs no quoting. */
export function encodeAttribution(attr) {
  return Buffer.from(JSON.stringify(attr), "utf8").toString("base64url");
}

/** Lenient: a tampered or truncated cookie reads as "no attribution", never a crash. */
export function decodeAttribution(value) {
  if (!value) return null;
  try {
    const a = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    return a && typeof a === "object" && typeof a.scenario === "string" ? a : null;
  } catch {
    return null;
  }
}

/**
 * @param {object} req
 * @param {URLSearchParams} req.query
 * @param {string|null} [req.scenarioCookie]
 * @param {string|null} [req.attrCookie]
 * @param {string|null} [req.referer]
 * @param {boolean} [req.secure]          https at the edge (cookie Secure flag)
 * @param {Record<string,string|undefined>} env
 * @param {{random?: () => number, now?: () => Date}} [deps]
 * @returns {{ok: false, error: string}
 *   | {ok: true, scenario: string, reason: string, assigned: boolean,
 *      cookies: Array<{name: string, value: string, maxAge: number, httpOnly: true, sameSite: "lax", secure: boolean, path: "/"}>,
 *      attribution: object|null}}
 */
export function routeLanding(req, env, deps = {}) {
  const { random = Math.random, now = () => new Date() } = deps;
  const param = scenarioParam(env);
  const parsed = parseScenariosEnv(env.HIRECUTE_SCENARIOS);
  if (!param || !parsed.ok) {
    // Preflight refuses to boot with this config; if it is ever reached, the
    // page renders and run creation reports the configuration error.
    return { ok: false, error: !param ? "HIRECUTE_SCENARIO_PARAM is not set" : parsed.error };
  }

  const value = clip(req.query.get(param), 64);
  const pick = resolveScenario({ value, cookie: req.scenarioCookie ?? null, entries: parsed.entries, random });
  // "sticky" means nothing new happened; every other reason is an assignment.
  const assigned = pick.reason !== "sticky";

  const utm = {};
  for (const k of UTM) {
    const v = clip(req.query.get(k));
    if (v) utm[k] = v;
  }
  const touched = Object.keys(utm).length > 0;

  const cookie = (name, v) => ({
    name, value: v, maxAge: STICKY_MAX_AGE_S, httpOnly: true, sameSite: "lax", secure: Boolean(req.secure), path: "/",
  });
  const cookies = [cookie(SCENARIO_COOKIE, pick.id)];

  let attribution = null;
  if (assigned || touched) {
    let refHost = null;
    try {
      refHost = req.referer ? new URL(req.referer).host || null : null;
    } catch {
      refHost = null;
    }
    attribution = {
      scenario: pick.id,
      reason: pick.reason,
      param,
      value,
      ...(touched ? { utm } : {}),
      referrer: clip(refHost, 255),
      at: now().toISOString(),
    };
    cookies.push(cookie(ATTR_COOKIE, encodeAttribution(attribution)));
  }

  return { ok: true, scenario: pick.id, reason: pick.reason, assigned, cookies, attribution };
}

/**
 * What createRun records: the assignment's attribution when it belongs to the
 * scenario the run actually got, otherwise a bare "sticky" (the visitor came
 * back without a link after the attribution cookie aged out or was replaced).
 */
export function runAttribution(attrCookie, scenarioId) {
  const a = decodeAttribution(attrCookie);
  return a && a.scenario === scenarioId ? a : { scenario: scenarioId, reason: "sticky" };
}
