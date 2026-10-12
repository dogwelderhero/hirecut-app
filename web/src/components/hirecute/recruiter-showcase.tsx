"use client";

/**
 * Landing — one-to-one recruiter showcase.
 *
 * A bold, dark panel that sits right after the agent box: the human half of
 * the offer. Industry chips filter a horizontally scrolling row of tall
 * portrait cards. Data (and its placeholder status) lives in ./recruiters.
 */

import { useRef, useState } from "react";
import { RECRUITERS, initials } from "./recruiters";

const INDUSTRIES = ["All", ...RECRUITERS.map((person) => person.industry)];

export function RecruiterShowcase() {
  const [industry, setIndustry] = useState("All");
  const trackRef = useRef<HTMLDivElement>(null);
  const shown =
    industry === "All" ? RECRUITERS : RECRUITERS.filter((person) => person.industry === industry);

  function scroll(direction: 1 | -1) {
    const track = trackRef.current;
    if (!track) return;
    const card = track.querySelector<HTMLElement>(".hc-showcase-card");
    track.scrollBy({ left: direction * ((card?.offsetWidth ?? 320) + 20), behavior: "smooth" });
  }

  return (
    <section className="hc-showcase" id="how-it-works" aria-labelledby="hc-showcase-title">
      <div className="hc-showcase-kicker">The people behind your feedback</div>
      <h2 id="hc-showcase-title">
        Real Recruiters.
        <br />
        Real Feedback.
      </h2>
      <p className="hc-showcase-lead">
        These recruiters review your AI-tailored resume and tell you what to fix. They hire in your
        industry every day, so their feedback reflects what hiring managers actually want.
      </p>

      <div className="hc-showcase-filters" role="group" aria-label="Filter recruiters by industry">
        {INDUSTRIES.map((name) => (
          <button
            type="button"
            key={name}
            className={name === industry ? "is-active" : undefined}
            aria-pressed={name === industry}
            onClick={() => {
              setIndustry(name);
              trackRef.current?.scrollTo({ left: 0 });
            }}
          >
            {name}
          </button>
        ))}
      </div>

      <div className="hc-showcase-track" ref={trackRef}>
        {shown.map((person) => (
          <article className="hc-showcase-card" key={person.name}>
            <div className="hc-showcase-tags">
              {person.tags.map((tag) => (
                <span key={tag}>#{tag.replace(/[^A-Za-z]/g, "")}</span>
              ))}
            </div>
            {person.photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={person.photo} alt={person.name} loading="lazy" />
            ) : (
              <span className="hc-showcase-initials" aria-hidden="true">
                {initials(person.name)}
              </span>
            )}
            <div className="hc-showcase-name">
              <h3>
                {person.name.split(" ")[0]}
                <br />
                {person.name.split(" ").slice(1).join(" ")}
              </h3>
              <span>{person.industry}</span>
            </div>
          </article>
        ))}
      </div>

      <div className="hc-showcase-nav">
        <button type="button" aria-label="Previous recruiters" onClick={() => scroll(-1)}>
          ←
        </button>
        <button type="button" aria-label="Next recruiters" onClick={() => scroll(1)}>
          →
        </button>
      </div>
    </section>
  );
}
