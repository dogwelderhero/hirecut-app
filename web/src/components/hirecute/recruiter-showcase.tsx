"use client";

/**
 * Landing — one-to-one recruiter showcase.
 *
 * A bold, dark panel that sits right after the agent box: the human half of
 * the offer. Industry chips filter a horizontally scrolling row of tall
 * portrait cards. Data (and its placeholder status) lives in
 * content/recruiters.json; copy in the scenario's content/strings.
 */

import { useRef, useState } from "react";
import type { BlockProps } from "./landing/types";
import { t } from "./landing/strings";
import { RECRUITERS, initials } from "./recruiters";

/** null = every industry (the "All" chip). */
const INDUSTRIES = [null, ...RECRUITERS.map((person) => person.industry)];

export function RecruiterShowcase({ s, config }: Pick<BlockProps, "s" | "config">) {
  const [industry, setIndustry] = useState<string | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const shown =
    industry === null ? RECRUITERS : RECRUITERS.filter((person) => person.industry === industry);

  function scroll(direction: 1 | -1) {
    const track = trackRef.current;
    if (!track) return;
    const card = track.querySelector<HTMLElement>(".hc-showcase-card");
    track.scrollBy({ left: direction * ((card?.offsetWidth ?? 320) + 20), behavior: "smooth" });
  }

  return (
    <section className="hc-showcase" id={config.anchor} aria-labelledby="hc-showcase-title">
      <div className="hc-showcase-kicker">{t(s, "recruiters.kicker")}</div>
      <h2 id="hc-showcase-title">
        {t(s, "recruiters.title")}
        <br />
        {t(s, "recruiters.titleLine2")}
      </h2>
      <p className="hc-showcase-lead">{t(s, "recruiters.lead")}</p>

      <div className="hc-showcase-filters" role="group" aria-label={t(s, "recruiters.filterLabel")}>
        {INDUSTRIES.map((name) => (
          <button
            type="button"
            key={name ?? "all"}
            className={name === industry ? "is-active" : undefined}
            aria-pressed={name === industry}
            onClick={() => {
              setIndustry(name);
              trackRef.current?.scrollTo({ left: 0 });
            }}
          >
            {name ?? t(s, "recruiters.filterAll")}
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
        <button type="button" aria-label={t(s, "recruiters.prev")} onClick={() => scroll(-1)}>
          ←
        </button>
        <button type="button" aria-label={t(s, "recruiters.next")} onClick={() => scroll(1)}>
          →
        </button>
      </div>
    </section>
  );
}
