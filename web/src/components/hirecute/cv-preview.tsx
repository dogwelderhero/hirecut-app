"use client";

/**
 * Step 4, left side: the updated resume, laid out as a document.
 *
 * It is `acceptedResume(resume, recommendations, {applied, excluded})` — the
 * same computation that would produce the download — so what you see is what
 * you would get. Text an applied change wrote is highlighted. Empty sections
 * are left out, as a real resume would.
 *
 * Shown like a print preview: an A4 page laid out at print size, scaled down
 * to fit the space (as tall as the panel beside it). Only the first page is
 * shown; a longer resume says how many pages it runs to.
 */

import { Fragment, useEffect, useRef, useState } from "react";

/** A4 at 96 dpi. The page is laid out at print size, then scaled to fit. */
const A4_W = 794;
const A4_H = 1123;
import { acceptedResume, type ResumeDocument, type ResumeRecommendation } from "@/lib/hirecute/resume.mjs";

function Marked({ text, marks }: { text: string; marks: string[] }) {
  let parts: Array<string | { m: string }> = [text];
  for (const m of marks) {
    if (!m) continue;
    parts = parts.flatMap((p) => {
      if (typeof p !== "string") return [p];
      const at = p.indexOf(m);
      if (at < 0) return [p];
      return [p.slice(0, at), { m }, p.slice(at + m.length)];
    });
  }
  return (
    <>
      {parts.map((p, i) =>
        typeof p === "string" ? <Fragment key={i}>{p}</Fragment> : <mark key={i}>{p.m}</mark>,
      )}
    </>
  );
}

export function CvPreview({
  resume,
  recommendations,
  appliedIds,
  excludedItems,
  onEdit,
}: {
  resume: ResumeDocument;
  recommendations: ResumeRecommendation[];
  appliedIds: string[];
  excludedItems: string[];
  /** Back to the changes (step 3). */
  onEdit: () => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLElement>(null);
  const [scale, setScale] = useState(0.6);
  const [pages, setPages] = useState(1);

  const [box, setBox] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const PAD = 16;
    const fit = () => {
      // Inner size: the frame's height comes from the panel beside it; the
      // page is absolutely placed, so it never pushes that height.
      const w = frame.clientWidth - PAD * 2;
      const h = frame.clientHeight - PAD * 2;
      if (w > 0 && h > 0) {
        setScale(Math.min(w / A4_W, h / A4_H));
        setBox({ w: frame.clientWidth, h: frame.clientHeight });
      }
      // Where the last block actually ends, plus the page's bottom margin.
      const page = pageRef.current;
      const last = page?.lastElementChild as HTMLElement | null;
      const end = last ? last.offsetTop + last.offsetHeight + 56 : A4_H;
      setPages(Math.max(1, Math.ceil(end / A4_H)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(frame);
    return () => ro.disconnect();
  }, [appliedIds, excludedItems, resume]);

  const cv = acceptedResume(resume, recommendations, {
    appliedRecommendationIds: appliedIds,
    excludedItems,
  });
  const marks = recommendations.filter((r) => appliedIds.includes(r.id)).map((r) => r.after.trim());
  const M = ({ t }: { t?: string }) => (t ? <Marked text={t} marks={marks} /> : null);
  const c = cv.contact ?? {};
  const contactLine = [c.email, c.phone, c.location, ...(c.links ?? []).map((l) => l.label || l.url)].filter(Boolean);

  return (
    <section className="hc-panel hc-cvp" aria-label="Your updated resume">
      <header className="hc-panel-head">
        <span className="hc-label">YOUR UPDATED RESUME</span>
        <span className="hc-tag">
          {pages > 1 ? `Page 1 of ${pages} · ` : ""}
          {appliedIds.length} change{appliedIds.length === 1 ? "" : "s"} applied ·{" "}
          <button type="button" className="hc-cvp-edit" onClick={onEdit}>
            Edit changes
          </button>
        </span>
      </header>
      <div className="hc-cvp-frame" ref={frameRef}>
        <div
          className="hc-cvp-sheet"
          style={{
            width: A4_W * scale,
            height: A4_H * scale,
            left: Math.max(0, (box.w - A4_W * scale) / 2),
            top: 16,
          }}
        >
      <article
        className="hc-cvp-page"
        ref={pageRef}
        style={{ width: A4_W, height: A4_H, transform: `scale(${scale})` }}
      >
        <h1>{c.name ?? "Your name"}</h1>
        {cv.targetTitle && (
          <p className="hc-cvp-title">
            <M t={cv.targetTitle} />
          </p>
        )}
        {contactLine.length > 0 && <p className="hc-cvp-contact">{contactLine.join("  ·  ")}</p>}

        {cv.summary && (
          <section>
            <h2>Summary</h2>
            <p>
              <M t={cv.summary} />
            </p>
          </section>
        )}

        {cv.experience.length > 0 && (
          <section>
            <h2>Experience</h2>
            {cv.experience.map((e, i) => (
              <div key={i} className="hc-cvp-entry">
                <div className="hc-cvp-entry-head">
                  <strong>
                    <M t={[e.role, e.company].filter(Boolean).join(" · ")} />
                  </strong>
                  <span>
                    <M t={[e.location, e.dates].filter(Boolean).join(" · ")} />
                  </span>
                </div>
                {(e.bullets ?? []).length > 0 && (
                  <ul>
                    {(e.bullets ?? []).map((b, j) => (
                      <li key={j}>
                        <M t={b} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </section>
        )}

        {cv.projects.length > 0 && (
          <section>
            <h2>Projects</h2>
            {cv.projects.map((p, i) => (
              <div key={i} className="hc-cvp-entry">
                <div className="hc-cvp-entry-head">
                  <strong>{p.name}</strong>
                  <span>{p.tech}</span>
                </div>
                {p.description && (
                  <p>
                    <M t={p.description} />
                  </p>
                )}
              </div>
            ))}
          </section>
        )}

        {cv.education.length > 0 && (
          <section>
            <h2>Education</h2>
            {cv.education.map((e, i) => (
              <div key={i} className="hc-cvp-entry-head">
                <strong>{[e.title, e.org].filter(Boolean).join(" · ")}</strong>
                <span>{e.year}</span>
              </div>
            ))}
          </section>
        )}

        {(cv.skills.length > 0 || cv.interests.length > 0) && (
          <section>
            <h2>Skills</h2>
            {cv.skills.map((s, i) => (
              <p key={i}>
                {s.category && <strong>{s.category}: </strong>}
                <M t={s.items.join(", ")} />
              </p>
            ))}
            {cv.interests.length > 0 && (
              <p>
                <strong>Interests: </strong>
                {cv.interests.join(", ")}
              </p>
            )}
          </section>
        )}

        {cv.certifications.length > 0 && (
          <section>
            <h2>Certifications</h2>
            {cv.certifications.map((x, i) => (
              <p key={i}>{[x.title, x.org, x.year].filter(Boolean).join(" · ")}</p>
            ))}
          </section>
        )}
      </article>
        </div>
      </div>
    </section>
  );
}
