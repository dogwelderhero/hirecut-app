"use client";

/**
 * Screen 1 — Landing and upload, assembled from the visitor's scenario.
 *
 * Ported from `MVP architecture and screens/hirecute-screens/screens/
 * 01-upload-resume@desktop.html`: the same structure, the same `hc-*` classes.
 * The stylesheet is that file's own, imported by globals.css.
 *
 * Which blocks appear, in what order, and every word they say come from the
 * scenario (web/scenarios/<id>.json `landing.blocks`, web/content/strings),
 * resolved on the server — see lib/hirecute/landing-content.mjs. This file is
 * the shell: nav, footer, and the upload logic every block's buttons share.
 *
 * Auto-apply claims are NOT made unconditionally: a string that only holds
 * while submission is enabled is a launch-profile variant in content, and the
 * server picks the variant (04-coding-agent-brief.md: "For the activation
 * pilot, 'Auto-apply to up to 100 jobs daily' must become
 * preparation/assistance copy"). The vacancy hero repeats production's
 * headline verbatim; that is a product decision recorded in its content file.
 */

import { useRef, useState } from "react";
import type { LandingContent } from "@/lib/hirecute/landing-content.mjs";
import { LANDING_BLOCKS } from "./landing/blocks";
import { list, t } from "./landing/strings";
import type { LandingActions, LinkItem } from "./landing/types";

function BrandMark() {
  return (
    <svg
      className="hc-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3Z" />
    </svg>
  );
}

export function Landing({
  content,
  maxUploadBytes,
  onUpload,
  onSample,
  error,
}: {
  content: LandingContent;
  maxUploadBytes: number;
  onUpload: (file: File) => void;
  onSample: () => void;
  error?: string | null;
}) {
  const s = content.strings;
  const inputRef = useRef<HTMLInputElement>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const maxMb = Math.floor(maxUploadBytes / 1024 / 1024);

  /** Client-side validation. The server re-checks the ACTUAL file bytes. */
  function acceptFile(file: File | undefined) {
    setLocalError(null);
    if (!file) return;
    if (!/\.(pdf|docx)$/i.test(file.name)) {
      setLocalError(t(s, "upload.error.type"));
      return;
    }
    if (file.size === 0) {
      setLocalError(t(s, "upload.error.empty"));
      return;
    }
    if (file.size > maxUploadBytes) {
      setLocalError(t(s, "upload.error.size", { maxMb }));
      return;
    }
    onUpload(file);
  }

  const actions: LandingActions = {
    chooseFile: () => inputRef.current?.click(),
    startSample: onSample,
    acceptFile,
    inputRef,
    error: error ?? localError,
    maxMb,
  };

  return (
    <main className="hc-landing" data-scenario={content.scenario}>
      <header className="hc-nav">
        <a className="hc-brand" href="#top">
          <BrandMark />
          <span>{t(s, "brand")}</span>
        </a>
        <nav className="hc-navlinks">
          {/*
            A null href renders hrefless, as the reference's "Your privacy"
            does: the disclosure it targeted was removed, and a live link to a
            missing anchor is worse than the prototype's placeholder. The
            reference's "Sign in" is not rendered at all (§3): no accounts.
          */}
          {list<LinkItem>(s, "nav.links").map((link) => (
            <a key={link.label} href={link.href ?? undefined}>
              {link.label}
            </a>
          ))}
        </nav>
      </header>

      {content.blocks.map((config) => {
        const Block = LANDING_BLOCKS[config.block];
        return Block ? <Block key={config.block} s={s} config={config} actions={actions} /> : null;
      })}

      <footer className="hc-land-footer">
        <a className="hc-brand" href="#top">
          <BrandMark />
          <span>{t(s, "brand")}</span>
        </a>
        <p>{t(s, "footer.tagline")}</p>
        <nav>
          {list<LinkItem>(s, "footer.links").map((link) => (
            <a key={link.label} href={link.href ?? undefined}>
              {link.label}
            </a>
          ))}
        </nav>
        <span className="hc-land-copyright">{t(s, "footer.copyright")}</span>
      </footer>
    </main>
  );
}
