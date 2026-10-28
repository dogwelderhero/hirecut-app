"use client";

/**
 * The vacancy journey's working-state visuals, ported verbatim from production
 * (01083211 workspace.tsx): each working screen brings its own visual and lead
 * copy (03 scans a document, 05 shows the query, 07 counts roles) around a
 * shared checklist and indeterminate progress bar.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { BoardProgress, MatchProgress, SearchPreferences } from "@/lib/hirecute/contracts";
import { useReducedMotion } from "../common";
import { CURATED_BOARDS } from "@/lib/hirecute/boards.mjs";

/**
 * The reference's working panel: `div.hc-panel` > `div.hc-loading-layout` >
 * `div.hc-loading-visual` + `div.hc-loading-copy`, then `div.hc-stage-footer`.
 *
 * Each stage brings its own visual and its own lead copy (the reference screens
 * differ: 03 scans a document, 05 shows the query, 07 counts roles), so both
 * sides are slots. The checklist and the progress bar are shared.
 */
export function WorkingPanel({
  visual,
  title,
  lead,
  actions,
  footer,
  aside,
  tag,
  meta,
}: {
  visual: React.ReactNode;
  title: string;
  lead: string;
  actions: { label: string; status: string }[];
  footer: string;
  /** Replaces the checklist when a stage shows per-source rows instead. */
  aside?: React.ReactNode;
  /** The reference's file-name chip above the copy heading (screen 03). */
  tag?: string;
  /** The reference's `Step N of 4 / …starts automatically` row (screen 03 only). */
  meta?: [string, string];
}) {
  return (
    <>
      <div className="hc-panel">
        <div className="hc-loading-layout">
          <div className="hc-loading-visual">{visual}</div>
          <div className="hc-loading-copy">
            {tag && <span className="hc-tag">{tag}</span>}
            <h2 className={tag ? "hc-space-top" : undefined}>{title}</h2>
            <p>{lead}</p>
            {aside ?? (
              <div className="hc-checklist">
                {actions.map((a) => (
                  <div key={a.label}>
                    <span
                      className={a.status === "pending" ? "hc-muted" : "hc-green"}
                      aria-hidden
                    >
                      {a.status === "completed" ? "✓" : a.status === "in_progress" ? "●" : "○"}
                    </span>
                    <span className={a.status === "pending" ? "hc-muted" : undefined}>
                      {a.label}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {/*
              Indeterminate. The reference hardcodes a fill width
              (`hc-progress--half`, `--most`); §2 allows a determinate bar only
              against a known total, and an action list that grows as work
              starts is not one.
            */}
            <div className="hc-progress hc-space-top" />
            {meta && (
              <div className="hc-row hc-between hc-space-top">
                <span className="hc-tiny hc-muted">{meta[0]}</span>
                <span className="hc-tiny hc-muted">{meta[1]}</span>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="hc-stage-footer">
        <span className="hc-small hc-muted">{footer}</span>
      </div>
    </>
  );
}

/** Screen 03's visual: a skeleton document under a moving scan line. */
export function DocScanVisual({ caption }: { caption: string }) {
  return (
    <article className="hc-doc hc-doc--skeleton">
      <div className="hc-skel hc-skel--title" />
      <div className="hc-skel hc-skel--short" />
      <hr className="hc-divider" />
      <div className="hc-skel" />
      <div className="hc-skel hc-skel--mid" />
      <div className="hc-skel hc-skel--short" />
      <div className="hc-scan" />
      <div className="hc-skel" />
      <div className="hc-skel hc-skel--mid" />
      <div className="hc-skel" />
      <p>{caption}</p>
    </article>
  );
}

/**
 * A ring that shows real progress: an arc filling to `fraction`, or — while
 * nothing is known yet (null) — a short arc turning. The fill only moves when
 * the caller's data moves; there is no timer.
 */
export function ProgressRing({ fraction, children }: { fraction: number | null; children: ReactNode }) {
  const known = fraction !== null;
  const value = known ? Math.max(0, Math.min(1, fraction)) : 0.22;
  return (
    <div className={`hc-ring hc-ring--progress${known ? "" : " is-spinning"}`}>
      <svg className="hc-ring-svg" viewBox="0 0 100 100" aria-hidden="true">
        <circle className="hc-ring-track" cx="50" cy="50" r="48" pathLength={100} />
        <circle className="hc-ring-arc" cx="50" cy="50" r="48" pathLength={100} strokeDasharray="100" strokeDashoffset={100 - value * 100} />
      </svg>
      {children}
    </div>
  );
}

/** Screen 05's visual: the real search query, never an invented one; the ring counts real boards. */
export function QueryVisual({
  preferences,
  progress = null,
}: {
  preferences: SearchPreferences | null;
  progress?: BoardProgress | null;
}) {
  const roles = (preferences?.targetRoles ?? []).join(" · ");
  const places = (preferences?.locations ?? []).join(" / ");
  const query = [roles, places].filter(Boolean).join(" · ");
  const fraction = progress && progress.boardsDone > 0 ? progress.boardsDone / progress.boardsTotal : null;
  return (
    <>
      <ProgressRing fraction={fraction}>
        <svg
          className="hc-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="10" cy="10" r="6" />
          <path d="m15 15 5 5" />
        </svg>
      </ProgressRing>
      <h2>Searching with your priorities</h2>
      {progress && (
        <p className="hc-muted hc-small hc-ring-caption" aria-live="polite">
          {progress.boardsDone < progress.boardsTotal
            ? `${progress.boardsDone} of ${progress.boardsTotal} boards checked`
            : `All ${progress.boardsTotal} boards checked`}
        </p>
      )}
      <div className="hc-query hc-space-top">
        {/*
          Derived from the resume, so it can be thin. The reference's
          "£65k–£85k · Mid / senior · B2B SaaS" chips are omitted: we hold no
          salary, seniority or industry preference, and §5 forbids inventing
          one to fill the row.
        */}
        <span>{query || "Roles your experience supports"}</span>
      </div>
      {(preferences?.workStyles.length ?? 0) > 0 && (
        <div className="hc-row hc-space-top">
          {preferences?.workStyles.map((w) => (
            <span key={w} className="hc-tag">
              {w === "remote" ? "Remote" : w === "hybrid" ? "Hybrid" : "On-site"}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

/** Screen 05's copy side: one row per provider, with real board counts — and, once the search reports, boards done. */
export function SourceRows({ progress = null }: { progress?: BoardProgress | null }) {
  const byProvider = CURATED_BOARDS.reduce<Record<string, number>>((acc, b) => {
    acc[b.provider] = (acc[b.provider] ?? 0) + 1;
    return acc;
  }, {});
  const label: Record<string, string> = {
    greenhouse: "Greenhouse",
    lever: "Lever",
    ashby: "Ashby",
    workday: "Workday",
  };
  return (
    <div className="hc-stack hc-space-top">
      {Object.entries(byProvider).map(([provider, curated]) => {
        const live = progress?.providers[provider];
        const count = live?.total ?? curated;
        const status = !live ? "searching…" : live.done < live.total ? `${live.done} done` : "done ✓";
        return (
        <div key={provider} className="hc-source">
          <span>{label[provider] ?? provider}</span>
          {/*
            The reference shows a per-source found count ("38 found") while the
            search is still running. What the search reports live is boards
            checked per provider (explore.boards), so the row counts those;
            before the first report it says what it is doing.
          */}
          <span className="hc-tag">
            {count} {count === 1 ? "board" : "boards"} · {status}
          </span>
        </div>
        );
      })}
    </div>
  );
}

/** A number that counts to its new value instead of jumping (it still only ever shows real values' path). */
function CountUp({ value }: { value: number }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (reduced || shown === value) {
      setShown(value);
      return;
    }
    from.current = shown;
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 450);
      setShown(Math.round(from.current + (value - from.current) * (1 - (1 - t) ** 3)));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- animate from what is on screen to the new value
  }, [value, reduced]);
  return <span>{shown}</span>;
}

/**
 * Screen 07's visual: the ring, carrying a real count. Once scoring reports
 * (match.progress), the arc fills with shortlisted jobs scored and the number
 * counts them; before that it shows the roles being compared, turning.
 */
export function CountRingVisual({
  count,
  caption,
  note,
  tags,
  progress = null,
}: {
  count: number | null;
  caption: string;
  note: string;
  tags: string[];
  progress?: MatchProgress | null;
}) {
  const scoring = progress !== null && progress.jobsDone > 0;
  return (
    <>
      <ProgressRing fraction={scoring ? progress.jobsDone / progress.jobsTotal : null}>
        {scoring ? (
          <CountUp value={progress.jobsDone} />
        ) : count === null ? (
          /* No placeholder digit: an unknown count shows the spinner alone. */
          <span aria-hidden>·</span>
        ) : (
          <span>{count}</span>
        )}
      </ProgressRing>
      <h2>
        {!scoring
          ? caption
          : progress.jobsDone < progress.jobsTotal
            ? `of ${progress.jobsTotal} shortlisted roles scored`
            : `All ${progress.jobsTotal} shortlisted roles scored`}
      </h2>
      <p className="hc-muted hc-small hc-space-top">{note}</p>
      <div className="hc-row hc-space-top">
        {tags.map((t) => (
          <span key={t} className="hc-tag">
            {t}
          </span>
        ))}
      </div>
    </>
  );
}
