"use client";

/**
 * The results surfaces shared by screen 05 (Explore) and screen 07 (Top
 * matches): `div.hc-search-results` — heading, context bar, filter controls,
 * list heading, `div.hc-sr-feed`.
 *
 * §6 requires the same card in both places, so both render `JobCard`; only the
 * surrounding chrome and the match panel differ.
 *
 * The reference's controls are live here rather than decorative: the search
 * box, the remote filter, the saved filter and the sort all operate on jobs we
 * actually retrieved. Two of its controls are NOT reproduced:
 *
 *  - the role-family tabs ("Product design", "Senior design", "Design
 *    systems") are hand-authored for one sample search; classifying a real
 *    result set into families is a judgement we have no source for.
 *  - "Highest salary" sorting, because most postings carry no salary and the
 *    order would be mostly arbitrary. Sorting is newest-first over real
 *    `postedAt`, with undated postings last.
 */

import { useMemo, useState } from "react";
import type { Job, JobId, MatchAssessment, SearchCoverage, SearchPreferences } from "@/lib/hirecute/contracts";
import { JobCard } from "./job-card";

function SparkIcon() {
  return (
    <svg
      className="hc-sr-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3Z" />
    </svg>
  );
}

function ControlIcon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      className="hc-sr-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export interface ResultsProps {
  jobs: Record<JobId, Job>;
  order: JobId[];
  assessments: Record<JobId, MatchAssessment>;
  savedIds: Set<JobId>;
  expandedId: JobId | null;
  onToggleSave: (id: JobId) => void;
  onToggleExpand: (id: JobId) => void;
}

/** Shared search/filter/sort bar, operating on real retrieved jobs. */
function useFilteredOrder(
  props: ResultsProps,
  query: string,
  remoteOnly: boolean,
  savedOnly: boolean,
  sort: "newest" | "relevance",
) {
  return useMemo(() => {
    const q = query.trim().toLowerCase();
    let ids = props.order.filter((id) => {
      const job = props.jobs[id];
      if (!job) return false;
      if (remoteOnly && job.workStyle !== "remote") return false;
      if (savedOnly && !props.savedIds.has(id)) return false;
      if (!q) return true;
      return `${job.title} ${job.company} ${job.location ?? ""}`.toLowerCase().includes(q);
    });
    if (sort === "newest") {
      // Undated postings sink rather than sorting as epoch-0.
      ids = [...ids].sort((a, b) => {
        const da = props.jobs[a]?.postedAt;
        const db = props.jobs[b]?.postedAt;
        if (!da && !db) return 0;
        if (!da) return 1;
        if (!db) return -1;
        return db.localeCompare(da);
      });
    }
    return ids;
  }, [props, query, remoteOnly, savedOnly, sort]);
}

function Controls({
  query,
  setQuery,
  remoteOnly,
  setRemoteOnly,
  savedOnly,
  setSavedOnly,
  savedCount,
  sort,
  setSort,
  sortable,
}: {
  query: string;
  setQuery: (v: string) => void;
  remoteOnly: boolean;
  setRemoteOnly: (v: boolean) => void;
  savedOnly: boolean;
  setSavedOnly: (v: boolean) => void;
  savedCount: number;
  sort: "newest" | "relevance";
  setSort: (v: "newest" | "relevance") => void;
  /** Top matches is already ranked, so it offers relevance as well. */
  sortable: boolean;
}) {
  return (
    <section className="hc-sr-controls" aria-label="Filter job results">
      <div className="hc-sr-searchrow">
        <label className="hc-sr-query">
          <ControlIcon>
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="m16 16 5 5" />
          </ControlIcon>
          <input
            type="search"
            aria-label="Search your results by role or company"
            placeholder="Search a role, company or skill"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            data-hc-origin="input"
          />
        </label>
        <button
          className="hc-sr-filter"
          type="button"
          aria-pressed={remoteOnly}
          onClick={() => setRemoteOnly(!remoteOnly)}
          data-hc-origin="input"
        >
          <ControlIcon>
            <path d="m3 10 9-7 9 7v10H3Z" />
            <path d="M9 20v-7h6v7" />
          </ControlIcon>
          <span>Remote only</span>
        </button>
        <button
          className="hc-sr-filter"
          type="button"
          aria-pressed={savedOnly}
          onClick={() => setSavedOnly(!savedOnly)}
          data-hc-origin="input"
        >
          <ControlIcon>
            <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" />
          </ControlIcon>
          <span>Saved</span>
          <span>{savedCount}</span>
        </button>
      </div>
      {sortable && (
        <div className="hc-sr-filterrow">
          {/* The reference's role-family tabs are omitted — see the file note. */}
          <div />
          <label className="hc-sr-sort">
            <span>Sort by</span>
            <select
              aria-label="Sort job results"
              value={sort}
              onChange={(e) => setSort(e.target.value as "newest" | "relevance")}
              data-hc-origin="input"
            >
              <option value="relevance">Best match first</option>
              <option value="newest">Newest first</option>
            </select>
          </label>
        </div>
      )}
    </section>
  );
}

