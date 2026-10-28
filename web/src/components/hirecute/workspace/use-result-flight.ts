"use client";

/**
 * The pack animation: the result on screen flies into its receipt in the
 * conversation column, the reference's `.hc-result-flight`.
 *
 * Only motion lives here. The presentation machine decides WHEN a result packs
 * (and for how long); this hook draws a clone of the visible result travelling
 * to the receipt during that window, then marks the receipt as receiving.
 * Reduced motion never packs, so it never flies.
 */

import { useEffect, useRef, useState } from "react";
import { PRESENTATION } from "@/lib/hirecute/config";
import type { StageId } from "@/lib/hirecute/contracts";
import type { PresentationState } from "@/lib/hirecute/presentation";

const FLIGHT_EASING = "cubic-bezier(.2,.7,.2,1)";
/** How long the receipt stays highlighted after the result lands in it. */
export const RECEIVE_MS = 700;

/** Returns the stage whose receipt is receiving its result right now, if any. */
export function useResultFlight(presentation: PresentationState, reducedMotion: boolean): StageId | null {
  const packing = presentation.phase.kind === "packing" ? presentation.phase.stage : null;
  const [receiving, setReceiving] = useState<StageId | null>(null);
  // The flight outlives the packing phase by a frame or two (the phase ends on
  // the presentation clock's tick), so it is torn down on unmount only.
  const active = useRef<{ flight: HTMLElement; animation: Animation } | null>(null);
  useEffect(
    () => () => {
      active.current?.animation.cancel();
      active.current?.flight.remove();
    },
    [],
  );

  useEffect(() => {
    if (!packing || reducedMotion) return;
    const source = document.querySelector<HTMLElement>(".hc-work .hc-stage-result");
    const target = document.querySelector<HTMLElement>(`[data-receipt-stage="${packing}"]`);
    if (!source || !target || typeof source.animate !== "function") return;

    target.scrollIntoView({ block: "nearest" });
    const from = source.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    // Fly only the part of the result the visitor can see.
    const top = Math.max(from.top, 0);
    const bottom = Math.min(from.bottom, window.innerHeight);
    if (from.width === 0 || bottom <= top) return;

    const flight = document.createElement("div");
    flight.className = "hc-result-flight";
    flight.setAttribute("aria-hidden", "true");
    flight.inert = true;
    Object.assign(flight.style, {
      left: `${from.left}px`,
      top: `${top}px`,
      width: `${from.width}px`,
      height: `${bottom - top}px`,
    });
    const clone = source.cloneNode(true) as HTMLElement;
    clone.classList.remove("is-packing");
    clone.style.marginTop = `${from.top - top}px`;
    flight.append(clone);
    document.body.append(flight);

    const dx = to.left - from.left;
    const dy = to.top - top;
    const sx = to.width / from.width;
    const sy = to.height / (bottom - top);
    const animation = flight.animate(
      [
        { transform: "none", opacity: 1 },
        { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, opacity: 0.25 },
      ],
      { duration: PRESENTATION.packMs, easing: FLIGHT_EASING, fill: "forwards" },
    );

    active.current = { flight, animation };
    animation.onfinish = () => {
      flight.remove();
      active.current = null;
      setReceiving(packing);
    };
  }, [packing, reducedMotion]);

  useEffect(() => {
    if (!receiving) return;
    const id = setTimeout(() => setReceiving(null), RECEIVE_MS);
    return () => clearTimeout(id);
  }, [receiving]);

  return receiving;
}
