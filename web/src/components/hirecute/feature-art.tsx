/**
 * The six hand-drawn feature illustrations from screen 01, lifted verbatim
 * from `01-upload-resume@desktop.html`. `hc-feature-art` and the
 * `hc-art-paper/ink/white/accent` fill classes were already in the design
 * system CSS — only this markup was missing, so every card rendered with an
 * empty gap where its artwork belongs.
 *
 * Keyed by card title so the grid stays declarative.
 */

export const FEATURE_ART: Record<string, React.ReactNode> = {
  "Auto-apply to jobs": (
    <div className="hc-feature-illustration">
      <svg className="hc-feature-art" viewBox="0 0 140 110" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 69C3 45 22 14 53 16M26 78c10 22 51 26 71 10" strokeDasharray="3 5"/><path d="m49 10 7 6-9 4M95 83l3 6-7 4"/><g transform="rotate(-9 62 54)"><rect x="33" y="27" width="59" height="51" rx="5" className="hc-art-paper"/><circle cx="45" cy="41" r="4"/><path d="M57 38h23M57 44h17M43 57h37M43 64h25"/></g><circle cx="98" cy="77" r="13" className="hc-art-ink"/><path d="m92 77 4 4 8-9" className="hc-art-white"/><path d="m90 18 30-6-9 30-9-14-12-10Zm12 10 18-16" className="hc-art-accent"/><path d="m24 26-5-4m6 14-7 1m88 16 5 3"/></svg>
    </div>
  ),
  "Smart resume optimization": (
    <div className="hc-feature-illustration">
      <svg className="hc-feature-art" viewBox="0 0 140 110" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m33 23-12 2 8 68 55-7"/><g transform="rotate(-7 60 52)"><rect x="33" y="15" width="58" height="72" rx="2" className="hc-art-paper"/><rect x="44" y="24" width="18" height="20" rx="1"/><circle cx="53" cy="31" r="3"/><path d="M47 41c0-8 12-8 12 0M68 28h13M68 34h9M44 53h35M44 59h30M44 65h35M44 71h17"/></g><circle cx="94" cy="73" r="18" className="hc-art-ink"/><path d="m85 72 6 7 13-17" className="hc-art-white" strokeWidth="3"/><path d="m113 89 5 5m-14-1 2 7m12-17 7 1" className="hc-art-accent"/></svg>
    </div>
  ),
  "AI cover letters": (
    <div className="hc-feature-illustration">
      <svg className="hc-feature-art" viewBox="0 0 140 110" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m24 46 43-29 43 29v49H24V46Z"/><path d="M36 59V20h44l15 15v24" className="hc-art-paper"/><path d="M80 20v15h15M47 33h18M47 44h37M47 52h30M47 60h21"/><path d="m24 46 43 30 43-30M24 95l32-28m54 28L78 67"/><path d="M113 16c0 8-4 12-12 12 8 0 12 4 12 12 0-8 4-12 12-12-8 0-12-4-12-12Z" className="hc-art-accent"/><path d="m15 66-5-1m5 11-5 2"/></svg>
    </div>
  ),
  "AI resume tailor": (
    <div className="hc-feature-illustration">
      <svg className="hc-feature-art" viewBox="0 0 140 110" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="50" y="9" width="35" height="39" rx="3" className="hc-art-paper"/><path d="M59 19h17M59 25h12M59 31h17M68 49v10M35 67v-8h64v8"/><rect x="17" y="68" width="37" height="34" rx="3" className="hc-art-paper"/><rect x="80" y="68" width="37" height="34" rx="3" className="hc-art-paper"/><path d="M26 78h19M26 84h12M26 90h16M89 78h19M89 84h13M89 90h16"/><circle cx="108" cy="64" r="11" className="hc-art-ink"/><path d="m103 64 4 4 6-8" className="hc-art-white"/><path d="m30 25 6 3m-10 5h9m73-8-5 4m9 6h-7" className="hc-art-accent"/></svg>
    </div>
  ),
  "Set your match threshold": (
    <div className="hc-feature-illustration">
      <svg className="hc-feature-art" viewBox="0 0 140 110" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M29 59a40 40 0 0 1 80 0M34 58a35 35 0 0 1 70 0"/><path d="M69 19v7M41 31l5 5M29 59h7M97 31l-5 5M109 59h-7"/><path d="m69 59 23-26-17 31Z" className="hc-art-ink"/><circle cx="69" cy="59" r="6" className="hc-art-paper"/><path d="M34 83h73M34 99h73"/><path d="M34 83h47M34 99h21" className="hc-art-accent" strokeWidth="3"/><circle cx="81" cy="83" r="6" className="hc-art-paper"/><circle cx="55" cy="99" r="6" className="hc-art-ink"/><path d="m118 24 4-5m-1 13 7-1"/></svg>
    </div>
  ),
  "Job application tracker": (
    <div className="hc-feature-illustration">
      <svg className="hc-feature-art" viewBox="0 0 140 110" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="16" y="22" width="106" height="70" rx="6" className="hc-art-paper"/><path d="M16 39h106M51 39v53M87 39v53"/><path d="M25 31h15M60 31h17M96 31h16"/><rect x="24" y="48" width="19" height="15" rx="2"/><rect x="24" y="70" width="19" height="13" rx="2"/><rect x="59" y="48" width="20" height="23" rx="2" className="hc-art-tint"/><path d="M64 55h10M64 61h6"/><circle cx="104" cy="60" r="10" className="hc-art-ink"/><path d="m99 60 3 3 6-7" className="hc-art-white"/><path d="m103 12 2-6m8 10 6-4M20 100h24m44 0h22" className="hc-art-accent"/></svg>
    </div>
  ),
};
