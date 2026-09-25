import localFont from "next/font/local";

/**
 * Typography — Inter, matching the finished designs in
 * `MVP architecture and screens/hirecute-screens`.
 *
 * Those screens embed Inter as base64 at nine declared weights (400-800), but
 * all nine payloads are byte-identical: one 48KB subset repeated. So a single
 * vendored file covers the whole range, and the 566KB of inlined font data in
 * the reference HTML becomes one request.
 *
 * Self-hosted via next/font/local, so a production build never contacts a font
 * CDN — the invariant `tests/lib/fonts-local.test.mjs` protects.
 *
 * `--font-serif` is a system stack in the reference design (Georgia), so there
 * is no display face to vendor; the serif-italic hero line uses it directly.
 */
export const inter = localFont({
  src: [{ path: "../assets/fonts/inter/Inter-subset.woff2", weight: "100 900", style: "normal" }],
  variable: "--font-inter",
  display: "swap",
});
