"use client";

/**
 * Motion for a live list whose items arrive, re-sort and change height while
 * the visitor watches (jobs streaming in and being scored).
 *
 * Two rules keep it from flickering:
 *  - An item's entrance plays once, when the item is first SEEN. It is a script
 *    animation (Element.animate), not CSS: re-sorting moves DOM nodes, and a
 *    moved node restarts any CSS animation on it, while a script animation
 *    carries on. The entrance animates opacity and the `translate` property,
 *    so it composes with the slide below, which animates `transform`.
 *  - Position changes (a re-sort, a sibling growing) are animated with FLIP:
 *    each item starts at where it was on screen and slides to its new place.
 *    A change that lands mid-slide continues from the item's current visual
 *    position, so rapid updates never snap.
 *
 * Items are the container's direct children carrying `data-motion-id`. The
 * container must be the items' offset parent (`position: relative`).
 */

import { useLayoutEffect, useRef, type RefObject } from "react";

const SLIDE_MS = 420;
const SLIDE_EASING = "cubic-bezier(.2,.7,.2,1)";
const LIFT_SHADOW = "0 18px 40px rgba(0,0,0,.45)";
/**
 * Longest visible travel. A card re-sorted from far down the list would cross
 * the whole screen and leave its new slot empty meanwhile; beyond this it
 * starts this far away, faded, and arrives as if from just off the edge.
 */
const MAX_TRAVEL = 280;
const ENTER_MS = 350;

/** The translation a running slide currently applies, read from computed style. */
function currentTranslate(el: HTMLElement): { x: number; y: number } {
  // m41/m42 are the translation; the lift's slight scale does not move the box's origin enough to matter.
  const t = getComputedStyle(el).transform;
  if (!t || t === "none") return { x: 0, y: 0 };
  const m = new DOMMatrixReadOnly(t);
  return { x: m.m41, y: m.m42 };
}

export function useListMotion(container: RefObject<HTMLElement | null>, reducedMotion: boolean) {
  const seen = useRef(new Set<string>());
  const layout = useRef(new Map<string, { x: number; y: number }>());

  // Every render: fade new items in once, slide moved items from where they were.
  useLayoutEffect(() => {
    const root = container.current;
    if (!root) return;
    const next = new Map<string, { x: number; y: number }>();
    for (const el of Array.from(root.children) as HTMLElement[]) {
      const id = el.dataset.motionId;
      if (!id) continue;
      if (!seen.current.has(id)) {
        seen.current.add(id);
        if (!reducedMotion) {
          el.animate([{ opacity: 0, translate: "0 8px" }, { opacity: 1, translate: "0 0" }], {
            duration: ENTER_MS,
            easing: "ease-out",
            fill: "backwards",
          });
        }
      }
      // offsetTop/Left ignore transforms: this is the item's new layout slot.
      const pos = { x: el.offsetLeft, y: el.offsetTop };
      next.set(id, pos);
      const before = layout.current.get(id);
      if (!before || reducedMotion) continue;
      // Where it is on screen right now = its old slot + any slide still running.
      const running = currentTranslate(el);
      const dx = before.x + running.x - pos.x;
      const dy = before.y + running.y - pos.y;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      for (const a of el.getAnimations()) if (a.id === "list-slide") a.cancel();
      // An item rising (it came from below) travels above the ones it passes,
      // lifted with a shadow, the way a card is picked up and re-filed.
      const rising = dy > 0;
      const far = Math.abs(dy) > MAX_TRAVEL;
      const fromY = far ? Math.sign(dy) * MAX_TRAVEL : dy;
      const from: Keyframe = { transform: `translate(${dx}px, ${fromY}px)${rising ? " scale(1.01)" : ""}` };
      const to: Keyframe = { transform: `translate(0, 0)${rising ? " scale(1)" : ""}` };
      if (rising) {
        Object.assign(from, { zIndex: 2, boxShadow: LIFT_SHADOW });
        Object.assign(to, { zIndex: 2, boxShadow: "0 0 0 rgba(0,0,0,0)" });
      }
      if (far) {
        from.opacity = 0;
        to.opacity = 1;
      }
      const slide = el.animate([from, to], { duration: SLIDE_MS, easing: SLIDE_EASING });
      slide.id = "list-slide";
    }
    layout.current = next;
  });
}
