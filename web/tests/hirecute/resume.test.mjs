import { test } from "node:test";
import assert from "node:assert/strict";
import "../helpers/web-ts-alias-loader.mjs";

const {
  RESUME_SECTIONS,
  applyRecommendation,
  applyRecommendations,
  isSectionEmpty,
  normalizeResume,
  toCvPayload,
  sectionNodes,
  itemPaths,
  isExcluded,
  toggleExclusion,
  excludeItems,
  acceptedResume,
} = await import("../../src/lib/hirecute/resume.mjs");
const { FEATURES } = await import("../../src/lib/hirecute/limits.mjs");
const { applyEvent, initialRunState, restoreSnapshot } = await import("../../src/lib/hirecute/run-store.ts");
const { projectEvent } = await import("../../src/lib/hirecute/project.ts");

/**
 * The review step: eleven sections in a fixed order, empty ones kept and
 * marked rather than filled, and recommendations that each touch exactly one
 * section.
 */

const RESUME = normalizeResume({
  contact: { name: "Priya Raman", email: "priya@example.com" },
  summary: "Experienced product person who has worked on lots of fintech things.",
  experience: [
    { role: "Senior PM", company: "Northwind", dates: "2019 - Present", bullets: ["built payments stuff", "ran hiring"] },
  ],
  education: [{ title: "BSc Economics", org: "Leeds", year: "2014" }],
  skills: [{ category: "Domain", items: ["Payments"] }],
  interests: ["Chess"],
});

const SUMMARY_REC = {
  id: "rec-1",
  section: "summary",
  kind: "clarity",
  label: "Make it specific",
  explanation: "",
  before: "Experienced product person who has worked on lots of fintech things.",
  after: "Senior product manager in fintech, focused on payments.",
};
const BULLET_REC = {
  id: "rec-2",
  section: "experience",
  kind: "formatting",
  label: "Strong verb",
  explanation: "",
  before: "built payments stuff",
  after: "Built the payments product",
};

test("the eleven sections render in the required order", () => {
  assert.deepEqual(
    RESUME_SECTIONS.map((s) => s.label),
    [
      "Contact Information",
      "Target Title",
      "Professional Summary",
      "Work Experience",
      "Education",
      "Skills & Interests",
      "Certifications",
      "Awards & Scholarships",
      "Projects",
      "Volunteering & Leadership",
      "Publications",
    ],
  );
});

test("absent sections stay empty — never filled with a placeholder", () => {
  const r = normalizeResume({
    contact: { name: "A" },
    targetTitle: "   ",
    experience: [{ role: "", company: "", bullets: ["", "  "] }],
    awards: "not a list",
  });
  for (const key of ["targetTitle", "summary", "experience", "awards", "publications", "volunteering"]) {
    assert.equal(isSectionEmpty(r, key), true, `${key} is empty`);
  }
  assert.equal(isSectionEmpty(r, "contact"), false);
  assert.equal(r.targetTitle, "");
  assert.deepEqual(r.experience, [], "a blank entry is dropped, not kept as an empty card");
});

test("interests alone make Skills & Interests non-empty", () => {
  const r = normalizeResume({ interests: ["Chess"] });
  assert.equal(isSectionEmpty(r, "skills"), false);
});

test("applying one recommendation changes only its own section", () => {
  const next = applyRecommendation(RESUME, BULLET_REC);
  assert.ok(next);
  assert.deepEqual(next.experience[0].bullets, ["Built the payments product", "ran hiring"]);
  for (const key of ["contact", "summary", "education", "skills", "interests"]) {
    assert.deepEqual(next[key], RESUME[key], `${key} untouched`);
  }
  // The original is not mutated.
  assert.equal(RESUME.experience[0].bullets[0], "built payments stuff");
});

test("a recommendation only applies to text that is actually in its section", () => {
  // Right text, wrong section.
  assert.equal(applyRecommendation(RESUME, { ...BULLET_REC, section: "summary" }), null);
  // Text that is not there.
  assert.equal(applyRecommendation(RESUME, { ...BULLET_REC, before: "invented line" }), null);
  // An empty `before` may only fill an EMPTY summary or target title.
  assert.equal(applyRecommendation(RESUME, { ...SUMMARY_REC, before: "" }), null, "summary is not empty");
  assert.equal(applyRecommendation(RESUME, { ...BULLET_REC, before: "" }), null, "no new list entries");
  const titled = applyRecommendation(RESUME, { ...SUMMARY_REC, section: "targetTitle", before: "", after: "Senior PM" });
  assert.equal(titled.targetTitle, "Senior PM");
});

