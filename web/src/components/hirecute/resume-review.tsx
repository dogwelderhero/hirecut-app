"use client";

/**
 * The review step's resume, built for reviewing an agent's work.
 *
 * Layout:
 *  - A header that answers "how far along am I?": applied count, a segmented
 *    meter (one segment per suggestion), Apply all / Undo all, and a "Next"
 *    button that jumps to the next suggestion still waiting.
 *  - The resume itself reads like a document. Sections are blocks; their
 *    content stays a checkbox tree (unchecking leaves an item out).
 *  - Each suggestion sits INLINE, under the exact line it changes: the target
 *    text is underlined, the card shows a word-level diff, the reason, and
 *    Apply / Skip. Applied, the line shows the new words highlighted and a
 *    one-line "Applied · Undo" receipt.
 *  - Every section keeps its place. An empty one stays in the structure,
 *    collapsed, with a "!" mark; it is never filled in.
 *
 * Rules held from the previous version:
 *  - The text shown is ALWAYS `applyRecommendations(resume, applied)` over the
 *    resume as read, so applying and undoing are the same computation.
 *  - Unchecking an item greys it (and everything under it) out; tree paths
 *    come from `sectionNodes`, the same function the worker's `excludeItems`
 *    relies on.
 *  - `resume === null` renders the same panel with every section loading, so
 *    extraction finishing updates this block in place.
 */

import { Fragment, useEffect, useRef, useState } from "react";
import {
  RESUME_SECTIONS,
  applyRecommendation,
  applyRecommendations,
  isExcluded,
  isSectionEmpty,
  sectionNodes,
  type ResumeDocument,
  type ResumeNode,
  type ResumeRecommendation,
  type ResumeSectionKey,
} from "@/lib/hirecute/resume.mjs";
import type { ResumeGap } from "@/lib/hirecute/contracts";
import { useReducedMotion } from "./workspace/common";

const KIND_LABEL: Record<ResumeRecommendation["kind"], string> = {
  clarity: "Clarity",
  structure: "Structure",
  formatting: "Formatting",
  relevance: "Relevance",
};

/* ── Word diff ─────────────────────────────────────────────────────────── */

type DiffPart = { kind: "same" | "del" | "ins"; text: string };

/** Word-level LCS diff; inputs are one resume line, so O(n·m) is fine. */
function wordDiff(before: string, after: string): DiffPart[] {
  const a = before.split(/(\s+)/).filter(Boolean);
  const b = after.split(/(\s+)/).filter(Boolean);
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffPart[] = [];
  const push = (kind: DiffPart["kind"], text: string) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push("same", a[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) push("del", a[i++]);
    else push("ins", b[j++]);
  }
  while (i < a.length) push("del", a[i++]);
  while (j < b.length) push("ins", b[j++]);
  return out;
}

/**
 * Small edits read best inline (struck words beside new ones). A rewrite does
 * not: word-by-word it interleaves into noise, so it shows as old line → new
 * line instead.
 */
export function Diff({ before, after }: { before: string; after: string }) {
  if (!before) {
    return (
      <p className="hc-rz-diff">
        <ins>{after}</ins>
      </p>
    );
  }
  const parts = wordDiff(before, after);
  const words = (t: string) => t.split(/\s+/).filter(Boolean).length;
  const kept = parts.filter((p) => p.kind === "same").reduce((n, p) => n + words(p.text), 0);
  const changes = parts.filter((p) => p.kind !== "same").length;
  if (kept / Math.max(words(before), words(after)) < 0.5 || changes > 4) {
    return (
      <div className="hc-rz-diff is-block">
        <del>{before}</del>
        <ins>{after}</ins>
      </div>
    );
  }
  return (
    <p className="hc-rz-diff">
      {parts.map((part, i) =>
        part.kind === "same" ? (
          <span key={i}>{part.text}</span>
        ) : part.kind === "del" ? (
          <del key={i}>{part.text}</del>
        ) : (
          <ins key={i}>{part.text}</ins>
        ),
      )}
    </p>
  );
}

