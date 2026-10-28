import { test } from "node:test";
import assert from "node:assert/strict";
import { correctionTurn } from "../../src/lib/hirecute/model.mjs";
import {
  mergePages,
  parseMode,
  parseResume,
  qualityProblems,
  repairParse,
  validateParse,
} from "../../src/lib/hirecute/resume-parse.mjs";

const SOURCE =
  "Hannah Okafor hannah@example.com Manchester, UK Experience Senior Engineer Northwind Labs Mar 2021 – Present " +
  "Cut p95 latency from 840 ms to 210 ms Led migration of 37 services Engineer Bluefin Systems Jan 2018 – Feb 2021 " +
  "Built the billing pipeline Education B.Sc. Computer Science University of Leeds 2017 Skills Go SQL Kubernetes";

const GOOD = {
  usable: true,
  sections: {
    contact: { name: "Hannah Okafor", email: "hannah@example.com", location: "Manchester, UK" },
    experience: [
      { role: "Senior Engineer", company: "Northwind Labs", dates: "Mar 2021 – Present", bullets: ["Cut p95 latency from 840 ms to 210 ms", "Led migration of 37 services"] },
      { role: "Engineer", company: "Bluefin Systems", dates: "Jan 2018 – Feb 2021", bullets: ["Built the billing pipeline"] },
    ],
    education: [{ title: "B.Sc. Computer Science", org: "University of Leeds", year: "2017" }],
    skills: [{ items: ["Go", "SQL", "Kubernetes"] }],
  },
  searchSeed: { currentTitle: "Senior Engineer", skills: ["Go"] },
};

/** A stub model: replies in order, records each request. */
function stub(...replies) {
  const calls = [];
  const request = async (opts) => {
    calls.push(opts);
    const r = replies.shift();
    if (r instanceof Error) throw r;
    const model = opts.tier === "fast" ? "fast-model" : "judgment-model";
    return { data: structuredClone(r), usage: { inputTokens: 100, outputTokens: 50 }, model, turn: { provider: "anthropic", history: [{ role: "user", content: "x" }], callId: `call-${calls.length}` } };
  };
  return { request, calls };
}

const PAGED = { HIRECUTE_PARSE_MODE: "paged" };

test("parseMode defaults to single", () => {
  assert.equal(parseMode({}), "single");
  assert.equal(parseMode({ HIRECUTE_PARSE_MODE: "paged" }), "paged");
  assert.equal(parseMode({ HIRECUTE_PARSE_MODE: "something" }), "single");
});

test("single mode is the original call: one request on the fast tier, reply taken as is", async () => {
  const { request, calls } = stub(GOOD);
  const r = await parseResume(SOURCE, { request, env: {} });
  assert.equal(r.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].tier, "fast");
  assert.equal(calls[0].schemaName, "emit_resume_sections");
  assert.equal(r.resume.contact.name, "Hannah Okafor");
  assert.equal(r.trace.mode, "single");
  assert.equal(r.trace.fallback, null);
});

test("single mode keeps the original weakness: sections as a string read as not a resume", async () => {
  const { request } = stub({ usable: true, sections: JSON.stringify(GOOD.sections) });
  const r = await parseResume(SOURCE, { request, env: {} });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "unusable");
});

test("repairParse unwraps sections returned as a string, including a spilled tail", () => {
  const plain = repairParse({ usable: true, sections: JSON.stringify(GOOD.sections) });
  assert.deepEqual(plain.data.sections, GOOD.sections);
  assert.deepEqual(plain.repairs, ["sections-string"]);

  const spilled = `${JSON.stringify(GOOD.sections)},"searchSeed":{"currentTitle":"Engineer"},"usable":true}`;
  const r = repairParse({ sections: spilled });
  assert.deepEqual(r.data.sections, GOOD.sections);
  assert.equal(r.data.searchSeed.currentTitle, "Engineer");
  assert.equal(r.data.usable, true);
  assert.deepEqual(r.repairs, ["sections-string-spill"]);
});

