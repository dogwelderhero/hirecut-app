// Typography — Geist, shadcn/ui's recommended pairing (what the shadcn docs
// site and its Next.js templates ship).
//
// The `geist` package wraps next/font, so both faces are self-hosted: no
// Google Fonts request at build or runtime, same offline guarantee the
// previously-vendored Inter/Instrument Serif woff2 files gave us.
//
// Geist Sans carries body, UI *and* display type. There is no separate serif:
// `--font-display` and `--font-serif` point at Geist Sans in globals.css, so
// the ~24 existing `font-display` class usages keep working and simply render
// sans. Restore an editorial serif by pointing those two tokens at a serif
// face and re-adding it here.
export { GeistSans } from "geist/font/sans";
export { GeistMono } from "geist/font/mono";