/* ── Placing suggestions on lines ──────────────────────────────────────── */

type Placement = { rec: ResumeRecommendation; field: "text" | "meta" };

function flatten(nodes: ResumeNode[]): ResumeNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children ?? [])]);
}

/**
 * Pin each suggestion to the first line containing its text: `before` while it
 * is waiting, `after` once applied. One that matches no line (e.g. filling an
 * empty summary) stays at section level.
 */
function placeRecs(
  nodes: ResumeNode[],
  recs: ResumeRecommendation[],
  applied: Set<string>,
): { byPath: Map<string, Placement[]>; sectionLevel: ResumeRecommendation[] } {
  const flat = flatten(nodes);
  const byPath = new Map<string, Placement[]>();
  const sectionLevel: ResumeRecommendation[] = [];
  for (const rec of recs) {
    const target = applied.has(rec.id) ? rec.after.trim() : rec.before;
    let placed = false;
    if (target) {
      for (const node of flat) {
        const field = node.text.includes(target) ? "text" : node.meta?.includes(target) ? "meta" : null;
        if (field) {
          byPath.set(node.path, [...(byPath.get(node.path) ?? []), { rec, field }]);
          placed = true;
          break;
        }
      }
    }
    if (!placed) sectionLevel.push(rec);
  }
  return { byPath, sectionLevel };
}

/** Mark the waiting targets (underlined) and the applied text (highlighted) in one line. */
function markLine(text: string, marks: Array<{ needle: string; kind: "target" | "applied"; id: string }>) {
  let parts: Array<string | React.ReactElement> = [text];
  for (const m of marks) {
    if (!m.needle) continue;
    parts = parts.flatMap((p) => {
      if (typeof p !== "string") return [p];
      const at = p.indexOf(m.needle);
      if (at < 0) return [p];
      return [
        p.slice(0, at),
        <mark key={m.id} className={m.kind === "applied" ? "hc-rz-applied-text" : "hc-rz-target"}>
          {m.needle}
        </mark>,
        p.slice(at + m.needle.length),
      ];
    });
  }
  return parts.map((p, i) => <Fragment key={i}>{p}</Fragment>);
}

/* ── Component ─────────────────────────────────────────────────────────── */

/** Pause between two sections filling in on step 1. 12 sections ≈ 1.3 s, inside the result's dwell. */
const FILL_STEP_MS = 110;