test("repairParse folds an off-schema section into skills instead of losing it", () => {
  const r = repairParse({ usable: true, sections: { ...GOOD.sections, languages: [{ language: "English", level: "Fluent" }, { language: "Polish", level: "Native" }] } });
  assert.equal(r.data.sections.languages, undefined);
  assert.deepEqual(r.data.sections.skills.at(-1), { category: "Languages", items: ["English — Fluent", "Polish — Native"] });
  assert.deepEqual(r.repairs, ["folded:languages"]);
});

test("repairParse reads a missing usable as usable when sections are present", () => {
  const r = repairParse({ sections: GOOD.sections });
  assert.equal(r.data.usable, true);
  assert.deepEqual(r.repairs, ["usable-missing"]);
});

test("validateParse accepts a good reply and names every wrong field", () => {
  assert.deepEqual(validateParse(GOOD), []);
  const bad = structuredClone(GOOD);
  bad.sections.experience[0].team = "Payments";
  bad.sections.skills = "Go, SQL";
  const errors = validateParse(bad);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /sections\.experience\[0\]\.team is not a field/);
  assert.match(errors[1], /sections\.skills must be an array/);
});

test("correctionTurn answers the tool call with the errors, per provider", () => {
  const a = correctionTurn({ provider: "anthropic", history: [{ role: "user", content: "q" }, { role: "assistant", content: [] }], callId: "t1" }, "fix it");
  assert.deepEqual(a.at(-1), { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", is_error: true, content: "fix it" }] });
  const o = correctionTurn({ provider: "openai", history: [], callId: "c1" }, "fix it");
  assert.deepEqual(o.at(-1), { role: "tool", tool_call_id: "c1", content: "fix it" });
  assert.equal(correctionTurn({ provider: "anthropic", history: [] }, "x"), null);
});

test("paged: a clean fast reply is shown without a fallback", async () => {
  const { request, calls } = stub(GOOD);
  const r = await parseResume(SOURCE, { request, env: PAGED });
  assert.equal(r.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].tier, "fast");
  assert.equal(r.model, "fast-model");
  assert.equal(r.trace.fallback, null);
});

test("paged: a locally repairable reply needs no second call", async () => {
  const { request, calls } = stub({ usable: true, sections: JSON.stringify(GOOD.sections) });
  const r = await parseResume(SOURCE, { request, env: PAGED });
  assert.equal(r.ok, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(r.trace.repairs, ["sections-string"]);
});

test("paged: an invalid reply is corrected once in the same conversation", async () => {
  const bad = structuredClone(GOOD);
  bad.sections.experience[0].team = "Payments";
  const { request, calls } = stub(bad, GOOD);
  const r = await parseResume(SOURCE, { request, env: PAGED });
  assert.equal(r.ok, true);
  assert.equal(calls.length, 2);
  assert.ok(calls[1].history, "the correction carries the conversation");
  assert.equal(calls[1].history.at(-1).content[0].tool_use_id, "call-1");
  assert.match(calls[1].history.at(-1).content[0].content, /team is not a field/);
  assert.equal(r.trace.corrections, 1);
});

test("paged: still invalid after the correction → today's call on the judgment tier", async () => {
  const bad = structuredClone(GOOD);
  bad.sections.experience[0].team = "Payments";
  const { request, calls } = stub(bad, bad, GOOD);
  const r = await parseResume(SOURCE, { request, env: PAGED });
  assert.equal(r.ok, true);
  assert.deepEqual(calls.map((c) => c.tier), ["fast", "fast", "judgment"]);
  assert.equal(calls[2].history, undefined);
  assert.equal(r.model, "judgment-model");
  assert.match(r.trace.fallback[0], /invalid reply/);
  assert.equal(r.usage.outputTokens, 150);
});

test("paged: a fast-tier 'not a resume' is confirmed by the judgment tier", async () => {
  const { request, calls } = stub({ usable: false }, GOOD);
  const r = await parseResume(SOURCE, { request, env: PAGED });
  assert.equal(r.ok, true, "the judgment tier read it as a resume");
  assert.deepEqual(calls.map((c) => c.tier), ["fast", "judgment"]);

  const both = stub({ usable: false }, { usable: false });
  const r2 = await parseResume("Dear hiring manager, I am writing to apply.", { request: both.request, env: PAGED });
  assert.equal(r2.ok, false);
  assert.equal(r2.reason, "unusable");
});

test("paged: a fast-tier failure falls back; a judgment failure is the model error it always was", async () => {
  const { request, calls } = stub(new Error("timeout"), GOOD);
  const r = await parseResume(SOURCE, { request, env: PAGED });
  assert.equal(r.ok, true);
  assert.deepEqual(calls.map((c) => c.tier), ["fast", "judgment"]);

  const down = stub(new Error("timeout"), new Error("down"));
  const r2 = await parseResume(SOURCE, { request: down.request, env: PAGED });
  assert.equal(r2.ok, false);
  assert.equal(r2.reason, "model");
});

test("paged: pages are read separately and merged", async () => {
  const page1 = {
    usable: true,
    sections: { contact: GOOD.sections.contact, experience: [{ ...GOOD.sections.experience[0], bullets: ["Cut p95 latency from 840 ms to 210 ms"] }] },
    searchSeed: { currentTitle: "Senior Engineer", skills: ["Go"] },
  };
  const page2 = {
    usable: true,
    sections: {
      experience: [{ bullets: ["Led migration of 37 services"] }, GOOD.sections.experience[1]],
      education: GOOD.sections.education,
      skills: GOOD.sections.skills,
    },
    searchSeed: { skills: ["Kubernetes"] },
  };
  const { request, calls } = stub(page1, page2);
  const r = await parseResume(SOURCE, { request, env: PAGED, pages: ["page one text", "page two text"] });
  assert.equal(r.ok, true);
  assert.equal(calls.length, 2);
  assert.match(calls[0].user, /RESUME PAGE 1 OF 2/);
  assert.match(calls[1].system, /YOU SEE ONE PAGE/);
  assert.equal(r.resume.experience.length, 2);
  assert.deepEqual(r.resume.experience[0].bullets, GOOD.sections.experience[0].bullets);
  assert.deepEqual(r.searchSeed.skills, ["Go", "Kubernetes"]);
});

test("mergePages keeps the first page's single values and contact", () => {
  const m = mergePages([
    { sections: { contact: { name: "A" }, summary: "first" } },
    { sections: { contact: { name: "B", email: "b@example.com" }, summary: "second" } },
  ]);
  assert.deepEqual(m.sections.contact, { name: "A", email: "b@example.com" });
  assert.equal(m.sections.summary, "first");
});

test("qualityProblems passes a faithful parse and names what is wrong otherwise", () => {
  assert.deepEqual(qualityProblems(SOURCE, GOOD), []);

  const placeholder = structuredClone(GOOD);
  placeholder.sections.experience[0].dates = "<UNKNOWN>";
  assert.match(qualityProblems(SOURCE, placeholder).join(), /placeholder values: <UNKNOWN>/);

  const thin = { usable: true, sections: { contact: GOOD.sections.contact } };
  const problems = qualityProblems(SOURCE, thin);
  assert.ok(problems.some((p) => /covers \d+% of the source/.test(p)));
  assert.ok(problems.includes("no experience although the source has dates"));

  const rewritten = structuredClone(GOOD);
  rewritten.sections.experience[0].bullets = ["Improved performance a lot", "Moved many services", "Did platform work"];
  rewritten.sections.skills = [{ items: ["Golang", "Structured Query Language", "K8s"] }];
  assert.match(qualityProblems(SOURCE, rewritten).join(), /values are not in the source/);
});

test("mergePages joins a continuation marked with placeholders, not only an empty header", () => {
  const m = mergePages([
    { sections: { experience: [{ role: "Engineer", company: "Northwind Labs", dates: "2021 – Present", bullets: ["one"] }] } },
    { sections: { experience: [{ role: "<UNKNOWN>", company: "<UNKNOWN>", location: "<UNKNOWN>", dates: "N/A", bullets: ["two"] }, { role: "Analyst", company: "Bluefin", dates: "2018 – 2021", bullets: ["three"] }] } },
  ]);
  assert.equal(m.sections.experience.length, 2);
  assert.deepEqual(m.sections.experience[0].bullets, ["one", "two"]);
  assert.equal(JSON.stringify(m).includes("UNKNOWN"), false);
});