test("applied recommendations compose, and undo is the same computation without one", () => {
  const both = applyRecommendations(RESUME, [SUMMARY_REC, BULLET_REC], ["rec-1", "rec-2"]);
  assert.equal(both.summary, SUMMARY_REC.after);
  assert.equal(both.experience[0].bullets[0], BULLET_REC.after);

  const undone = applyRecommendations(RESUME, [SUMMARY_REC, BULLET_REC], ["rec-2"]);
  assert.equal(undone.summary, RESUME.summary);
  assert.equal(undone.experience[0].bullets[0], BULLET_REC.after);

  // An unknown or no-longer-applicable id is skipped, not forced.
  const clash = { ...BULLET_REC, id: "rec-3", after: "Something else" };
  const skipped = applyRecommendations(RESUME, [BULLET_REC, clash], ["rec-2", "rec-3", "nope"]);
  assert.equal(skipped.experience[0].bullets[0], BULLET_REC.after);
});

test("toCvPayload speaks build-cv-html's vocabulary", () => {
  const payload = toCvPayload(
    normalizeResume({
      ...RESUME,
      contact: { name: "Priya", links: [{ url: "https://linkedin.com/in/priya" }, { url: "https://priya.dev" }] },
      awards: [{ title: "Dean's List", year: "2013", description: "Top 5%" }],
      volunteering: [{ role: "Mentor", org: "Code Club" }],
    }),
  );
  assert.equal(payload.candidate.name, "Priya");
  assert.equal(payload.candidate.linkedin.url, "https://linkedin.com/in/priya");
  assert.equal(payload.candidate.portfolio.url, "https://priya.dev");
  assert.deepEqual(payload.awards, [{ title: "Dean's List", year: "2013" }]);
  assert.equal(payload.volunteering, undefined, "no builder block: review-only");
});

test("PDF generation is disabled for the MVP flow", () => {
  assert.equal(FEATURES.pdfGeneration, false);
});

test("resume.parsed and resume.accepted reach the browser state and the snapshot", () => {
  const event = (seq, type, payload) => ({ version: 1, runId: "r", seq, time: "t", input: {}, type, payload });
  let state = applyEvent(initialRunState(), event(1, "resume.parsed", { resume: RESUME }));
  assert.deepEqual(state.parsedResume, RESUME);

  const acceptance = { appliedRecommendationIds: ["rec-1"], acceptedAt: "t" };
  state = applyEvent(state, event(2, "resume.accepted", { acceptance }));
  assert.deepEqual(state.resumeAcceptance, acceptance);
  // A second accept cannot rewrite the first: CVs may already use it.
  state = applyEvent(state, event(3, "resume.accepted", { acceptance: { appliedRecommendationIds: [], acceptedAt: "u" } }));
  assert.deepEqual(state.resumeAcceptance, acceptance);

  const snapshot = projectEvent(
    projectEvent({ status: "running" }, { type: "resume.parsed", payload: { resume: RESUME } }),
    { type: "resume.accepted", payload: { acceptance } },
  );
  assert.deepEqual(snapshot.parsedResume, RESUME);
  assert.deepEqual(snapshot.resumeAcceptance, acceptance);
});

test("a refresh restores the acceptance, so the review step does not ask again", () => {
  const snapshot = {
    status: "running",
    lastSequence: 9,
    currentStage: "explore",
    stages: { refine: null, explore: null, match: null, prepare: null },
    jobs: [],
    assessments: [],
    applications: [],
    selection: { jobIds: [], version: 1 },
    billing: null,
    parsedResume: RESUME,
    resumeAcceptance: { appliedRecommendationIds: ["rec-2"], acceptedAt: "t" },
  };
  const state = restoreSnapshot(snapshot);
  assert.deepEqual(state.resumeAcceptance.appliedRecommendationIds, ["rec-2"]);
  assert.deepEqual(state.parsedResume, RESUME);
});

test("each section's content is a tree whose paths point at real items", () => {
  const exp = sectionNodes(RESUME, "experience");
  assert.equal(exp[0].path, "experience.0");
  assert.equal(exp[0].text, "Senior PM · Northwind");
  assert.deepEqual(exp[0].children.map((c) => [c.path, c.text]), [
    ["experience.0.bullets.0", "built payments stuff"],
    ["experience.0.bullets.1", "ran hiring"],
  ]);
  const skills = sectionNodes(RESUME, "skills");
  assert.deepEqual(skills.map((n) => n.path), ["skills.0", "interests"]);
  assert.deepEqual(sectionNodes(RESUME, "publications"), [], "an empty section has no items");
  assert.ok(itemPaths(RESUME).includes("contact.email"));
});

