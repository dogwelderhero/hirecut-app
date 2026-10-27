"use client";

import { useEffect, useState } from "react";

/** The ~780ms packing announcement between a result's dwell and its receipt. */
export function PackingStatus() {
  return (
    <div className="hc-stage-save" role="status" aria-live="polite">
      <i className="hc-dot" />
      <span>Result ready · Saving to your chat…</span>
    </div>
  );
}

/** `header.hc-heading` + `div.hc-pill`, the reference's stage header. */
export function StageHeading({
  step,
  name,
  title,
  lead,
  pill,
}: {
  step: string;
  name: string;
  title: string;
  lead: string;
  pill: string;
}) {
  return (
    <header className="hc-heading">
      <div>
        <div className="hc-label">
          Step {step} · {name}
        </div>
        <h1>{title}</h1>
        <p>{lead}</p>
      </div>
      <div className="hc-pill">
        <i className="hc-dot" />
        <span>{pill}</span>
      </div>
    </header>
  );
}

/** `prefers-reduced-motion`, watched live. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}