/** Screen 05 — Explore Jobs, results state. */
export function ExploreResults({
  coverage,
  preferences,
  ...props
}: ResultsProps & { coverage: SearchCoverage; preferences: SearchPreferences | null }) {
  const [query, setQuery] = useState("");
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [savedOnly, setSavedOnly] = useState(false);
  const ids = useFilteredOrder(props, query, remoteOnly, savedOnly, "newest");
  const total = props.order.length;

  return (
    <div className="hc-search-results">
      <header className="hc-sr-heading">
        <div>
          <div className="hc-sr-eyebrow">STEP 02 · EXPLORE JOBS</div>
          <h1>Your next chapter is out there.</h1>
          <p>
            {total} {total === 1 ? "role" : "roles"} found around your skills and preferences.
            Start with the ones that catch your eye.
          </p>
        </div>
        <div className="hc-sr-complete">
          <i />
          {/* Honest scope, never "all jobs". */}
          <span>
            {coverage.status === "complete_within_scope" ? "Search complete" : "Partial search"}
          </span>
        </div>
      </header>

      <div className="hc-sr-context">
        <div>
          <SparkIcon />
          <strong>{coverage.scopeDescription}</strong>
        </div>
        <div className="hc-sr-preferences">
          {/* The visitor's real preferences; nothing is shown if none exist. */}
          {(preferences?.locations ?? []).slice(0, 2).map((l) => (
            <span key={l}>{l}</span>
          ))}
          {coverage.boardsFailed > 0 && (
            <span>
              {coverage.boardsFailed} source{coverage.boardsFailed === 1 ? "" : "s"} unavailable
            </span>
          )}
        </div>
      </div>

      <Controls
        query={query}
        setQuery={setQuery}
        remoteOnly={remoteOnly}
        setRemoteOnly={setRemoteOnly}
        savedOnly={savedOnly}
        setSavedOnly={setSavedOnly}
        savedCount={props.savedIds.size}
        sort="newest"
        setSort={() => {}}
        sortable={false}
      />

      <div className="hc-sr-list-heading">
        <p role="status" aria-live="polite">
          {ids.length === total
            ? `${total} ${total === 1 ? "opening" : "openings"}`
            : `${ids.length} of ${total} openings`}
        </p>
        <span className="hc-sr-sample">Newest first · undated postings last</span>
      </div>

      <div className="hc-sr-feed">
        {ids.length === 0 ? (
          <p className="hc-sr-empty">No roles match those filters.</p>
        ) : (
          ids.map((id) => (
            <JobCard
              key={id}
              job={props.jobs[id]}
              saved={props.savedIds.has(id)}
              expanded={props.expandedId === id}
              onToggleSave={() => props.onToggleSave(id)}
              onToggleExpand={() => props.onToggleExpand(id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

/** Screen 07 — Top matching jobs, results state. */
export function MatchResults({
  rankedIds,
  ...props
}: ResultsProps & { rankedIds: JobId[] }) {
  const [query, setQuery] = useState("");
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [savedOnly, setSavedOnly] = useState(false);
  const [sort, setSort] = useState<"newest" | "relevance">("relevance");
  const ranked = { ...props, order: rankedIds };
  const ids = useFilteredOrder(ranked, query, remoteOnly, savedOnly, sort);
  const total = rankedIds.length;
  const scored = rankedIds.filter((id) => props.assessments[id]).length;

  return (
    <div className="hc-search-results hc-topmatches">
      <header className="hc-sr-heading">
        <div>
          <div className="hc-sr-eyebrow">STEP 03 · TOP MATCHING JOBS</div>
          <h1>
            {total} {total === 1 ? "role" : "roles"} worth your time.
          </h1>
          <p>
            The roles you explored, ranked for your experience. See the fit at a glance, then take
            a closer look.
          </p>
        </div>
        <div className="hc-sr-complete">
          <i />
          <span>Top matches ready</span>
        </div>
      </header>

      <div className="hc-tm-summary">
        <div>
          <span className="hc-tag hc-tag--green">
            {total} top {total === 1 ? "match" : "matches"}
          </span>
          <span className="hc-tag">Best match first</span>
          {/* Only claim scores we produced. */}
          {scored < total && (
            <span className="hc-tag">
              {total - scored} not scored
            </span>
          )}
        </div>
        <span className="hc-sr-sample">Scores are a guide to fit, not a prediction</span>
      </div>

      <Controls
        query={query}
        setQuery={setQuery}
        remoteOnly={remoteOnly}
        setRemoteOnly={setRemoteOnly}
        savedOnly={savedOnly}
        setSavedOnly={setSavedOnly}
        savedCount={props.savedIds.size}
        sort={sort}
        setSort={setSort}
        sortable
      />

      <div className="hc-sr-list-heading">
        <span>
          {ids.length === total
            ? `Showing all ${total}`
            : `Showing ${ids.length} of ${total} top matches`}
        </span>
        <span className="hc-sr-sample">Saved roles stay with you</span>
      </div>

      <div className="hc-sr-feed">
        {ids.map((id) => (
          <JobCard
            key={id}
            job={props.jobs[id]}
            assessment={props.assessments[id] ?? null}
            saved={props.savedIds.has(id)}
            expanded={props.expandedId === id}
            onToggleSave={() => props.onToggleSave(id)}
            onToggleExpand={() => props.onToggleExpand(id)}
            showMatchPanel
          />
        ))}
      </div>
    </div>
  );
}
