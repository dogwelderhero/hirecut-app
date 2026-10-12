"use client";

/**
 * Screen 09 — Bulk Apply, ported to `div.hc-ap-workspace`.
 *
 * The reference layout: `section.hc-ap-list` (batch header, method filters, a
 * scrolling list of `article.hc-ap-row` = checkbox + `hc-ap-mark` +
 * `hc-ap-row-body` + `hc-ap-row-end`) beside
 * `section.hc-ap-detail.hc-ap-mail-detail` (`hc-ap-recruiter`,
 * `hc-ap-email-pane` with To/Subj rows, the letter, `hc-ap-email-tools`, and
 * the `hc-ap-launch` bar).
 *
 * Rules §7 is strict about, preserved:
 *  - ONE readiness badge per row, in the method position. No second row, no
 *    "20 selected / 18 ready / 2 wait" summary strip.
 *  - The match percentage sits in `hc-ap-row-end` and never wraps.
 *  - No tabs inside the detail pane, no "Application details & auto-apply
 *    method", no "HOW WE'LL APPLY", no "Tailored resume attached", no
 *    work-authorization callout.
 *  - The checkbox changes inclusion only; `hc-ap-pick` selects the letter; the
 *    employer link keeps its native action.
 *  - Readiness comes from actual artifacts, never elapsed time.
 *
 * Two reference details are adapted rather than copied. Its filter tabs bucket
 * by delivery method (All / Auto-apply / Browser / Needs input), which only
 * describes reality in the auto-apply pilot — with submission disabled every
 * package is `manual_only` and an "Auto-apply 12" tab would be a lie, so the
 * activation pilot buckets by readiness instead. And its masked sample
 * recruiter ("Sa••• M•••••", "sa•••@fo•••.example") is never reproduced: a
 * contact we do not have reads "Hiring team · {company}", never a fake mask.
 */

import { useMemo, useState } from "react";
import type {
  ApplicationPackage,
  Job,
  JobId,
  LaunchProfile,
  MatchAssessment,
} from "@/lib/hirecute/contracts";
import { matchPresentation, providerLabel } from "@/lib/hirecute/match";
import { displayText, type LetterView } from "@/lib/hirecute/letters";

/**
 * One readiness label, derived from the package — never from a timer.
 *
 * The reference's row badge is `span.hc-ap-method.hc-ap-prep` with a
 * `data-app-prep-state` attribute (`ready` / `input` / `working` / `queued`);
 * the pill colour and the ✓/○/spinner glyph both come from that attribute in
 * CSS (hirecute-screens.css), not from a bespoke class per state. `failed` is
 * new here — the reference never modelled a prepare failure — so it reuses
 * the same `--danger` tokens the design system already uses for `.hc-tag--red`.
 */
function readiness(
  pkg: ApplicationPackage | undefined,
  launchProfile: LaunchProfile,
): { text: string; state: PrepState; bucket: Bucket } {
  if (!pkg) return { text: "In your agent’s queue", state: "queued", bucket: "preparing" };
  const r = pkg.readiness;
  if (r.status === "preparing")
    return { text: "Preparing application…", state: "working", bucket: "preparing" };
  if (r.status === "failed")
    return { text: "Couldn’t prepare", state: "failed", bucket: "failed" };
  if (r.status === "needs_input")
    return { text: "Needs your input", state: "input", bucket: "needs_input" };
  if (pkg.submission.status === "confirmed")
    return { text: "Submitted", state: "ready", bucket: "ready" };
  // Material readiness alone never earns the auto-apply label.
  if (launchProfile === "auto_apply_pilot" && pkg.capability.kind !== "manual_only") {
    return { text: "Ready to auto-apply", state: "ready", bucket: "ready" };
  }
  return { text: "Ready to apply", state: "ready", bucket: "ready" };
}

type PrepState = "ready" | "input" | "working" | "queued" | "failed";

type Bucket = "ready" | "needs_input" | "preparing" | "failed";

export const WORK_STYLE: Record<NonNullable<Job["workStyle"]>, string> = {
  remote: "Remote",
  hybrid: "Hybrid",
  onsite: "On-site",
};

export function ExternalIcon() {
  return (
    <svg
      className="hc-ap-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 3h7v7m0-7L10 14M11 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6" />
    </svg>
  );
}

/** "Hiring team · {company}" when unknown — never an invented masked address. */
function recruiterLines(job: Job) {
  if (job.recruiter.status === "identified") {
    const name = job.recruiter.name.status === "known" ? job.recruiter.name.value : null;
    const title = job.recruiter.title.status === "known" ? job.recruiter.title.value : null;
    const email = job.recruiter.email.status === "known" ? job.recruiter.email.value : null;
    return {
      name: name ?? `Hiring team · ${job.company}`,
      role: [title, job.company].filter(Boolean).join(" · "),
      email,
      note: email ? null : "Email not listed on this posting",
    };
  }
  return {
    name: job.recruiter.displayName,
    role: job.company,
    email: null,
    note:
      job.recruiter.reason === "contact_not_listed"
        ? "Contact not listed on this posting"
        : "Contact could not be verified",
  };
}

