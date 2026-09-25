import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import "../helpers/web-ts-alias-loader.mjs";

const CODE_ROOT = path.resolve(process.cwd(), "..");

const { PACKAGE_SCHEMA, letterSystem, packageUser } = await import(
  "../../src/lib/hirecute/prompts.mjs"
);
const {
  emptyLetter,
  letterStarted,
  letterDelta,
  letterCompleted,
  editLetter,
  displayText,
} = await import("../../src/lib/hirecute/letters.ts");

/**
 * Milestone 6 evidence.
 *
 * §7's acceptance checks plus the brief's package rules. The safety property
 * worth the most here is structural: the tailored CV is the SAME payload stage
 * 1 validated, reordered — so the builder can never receive a sentence the
 * model invented, regardless of what the model returns.
 */

// ── The tailoring contract ───────────────────────────────────────────────

test("emphasisOrder is a reordering instruction, not new content", () => {
  const d = PACKAGE_SCHEMA.properties.emphasisOrder.description;
  assert.match(d, /VERBATIM/);
  assert.match(d, /do not reword, merge or add any/i);
});

test("the package schema has no field that could carry invented CV bullets", () => {
  // A `bullets` or `experience` field would let the model write CV content
  // directly. Only the summary is generated, and it is fact-checked.
  for (const forbidden of ["bullets", "experience", "skills", "education", "payload"]) {
    assert.equal(
      PACKAGE_SCHEMA.properties[forbidden],
      undefined,
      `${forbidden} must not be model-writable`,
    );
  }
  assert.ok(PACKAGE_SCHEMA.properties.summary, "the summary is the one generated line");
});

test("only the letter and subject are required", () => {
  assert.deepEqual(PACKAGE_SCHEMA.required, ["subject", "letter"]);
});

test("the letter field forbids placeholders", () => {
  assert.match(PACKAGE_SCHEMA.properties.letter.description, /No markdown, no placeholders/);
});

// ── The composed letter prompt ───────────────────────────────────────────

test("the letter uses conversational register, unlike the CV", async () => {
  // modes/_writing.md's two-tier rule cuts the other way for letters: Tier 2
  // applies to cover letters and must NOT apply to CV bullets.
  const system = await letterSystem(CODE_ROOT);
  assert.match(system, /Tier 2/);
  assert.match(system, /First person and contractions are fine/);
  assert.match(system, /not a CV bullet/);
});

test("the letter must lead with value, never with 'I am looking for a job'", async () => {
  const system = await letterSystem(CODE_ROOT);
  assert.match(system, /Value proposition FIRST/);
  assert.match(system, /Never open with "I am looking for a job"/);
});

test("exactly two proof points, tied to the company or domain", async () => {
  const system = await letterSystem(CODE_ROOT);
  assert.match(system, /Exactly 2 proof points/);
});

test("the prompt forbids claiming the letter was sent or a CV attached", async () => {
  const system = await letterSystem(CODE_ROOT);
  assert.match(system, /Never\s+state or imply that it has been sent/i);
  assert.match(system, /that a CV is attached/);
  assert.match(system, /Do not invent a recipient name/);
});

test("the prompt carries the factual standard, so a letter cannot invent a metric", async () => {
  const system = await letterSystem(CODE_ROOT);
  assert.match(system, /FACTUAL RULES/);
  assert.match(system, /NEVER invent/);
});

test("no recipient is invented, and known gaps are not argued away", () => {
  const user = packageUser({
    resumeFacts: "facts",
    job: { title: "PM", company: "Monzo", location: "London" },
    jobDescription: "jd",
    assessment: { strengths: ["payments depth"], gaps: ["no ledger experience"] },
  });
  assert.match(user, /RECIPIENT: unknown/);
  assert.match(user, /Do NOT invent a name/);
  // Gaps are supplied so the letter avoids overclaiming, not so it rebuts them.
  assert.match(user, /do NOT claim these away/);
  assert.match(user, /no ledger experience/);
});

// ── Letter isolation under real streaming ────────────────────────────────

test("a validated letter is revealed in chunks that reassemble exactly", () => {
  const full =
    "Payments infrastructure is unglamorous until it breaks.\n\nAt Starling Bank, I cut settlement failures by 34%.";
  let map = letterStarted({}, "job-a", "gen-1");
  for (const chunk of full.match(/[\s\S]{1,20}/g)) {
    map = letterDelta(map, "job-a", "gen-1", chunk);
  }
  assert.equal(map["job-a"].receivedText, full, "chunking must be lossless");
});

test("a delta for job A never lands in job B", () => {
  let map = letterStarted(letterStarted({}, "job-a", "gen-a"), "job-b", "gen-b");
  map = letterDelta(map, "job-a", "gen-a", "letter for A");
  map = letterDelta(map, "job-b", "gen-b", "letter for B");
  assert.equal(map["job-a"].receivedText, "letter for A");
  assert.equal(map["job-b"].receivedText, "letter for B");
});

test("two roles at ONE employer keep separate drafts", () => {
  let map = letterStarted(letterStarted({}, "job-monzo-1", "g1"), "job-monzo-2", "g2");
  map = letterDelta(map, "job-monzo-1", "g1", "payments letter");
  map = letterDelta(map, "job-monzo-2", "g2", "lending letter");
  assert.notEqual(map["job-monzo-1"].receivedText, map["job-monzo-2"].receivedText);
});

test("a candidate edit survives the generation completing with different text", () => {
  let map = letterStarted({}, "job-a", "gen-1");
  map = letterDelta(map, "job-a", "gen-1", "model text");
  map = editLetter(map, "job-a", "my own words");
  map = letterCompleted(map, "job-a", "gen-1", {
    version: 1,
    author: "model",
    text: "model text, finished",
    subject: "s",
    updatedAt: "t",
    contentHash: "h",
    sourceFactIds: [],
    jobContentHash: "j",
  });
  assert.equal(displayText(map["job-a"]), "my own words", "the candidate's version wins");
  assert.equal(map["job-a"].dirty, true);
});

test("a stale generation's delta cannot append to a newer one", () => {
  let map = letterStarted({}, "job-a", "gen-1");
  map = letterDelta(map, "job-a", "gen-1", "first");
  // A regeneration supersedes gen-1.
  map = letterStarted(map, "job-a", "gen-2");
  map = letterDelta(map, "job-a", "gen-1", " STALE");
  assert.equal(map["job-a"].receivedText, "", "gen-1 chunks are dropped after gen-2 starts");
  map = letterDelta(map, "job-a", "gen-2", "second");
  assert.equal(map["job-a"].receivedText, "second");
});

test("an empty letter map yields empty text rather than undefined", () => {
  assert.equal(displayText(undefined), "");
  assert.equal(displayText(emptyLetter("job-a")), "");
});
