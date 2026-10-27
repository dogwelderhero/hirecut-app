"use client";

/**
 * Step 4 — Talk to a recruiter, and the paywall it leads to.
 *
 * No backend work: the agent picks recruiters whose industry fits the resume
 * and its top jobs, and the gaps it could not close become what to talk about.
 * "Book a call" and "Download resume" both open the paywall (the Flowkit
 * checkout overlay). Nothing is booked, charged or downloaded from here.
 */

import type { ResumeGap } from "@/lib/hirecute/contracts";
import { RECRUITERS, initials } from "./recruiters";

type Recruiter = (typeof RECRUITERS)[number];

export function RecruiterStep({
  recruiters,
  openGaps,
  onBook,
  onDownload,
}: {
  recruiters: readonly Recruiter[];
  /** Gaps no suggested change could answer: the conversation topics. */
  openGaps: ResumeGap[];
  onBook: (recruiter: Recruiter) => void;
  onDownload: () => void;
}) {
  return (
    <aside className="hc-panel hc-rs" aria-label="Talk to a recruiter">
      <header className="hc-panel-head">
        <span className="hc-label">STEP 4 · TALK TO A RECRUITER</span>
      </header>
      <div className="hc-doc hc-rs-body">
        <p className="hc-rs-lead">
          Your agent picked recruiters who hire in your field. Book a quick call to go through your
          resume and what to do about the gaps.
        </p>

        <ul className="hc-rs-list">
          {recruiters.map((r, i) => (
            <li key={r.name} className="hc-rs-card" style={{ animationDelay: `${i * 120}ms` }}>
              {r.photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.photo} alt="" className="hc-rs-photo" />
              ) : (
                <span className="hc-rs-photo" aria-hidden="true">
                  {initials(r.name)}
                </span>
              )}
              <div className="hc-rs-info">
                <strong>{r.name}</strong>
                <span className="hc-label">{r.industry}</span>
                <p>{r.bio}</p>
              </div>
              <button type="button" className="hc-button hc-rs-book" onClick={() => onBook(r)}>
                Book a 15-min call
              </button>
            </li>
          ))}
        </ul>

        {openGaps.length > 0 && (
          <div className="hc-rs-topics">
            <span className="hc-label">To talk through on your call</span>
            <ul>
              {openGaps.slice(0, 4).map((g) => (
                <li key={g.id}>
                  {g.requirement}
                  <small>
                    {" "}
                    · asked by {g.jobs.length} job{g.jobs.length === 1 ? "" : "s"}
                  </small>
                </li>
              ))}
            </ul>
          </div>
        )}

        <button type="button" className="hc-button hc-button--quiet hc-rs-download" onClick={onDownload}>
          Download your improved resume
        </button>
      </div>
    </aside>
  );
}