test("unchecking a parent greys its children; re-checking restores it whole", () => {
  let ex = toggleExclusion([], "experience.0.bullets.1");
  assert.equal(isExcluded(ex, "experience.0.bullets.1"), true);
  assert.equal(isExcluded(ex, "experience.0.bullets.0"), false);

  ex = toggleExclusion(ex, "experience.0");
  assert.deepEqual(ex, ["experience.0"], "parent replaces its children's state");
  assert.equal(isExcluded(ex, "experience.0.bullets.0"), true, "children follow the parent");

  ex = toggleExclusion(ex, "experience.0");
  assert.deepEqual(ex, [], "re-checked parent comes back whole");
  // A prefix that is not a path segment does not count.
  assert.equal(isExcluded(["experience.1"], "experience.10"), false);
});

test("unchecked items are left out of the accepted resume, nothing else is", () => {
  const out = excludeItems(RESUME, ["experience.0.bullets.0", "interests", "summary", "contact.email"]);
  assert.deepEqual(out.experience[0].bullets, ["ran hiring"]);
  assert.deepEqual(out.interests, []);
  assert.equal(out.summary, "");
  assert.equal(out.contact.email, undefined);
  assert.equal(out.contact.name, "Priya Raman");
  assert.deepEqual(out.education, RESUME.education);

  const whole = excludeItems(RESUME, ["experience.0"]);
  assert.deepEqual(whole.experience, []);
});

test("the accepted resume = applied recommendations minus unchecked items", () => {
  const out = acceptedResume(RESUME, [SUMMARY_REC, BULLET_REC], {
    appliedRecommendationIds: ["rec-2"],
    excludedItems: ["experience.0.bullets.1"],
  });
  assert.deepEqual(out.experience[0].bullets, ["Built the payments product"]);
  assert.equal(out.summary, RESUME.summary, "an unapplied recommendation stays out");
  // No acceptance yet: the resume exactly as read.
  assert.deepEqual(acceptedResume(RESUME, [SUMMARY_REC], null), RESUME);
});

test("explore.progress carries the provisional ranking to the browser and the snapshot", () => {
  const event = (seq, type, payload) => ({ version: 1, runId: "r", seq, time: "t", input: {}, type, payload });
  const progress = { jobIds: ["job-b", "job-a"], boardsDone: 3, boardsTotal: 43 };
  const state = applyEvent(initialRunState(), event(1, "explore.progress", progress));
  assert.deepEqual(state.exploreProgress, progress);
  const snap = projectEvent({ status: "running" }, { type: "explore.progress", payload: progress });
  assert.deepEqual(snap.exploreProgress, progress);
});

test("resume.progress carries page-by-page reading to the browser and the snapshot", () => {
  const event = (seq, type, payload) => ({ version: 1, runId: "r", seq, time: "t", input: {}, type, payload });
  const progress = { pagesDone: 1, pagesTotal: 3 };
  const state = applyEvent(initialRunState(), event(1, "resume.progress", progress));
  assert.deepEqual(state.resumeProgress, progress);
  const snap = projectEvent({ status: "running" }, { type: "resume.progress", payload: progress });
  assert.deepEqual(snap.resumeProgress, progress);
});

test("explore.boards carries board progress to the browser and the snapshot", () => {
  const event = (seq, type, payload) => ({ version: 1, runId: "r", seq, time: "t", input: {}, type, payload });
  const progress = { boardsDone: 5, boardsTotal: 43, providers: { greenhouse: { done: 3, total: 21 } } };
  const state = applyEvent(initialRunState(), event(1, "explore.boards", progress));
  assert.deepEqual(state.boardProgress, progress);
  const snap = projectEvent({ status: "running" }, { type: "explore.boards", payload: progress });
  assert.deepEqual(snap.boardProgress, progress);
});

test("match.progress carries scoring progress to the browser and the snapshot", () => {
  const event = (seq, type, payload) => ({ version: 1, runId: "r", seq, time: "t", input: {}, type, payload });
  const progress = { jobsDone: 3, jobsTotal: 10 };
  const state = applyEvent(initialRunState(), event(1, "match.progress", progress));
  assert.deepEqual(state.matchProgress, progress);
  const snap = projectEvent({ status: "running" }, { type: "match.progress", payload: progress });
  assert.deepEqual(snap.matchProgress, progress);
});