export function ResumeReview({
  resume,
  recommendations,
  recommendationsAvailable,
  appliedIds,
  excludedItems,
  locked,
  onToggleRecommendation,
  onToggleItem,
  gaps = [],
  phase = "review",
  skippedIds,
  onSkip,
  hideApplyAll = false,
}: {
  /**
   * The resume as read, or null while it is still being read. Null renders the
   * SAME panel and sections, each loading, so extraction finishing updates
   * this block in place instead of replacing it.
   */
  resume: ResumeDocument | null;
  /** Null while the agent is still preparing them. */
  recommendations: ResumeRecommendation[] | null;
  recommendationsAvailable: boolean;
  appliedIds: string[];
  excludedItems: string[];
  /** True once accepted: the resume is fixed and every control is inert. */
  locked: boolean;
  onToggleRecommendation: (id: string) => void;
  onToggleItem: (path: string) => void;
  /** Gaps from the job matching; a suggestion that answers one shows its evidence. */
  gaps?: ResumeGap[];
  /** "read": step 1, the resume as read, no suggestions yet. "review": step 3. */
  phase?: "read" | "review";
  /** Controlled skips, when the parent needs them (step 3 moves on once all are decided). */
  skippedIds?: string[];
  onSkip?: (id: string, skipped: boolean) => void;
  /** Step 3's side panel owns "Apply all"; don't show it twice. */
  hideApplyAll?: boolean;
}) {
  /** Sections the visitor flipped from their default (content open, empty closed). */
  const [flipped, setFlipped] = useState<Set<ResumeSectionKey>>(() => new Set());
  const [localSkipped, setLocalSkipped] = useState<Set<string>>(() => new Set());
  const skipped = skippedIds ? new Set(skippedIds) : localSkipped;
  const paperRef = useRef<HTMLElement>(null);

  const loading = resume === null;
  const reading = phase === "read";

  // Step 1: when the read lands, its sections fill in one after another
  // instead of all swapping at once. A resume that is already read when this
  // mounts (a refresh) shows filled straight away.
  const reducedMotion = useReducedMotion();
  const [filled, setFilled] = useState(() => (resume ? RESUME_SECTIONS.length : 0));
  useEffect(() => {
    if (!reading) return;
    if (loading) {
      setFilled(0);
      return;
    }
    if (filled >= RESUME_SECTIONS.length) return;
    if (reducedMotion) {
      setFilled(RESUME_SECTIONS.length);
      return;
    }
    const id = setTimeout(() => setFilled((n) => n + 1), FILL_STEP_MS);
    return () => clearTimeout(id);
  }, [reading, loading, filled, reducedMotion]);
  const filledCount = reading ? filled : RESUME_SECTIONS.length;
  const gapById = new Map(gaps.map((g) => [g.id, g]));
  const recs = recommendations ?? [];
  const shown = resume ? applyRecommendations(resume, recs, appliedIds) : null;
  const applied = new Set(appliedIds);
  const excluded = new Set(excludedItems);

  /** Applicable now: applied already, or its text is still there to replace. */
  const applicable = (rec: ResumeRecommendation) =>
    applied.has(rec.id) || (shown !== null && applyRecommendation(shown, rec) !== null);
  const waiting = recs.filter((r) => !applied.has(r.id) && !skipped.has(r.id) && applicable(r));
  const appliedCount = recs.filter((r) => applied.has(r.id)).length;

  const toggleSection = (key: ResumeSectionKey) =>
    setFlipped((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const skip = (id: string, on: boolean) => {
    if (onSkip) return onSkip(id, on);
    setLocalSkipped((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const jumpToNext = () => {
    const card = paperRef.current?.querySelector<HTMLElement>(".hc-rz-card.is-waiting");
    if (!card) return;
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.classList.remove("is-flash");
    void card.offsetWidth;
    card.classList.add("is-flash");
  };

  /* One suggestion: a full card while waiting, a one-line receipt otherwise. */
  const renderRec = (rec: ResumeRecommendation) => {
    const isApplied = applied.has(rec.id);
    const isSkipped = skipped.has(rec.id);
    const canApply = applicable(rec);

    if (isApplied) {
      return (
        <div key={rec.id} className="hc-rz-receipt is-applied">
          <span className="hc-rz-receipt-icon" aria-hidden="true">
            ✓
          </span>
          <span>{rec.label}</span>
          {!locked && (
            <button type="button" onClick={() => onToggleRecommendation(rec.id)}>
              Undo
            </button>
          )}
        </div>
      );
    }
    if (isSkipped || !canApply) {
      return (
        <div key={rec.id} className="hc-rz-receipt">
          <span className="hc-rz-receipt-icon" aria-hidden="true">
            –
          </span>
          <span>
            {rec.label} · {canApply ? "skipped" : "no longer applies"}
          </span>
          {canApply && !locked && (
            <button type="button" onClick={() => skip(rec.id, false)}>
              Review
            </button>
          )}
        </div>
      );
    }
    return (
      <div key={rec.id} className="hc-rz-card is-waiting">
        <div className="hc-rz-card-head">
          <strong>{rec.label}</strong>
          <span className="hc-label">{KIND_LABEL[rec.kind]}</span>
        </div>
        <Diff before={rec.before} after={rec.after} />
        <p className="hc-rz-why">{rec.explanation}</p>
        {(rec.gapIds ?? []).map((gid) => {
          const gap = gapById.get(gid);
          if (!gap) return null;
          const first = gap.jobs[0];
          return (
            <div key={gid} className="hc-rz-evidence">
              <span className="hc-label">
                Answers “{gap.requirement}” · asked by {gap.jobs.length} job{gap.jobs.length === 1 ? "" : "s"}
              </span>
              {first && (
                <p>
                  <span>{first.company || "Job"}</span>“{first.jobQuote}”
                </p>
              )}
            </div>
          );
        })}
        {!locked && (
          <div className="hc-rz-card-actions">
            <button type="button" className="hc-button hc-rz-btn" onClick={() => onToggleRecommendation(rec.id)}>
              Apply
            </button>
            <button type="button" className="hc-button hc-button--quiet hc-rz-btn" onClick={() => skip(rec.id, true)}>
              Skip
            </button>
          </div>
        )}
      </div>
    );
  };

  /* The tree: a gutter checkbox per item, guides for nesting, suggestions inline. */
  const renderNodes = (nodes: ResumeNode[], byPath: Map<string, Placement[]>, depth: number) => (
    <ul className={`hc-rz-tree depth-${Math.min(depth, 2)}`}>
      {nodes.map((node) => {
        const off = isExcluded(excluded, node.path);
        const parentOff = !excluded.has(node.path) && off;
        const placements = byPath.get(node.path) ?? [];
        const marksFor = (field: "text" | "meta") =>
          placements
            .filter((p) => p.field === field && !skipped.has(p.rec.id))
            .map((p) =>
              applied.has(p.rec.id)
                ? { needle: p.rec.after.trim(), kind: "applied" as const, id: p.rec.id }
                : { needle: p.rec.before, kind: "target" as const, id: p.rec.id },
            );
        const isHeading = Boolean(node.children);
        return (
          <li key={node.path} className={`${off ? "is-off" : ""}${placements.length ? " has-recs" : ""}`}>
            <div className="hc-rz-line">
              <input
                type="checkbox"
                className="hc-rz-check"
                aria-label={off ? `Include: ${node.text}` : `Leave out: ${node.text}`}
                checked={!off}
                disabled={locked || parentOff}
                ref={(el) => {
                  if (!el) return;
                  const all = flatten(node.children ?? []).map((c) => c.path);
                  el.indeterminate = !off && all.some((p) => excluded.has(p));
                }}
                onChange={() => onToggleItem(node.path)}
              />
              <div className="hc-rz-line-body">
                <div className={isHeading ? "hc-rz-heading" : "hc-rz-text"}>{markLine(node.text, marksFor("text"))}</div>
                {node.meta && <div className="hc-rz-meta">{markLine(node.meta, marksFor("meta"))}</div>}
                {placements.length > 0 && !off && (
                  <div className="hc-rz-recs">{placements.map((p) => renderRec(p.rec))}</div>
                )}
              </div>
            </div>
            {node.children && node.children.length > 0 && renderNodes(node.children, byPath, depth + 1)}
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className={`hc-panel hc-rz${loading ? " is-loading" : ""}`} aria-busy={loading}>
      <header className="hc-panel-head hc-rz-head">
        <div className="hc-rz-head-row">
          <span className="hc-label">YOUR RESUME</span>
          {reading && !loading ? (
            <span className="hc-tag hc-rz-status">
              <strong>✓</strong>&nbsp;Read · {RESUME_SECTIONS.slice(0, filledCount).filter((x) => shown && !isSectionEmpty(shown, x.key)).length} sections found
            </span>
          ) : loading || recommendations === null ? (
            <span className="hc-tag hc-rz-status">
              <i className="hc-rz-pulse" aria-hidden="true" />
              {loading ? "Reading your resume…" : "Your agent is finding improvements…"}
            </span>
          ) : recs.length > 0 ? (
            <span className="hc-tag hc-rz-status">
              <strong>{appliedCount}</strong>&nbsp;of {recs.length} improvement{recs.length === 1 ? "" : "s"} applied
            </span>
          ) : (
            <span className="hc-tag hc-rz-status">No changes suggested</span>
          )}
        </div>
        {!loading && !reading && recs.length > 0 && (
          <>
            <div className="hc-rz-meter" aria-hidden="true">
              {recs.map((r) => (
                <i
                  key={r.id}
                  className={applied.has(r.id) ? "is-applied" : skipped.has(r.id) || !applicable(r) ? "is-skipped" : ""}
                />
              ))}
            </div>
            {!locked && (
              <div className="hc-rz-toolbar">
                {waiting.length > 0 && !hideApplyAll && (
                  <button
                    type="button"
                    className="hc-pill hc-rz-tool is-primary"
                    onClick={() => waiting.forEach((r) => onToggleRecommendation(r.id))}
                  >
                    Apply all {waiting.length}
                  </button>
                )}
                {waiting.length > 0 && (
                  <button type="button" className="hc-pill hc-rz-tool" onClick={jumpToNext}>
                    Next suggestion ↓
                  </button>
                )}
                {appliedCount > 0 && (
                  <button
                    type="button"
                    className="hc-pill hc-rz-tool"
                    onClick={() => recs.filter((r) => applied.has(r.id)).forEach((r) => onToggleRecommendation(r.id))}
                  >
                    Undo all
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </header>

      <article className="hc-doc hc-rz-paper" ref={paperRef}>
        {recommendations !== null && !recommendationsAvailable && (
          <p className="hc-rz-note">We could not prepare suggestions this time. Your resume is shown as it is.</p>
        )}

        {RESUME_SECTIONS.map(({ key, label }, index) => {
          if (loading || !shown || index >= filledCount) {
            return (
              <section
                key={key}
                // Queued: read, waiting for its turn to fill — no longer "walking".
                className={`hc-rz-section is-skeleton${loading ? "" : " is-queued"}`}
                style={{ "--i": index, "--n": RESUME_SECTIONS.length } as React.CSSProperties}
              >
                <div className="hc-rz-shead">
                  <h4>{label}</h4>
                  <span className="hc-rz-skel" aria-hidden="true" />
                </div>
              </section>
            );
          }

          const nodes = sectionNodes(shown, key);
          const sectionRecs = recs.filter((r) => r.section === key);
          const empty = isSectionEmpty(shown, key);

          const { byPath, sectionLevel } = placeRecs(nodes, sectionRecs, applied);
          const pending = sectionRecs.filter((r) => !applied.has(r.id) && !skipped.has(r.id) && applicable(r)).length;
          const done = sectionRecs.filter((r) => applied.has(r.id)).length;
          // Step 1 maps the structure only: every block closed, with its count.
          // The resume itself is shown first in step 3, with the changes.
          const openByDefault = !reading && (!empty || sectionRecs.length > 0);
          const isOpen = flipped.has(key) ? !openByDefault : openByDefault;
          const total = flatten(nodes).filter((n) => !n.children).length || nodes.length;
          return (
            <section
              key={key}
              className={`hc-rz-section${empty ? " is-empty" : ""}${reading ? " is-filled" : ""}`}
              aria-label={label}
            >
              <button
                type="button"
                className="hc-rz-shead"
                aria-expanded={isOpen}
                onClick={() => toggleSection(key)}
              >
                <span className="hc-rz-chevron" aria-hidden="true">
                  {isOpen ? "▾" : "▸"}
                </span>
                <h4>{label}</h4>
                {empty && (
                  <span className="hc-rz-empty-mark" role="img" aria-label="Not found in your resume" title="Not found in your resume">
                    !
                  </span>
                )}
                {!empty && (
                  <span className="hc-rz-scount">
                    {total} item{total === 1 ? "" : "s"}
                  </span>
                )}
                <span className="hc-rz-sbadges">
                  {pending > 0 && (
                    <span className="hc-rz-badge is-pending">
                      {pending} suggestion{pending === 1 ? "" : "s"}
                    </span>
                  )}
                  {done > 0 && <span className="hc-rz-badge is-done">✓ {done}</span>}
                </span>
              </button>
              {isOpen && (
                <div className="hc-rz-sbody">
                  {empty && <p className="hc-rz-missing">Not found in your resume.</p>}
                  {sectionLevel.length > 0 && <div className="hc-rz-recs">{sectionLevel.map(renderRec)}</div>}
                  {nodes.length > 0 && renderNodes(nodes, byPath, 0)}
                </div>
              )}
            </section>
          );
        })}

      </article>
    </div>
  );
}
