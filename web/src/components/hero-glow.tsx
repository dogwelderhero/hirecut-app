"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

// The hirecute-docs home signature: an animated grain-gradient glow. Deferred
// to browser idle, skipped on reduced-motion, ssr:false → zero LCP cost. Renders
// grain in the corners (transparent center) so the dot-grid shows through.
const GrainGradient = dynamic(
  () => import("@paper-design/shaders-react").then((m) => m.GrainGradient),
  { ssr: false },
);

export function HeroGlow() {
  const [show, setShow] = useState(false);
  const [dark, setDark] = useState(true);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const readTheme = () => setDark(document.documentElement.classList.contains("dark"));
    readTheme();
    window.addEventListener("themechange", readTheme);

    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, o?: { timeout?: number }) => number;
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (typeof w.requestIdleCallback === "function") {
      w.requestIdleCallback(() => setShow(true), { timeout: 2000 });
    } else {
      timer = setTimeout(() => setShow(true), 400);
    }

    return () => {
      window.removeEventListener("themechange", readTheme);
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (!show) return null;

  return (
    <GrainGradient
      className="absolute inset-0 z-0 animate-fade-in-delayed"
      // Neutral ramp to match the shadcn neutral theme. The shader takes hex
      // strings, not CSS vars, so these are the one place a colour is still
      // hardcoded — re-tint here when the product gets its own brand.
      colors={dark ? ["#3f3f46", "#27272a", "#18181b00"] : ["#e4e4e7", "#d4d4d8", "#f4f4f500"]}
      colorBack="#00000000"
      softness={1}
      intensity={dark ? 0.42 : 0.26}
      noise={0.32}
      speed={0.45}
      shape="corners"
      minPixelRatio={1}
      maxPixelCount={1920 * 1080}
    />
  );
}