export function BulkApply({
  jobs,
  applications,
  assessments,
  selectedIds,
  activeJobId,
  letters,
  launchProfile,
  preparing,
  onSelectJob,
  onToggleInclude,
  onEditLetter,
  onSaveLetter,
  onClaimCredits,
}: {
  jobs: Job[];
  applications: Record<JobId, ApplicationPackage>;
  assessments: Record<JobId, MatchAssessment>;
  selectedIds: JobId[];
  activeJobId: JobId | null;
  letters: Record<JobId, LetterView>;
  launchProfile: LaunchProfile;
  preparing: boolean;
  onSelectJob: (id: JobId) => void;
  onToggleInclude: (id: JobId, included: boolean) => void;
  onEditLetter: (id: JobId, text: string) => void;
  onSaveLetter: (id: JobId) => void;
  onClaimCredits: () => void;
}) {
  const [filter, setFilter] = useState<"all" | Bucket>("all");
  const [editing, setEditing] = useState(false);
  const selected = new Set(selectedIds);

  const buckets = useMemo(() => {
    const counts: Record<Bucket, number> = { ready: 0, needs_input: 0, preparing: 0, failed: 0 };
    for (const job of jobs) counts[readiness(applications[job.id], launchProfile).bucket] += 1;
    return counts;
  }, [jobs, applications, launchProfile]);

  const visible = jobs.filter(
    (j) => filter === "all" || readiness(applications[j.id], launchProfile).bucket === filter,
  );

  const activeJob = jobs.find((j) => j.id === activeJobId) ?? null;
  const activePkg = activeJobId ? applications[activeJobId] : undefined;
  const activeLetter = activeJobId ? letters[activeJobId] : undefined;
  const allSelected = jobs.length > 0 && jobs.every((j) => selected.has(j.id));
  const contact = activeJob ? recruiterLines(activeJob) : null;
  const activeMatch = activeJobId ? matchPresentation(assessments[activeJobId]) : null;

  const tabs: Array<{ key: "all" | Bucket; label: string; count: number }> = [
    { key: "all", label: "All", count: jobs.length },
    { key: "ready", label: "Ready", count: buckets.ready },
    { key: "needs_input", label: "Needs input", count: buckets.needs_input },
  ];
  if (buckets.preparing > 0) {
    tabs.push({ key: "preparing", label: "Preparing", count: buckets.preparing });
  }
  if (buckets.failed > 0) {
    tabs.push({ key: "failed", label: "Couldn’t prepare", count: buckets.failed });
  }

  return (
    <div className="hc-ap-workspace">
      <section className="hc-ap-list" aria-label="Your application batch">
        <div className="hc-ap-list-head">
          <div>
            <h2>YOUR APPLICATION BATCH</h2>
            {/* Real counts; "0 sent" is a fact while submission is disabled. */}
            <span>
              {jobs.length} prepared · {selectedIds.length} selected · 0 sent
            </span>
          </div>
          <label className="hc-ap-select-all">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={(e) => jobs.forEach((j) => onToggleInclude(j.id, e.target.checked))}
              data-hc-origin="input"
            />
            <span>Select all</span>
          </label>
        </div>

        <div className="hc-ap-filters" role="group" aria-label="Filter by readiness">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              aria-pressed={filter === t.key}
              onClick={() => setFilter(t.key)}
              data-hc-origin="input"
            >
              <span>{t.label}</span>
              <span>{t.count}</span>
            </button>
          ))}
        </div>

        <div className="hc-ap-list-scroll">
          {visible.map((job, i) => {
            const pkg = applications[job.id];
            const badge = readiness(pkg, launchProfile);
            const presentation = matchPresentation(assessments[job.id]);
            const isActive = job.id === activeJobId;
            // Skip a work style the location line already states ("Remote ·
            // Remote"), and never print the raw enum value.
            const style = job.workStyle ? WORK_STYLE[job.workStyle] : null;
            const meta = [
              job.location,
              style && !job.location?.toLowerCase().includes(style.toLowerCase())
                ? style
                : null,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <article
                key={job.id}
                className={`hc-ap-row${isActive ? " is-active" : ""}`}
                data-hc-origin="card"
              >
                <input
                  type="checkbox"
                  checked={selected.has(job.id)}
                  aria-label={`Include ${job.title} at ${job.company}`}
                  onChange={(e) => onToggleInclude(job.id, e.target.checked)}
                  data-hc-origin="input"
                />
                <div className={`hc-ap-mark hc-ap-mark--${i % 4}`} aria-hidden="true">
                  <span>{job.company.slice(0, 1).toUpperCase()}</span>
                </div>
                <div className="hc-ap-row-body">
                  {/* Selecting the letter — inclusion is the checkbox's job. */}
                  <button
                    type="button"
                    className="hc-ap-pick"
                    aria-pressed={isActive}
                    onClick={() => {
                      setEditing(false);
                      onSelectJob(job.id);
                    }}
                  >
                    <strong>{job.title}</strong>
                    <span>
                      <span>{job.company}</span>
                      {meta && <span> · {meta}</span>}
                    </span>
                  </button>
                  <div className="hc-ap-row-meta">
                    {/* Exactly one readiness badge. */}
                    <span className="hc-ap-method hc-ap-prep" data-app-prep-state={badge.state}>
                      <i aria-hidden="true" />
                      <span data-app-prep-label>{badge.text}</span>
                    </span>
                    <span className="hc-ap-provider">{providerLabel(job.source.provider)}</span>
                  </div>
                  <a
                    href={job.source.applicationUrl ?? job.source.canonicalPostingUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    onClick={(e) => e.stopPropagation()}
                    data-hc-origin="link"
                  >
                    <span>Application page</span>
                    <ExternalIcon />
                  </a>
                </div>
                {presentation && (
                  <div className="hc-ap-row-end" aria-label={`${presentation.matchPercent}% match`}>
                    <strong>{presentation.matchPercent}%</strong>
                  </div>
                )}
              </article>
            );
          })}
          {visible.length === 0 && <p className="hc-ap-muted">Nothing in this group.</p>}
        </div>
      </section>

      <section className="hc-ap-detail hc-ap-mail-detail" aria-label="Your cover letter">
        {!activeJob || !contact ? (
          <p className="hc-ap-muted">Select a role to read and edit its letter.</p>
        ) : (
          <>
            <header className="hc-ap-recruiter">
              <div className="hc-ap-detail-company">
                <div className="hc-ap-mark hc-ap-mark--0" aria-hidden="true">
                  <span>{activeJob.company.slice(0, 1).toUpperCase()}</span>
                </div>
                <div>
                  <strong>{contact.name}</strong>
                  <p className="hc-ap-muted">{contact.role}</p>
                </div>
                {activeMatch && (
                  <span className="hc-ap-match">
                    <span>{activeMatch.matchPercent}% match</span>
                  </span>
                )}
              </div>
              <small className="hc-ap-muted">
                {contact.note ? `${contact.note} · ` : ""}Draft only · nothing is sent from here
              </small>
            </header>

            <section className="hc-ap-email-pane" aria-label="Cover letter">
              <div className="hc-ap-email-meta">
                <span className="hc-ap-muted">To</span>
                <span>{contact.email ?? contact.name}</span>
              </div>
              <div className="hc-ap-email-meta">
                <span className="hc-ap-muted">Subj</span>
                <strong>
                  {activePkg?.letter.current?.subject ?? `Application: ${activeJob.title}`}
                </strong>
              </div>

              <div className="hc-ap-email-content">
                {editing ? (
                  <label className="hc-ap-email-editor">
                    <span className="hc-visually-hidden">
                      Cover letter for {activeJob.title} at {activeJob.company}
                    </span>
                    <textarea
                      // Keyed by job, so switching rows cannot carry one
                      // letter's editor state onto another.
                      key={activeJob.id}
                      value={displayText(activeLetter)}
                      onChange={(e) => onEditLetter(activeJob.id, e.target.value)}
                      rows={18}
                      spellCheck
                      data-hc-origin="editor"
                    />
                  </label>
                ) : (
                  <div className="hc-ap-email-body">
                    <span>{displayText(activeLetter)}</span>
                    {activeLetter?.streaming && <i className="hc-ap-email-cursor" aria-hidden />}
                  </div>
                )}
              </div>

              <div className="hc-ap-email-tools">
                {/* A draft status — never a claim that anything was sent. */}
                <span className="hc-ap-email-state" role="status" aria-live="polite">
                  {activeLetter?.streaming
                    ? "Drafting…"
                    : activeLetter?.dirty
                      ? "Unsaved changes"
                      : activeLetter?.receivedText
                        ? "Draft ready · Not sent"
                        : "No draft yet"}
                </span>
                {editing ? (
                  <button
                    type="button"
                    disabled={!activeLetter?.dirty}
                    onClick={() => {
                      onSaveLetter(activeJob.id);
                      setEditing(false);
                    }}
                  >
                    <span>Save draft</span>
                  </button>
                ) : (
                  <button type="button" onClick={() => setEditing(true)}>
                    <span>Edit draft</span>
                  </button>
                )}
              </div>
            </section>

            {activePkg?.readiness.status === "needs_input" && (
              /*
                Removing the reference's large callout does not authorize
                guessing: this compact status keeps the role manual-only.
              */
              <p className="hc-ap-muted">
                {activePkg.readiness.explanation} This role stays manual — open the employer
                application to answer it yourself.
              </p>
            )}

            <div className="hc-ap-launch hc-ap-email-launch">
              <div>
                <strong>Your agent is ready when you are.</strong>
                <p>
                  $30 free credits · $0 due today
                  {buckets.needs_input > 0 &&
                    ` · ${buckets.needs_input} application${
                      buckets.needs_input === 1 ? "" : "s"
                    } will wait for your input`}
                  {preparing && " · still preparing the rest"}
                </p>
              </div>
              <button
                type="button"
                className="hc-button"
                onClick={onClaimCredits}
                /* Manual checkout entry, excluded from the click counter. */
                data-hc-zone="credit_banner_cta"
              >
                <span>Claim $30 free credits</span>
                <ExternalIcon />
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
