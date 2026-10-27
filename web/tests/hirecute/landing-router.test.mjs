import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ATTR_COOKIE,
  SCENARIO_COOKIE,
  STICKY_MAX_AGE_S,
  decodeAttribution,
  encodeAttribution,
  routeLanding,
  runAttribution,
} from "../../src/lib/hirecute/landing-router.mjs";

const ENV = { HIRECUTE_SCENARIO_PARAM: "t", HIRECUTE_SCENARIOS: "vacancy=50;recruiter=50;beta=0" };
const NOW = () => new Date("2026-10-27T12:00:00Z");

function land(url, { cookie = null, attr = null, referer = null, secure = true, random = () => 0.1, env = ENV } = {}) {
  return routeLanding(
    { query: new URL(url, "https://app.example").searchParams, scenarioCookie: cookie, attrCookie: attr, referer, secure },
    env,
    { random, now: NOW },
  );
}
const cookieOf = (d, name) => d.cookies.find((c) => c.name === name);

test("?t=<enabled> assigns that scenario and pins it, even over an existing cookie", () => {
  const d = land("/?t=recruiter", { cookie: "vacancy" });
  assert.deepEqual([d.scenario, d.reason, d.assigned], ["recruiter", "param", true]);
  const c = cookieOf(d, SCENARIO_COOKIE);
  assert.deepEqual(c, { name: SCENARIO_COOKIE, value: "recruiter", maxAge: STICKY_MAX_AGE_S, httpOnly: true, sameSite: "lax", secure: true, path: "/" });
});

test("a link-only (weight 0) scenario is reachable by ?t= and never by the split", () => {
  assert.equal(land("/?t=beta").scenario, "beta");
  for (let i = 0; i < 100; i++) assert.notEqual(land("/", { random: () => i / 100 }).scenario, "beta");
});

test("a return visit without ?t= keeps the pinned scenario and is not a new assignment", () => {
  const d = land("/", { cookie: "recruiter", random: () => 0 });
  assert.deepEqual([d.scenario, d.reason, d.assigned], ["recruiter", "sticky", false]);
  assert.equal(cookieOf(d, SCENARIO_COOKIE).value, "recruiter", "the cookie is refreshed every visit");
  assert.equal(cookieOf(d, ATTR_COOKIE), undefined, "nothing new to attribute");
});

test("an unknown ?t= value goes to the split, and the result is pinned for next time", () => {
  const d = land("/?t=nope", { random: () => 0.9 });
  assert.deepEqual([d.scenario, d.reason, d.assigned], ["recruiter", "param-unknown", true]);
  assert.equal(cookieOf(d, SCENARIO_COOKIE).value, "recruiter");
  const back = land("/", { cookie: cookieOf(d, SCENARIO_COOKIE).value, random: () => 0 });
  assert.deepEqual([back.scenario, back.reason], ["recruiter", "sticky"]);
});

test("a cookie for a switched-off scenario is re-split", () => {
  const d = land("/", { cookie: "retired", random: () => 0 });
  assert.deepEqual([d.scenario, d.reason], ["vacancy", "sticky-disabled"]);
});

test("first visit: split, attributed, with utm and the referrer host only", () => {
  const d = land("/?utm_source=google&utm_campaign=autoapply_q4&gclid=x", { referer: "https://www.google.com/search?q=cv", random: () => 0.6 });
  assert.deepEqual([d.scenario, d.reason], ["recruiter", "split"]);
  assert.deepEqual(d.attribution, {
    scenario: "recruiter",
    reason: "split",
    param: "t",
    value: null,
    utm: { utm_source: "google", utm_campaign: "autoapply_q4" },
    referrer: "www.google.com",
    at: "2026-10-27T12:00:00.000Z",
  });
  assert.deepEqual(decodeAttribution(cookieOf(d, ATTR_COOKIE).value), d.attribution);
});

test("a new campaign touch on a sticky visitor refreshes attribution without reassigning", () => {
  const d = land("/?utm_source=newsletter", { cookie: "vacancy" });
  assert.deepEqual([d.scenario, d.reason, d.assigned], ["vacancy", "sticky", false]);
  assert.equal(decodeAttribution(cookieOf(d, ATTR_COOKIE).value).utm.utm_source, "newsletter");
});

test("values are clipped so a crafted URL cannot bloat the cookies", () => {
  const d = land(`/?t=${"x".repeat(500)}&utm_source=${"y".repeat(500)}`);
  assert.equal(d.attribution.value.length, 64);
  assert.equal(d.attribution.utm.utm_source.length, 120);
});

test("Secure follows the edge protocol", () => {
  assert.equal(cookieOf(land("/?t=vacancy", { secure: false }), SCENARIO_COOKIE).secure, false);
});

test("the parameter name comes from env", () => {
  const d = land("/?flow=recruiter", { env: { ...ENV, HIRECUTE_SCENARIO_PARAM: "flow" } });
  assert.deepEqual([d.scenario, d.reason], ["recruiter", "param"]);
  assert.equal(land("/?flow=recruiter", { random: () => 0 }).reason, "split", "t is the param here; flow is just noise");
});

test("broken scenario env is reported, not guessed around", () => {
  assert.equal(land("/", { env: { HIRECUTE_SCENARIO_PARAM: "t", HIRECUTE_SCENARIOS: "a=70;b=20" } }).ok, false);
  assert.equal(land("/", { env: { HIRECUTE_SCENARIOS: "vacancy=100" } }).ok, false);
});

test("a tampered attribution cookie reads as none", () => {
  assert.equal(decodeAttribution("not-base64-json"), null);
  assert.equal(decodeAttribution(encodeAttribution({ no: "scenario" })), null);
});

test("a run keeps the landing's attribution only for the scenario it actually got", () => {
  const attr = encodeAttribution({ scenario: "vacancy", reason: "param", value: "vacancy" });
  assert.equal(runAttribution(attr, "vacancy").reason, "param");
  assert.deepEqual(runAttribution(attr, "recruiter"), { scenario: "recruiter", reason: "sticky" });
  assert.deepEqual(runAttribution(null, "vacancy"), { scenario: "vacancy", reason: "sticky" });
});
