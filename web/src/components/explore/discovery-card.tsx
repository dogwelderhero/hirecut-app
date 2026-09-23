"use client";

import { useMemo, useState } from "react";
import { ExternalLink, Plus, Check, Loader2, ShieldQuestion, Sparkles, Coins } from "lucide-react";
import { cn } from "@/lib/cn";
import { GeistSans } from "@/lib/fonts";
import { ATS_LABEL, type AtsSource, type DiscoveredOffer } from "@/lib/explore";
import { useJobs } from "@/components/jobs/job-store";
import { useExplore } from "./explore-provider";

function freshness(postedAt: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(postedAt)) return "";
  const days = Math.max(0, Math.round((Date.now() - new Date(postedAt + "T00:00:00Z").getTime()) / 86_400_000));
  return days === 0 ? "today" : days === 1 ? "1d ago" : `${days}d ago`;
}

// Real company logo (favicon) via the localhost proxy, cached on disk FOREVER per
// company — so once it resolves it's instant for this card AND every other card,
// this search or any future one. Falls back to a monogram on miss.
function Logo({ company }: { company: string }) {
  const [failed, setFailed] = useState(false);
  const letter = (company || "?").trim().charAt(0).toUpperCase();
  if (failed || !company.trim()) {
    return <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-sm font-semibold text-primary">{letter}</div>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/logo?company=${encodeURIComponent(company)}`}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className="size-9 shrink-0 rounded-lg border border-border bg-card object-contain p-1"
    />
  );
}

// What a running worker is doing on this exact posting → the live CTA label.
const WORKER_LABEL: Record<string, string> = { evaluate: "Evaluating…", pdf: "Preparing CV…", research: "Researching…", apply: "Filling…" };

export function DiscoveryCard({ offer, inPipeline, evaluatedN }: { offer: DiscoveredOffer; inPipeline: boolean; evaluatedN?: string }) {
  const { added, adding, addToPipeline } = useExplore();
  const { jobs, startJob } = useJobs();

  // GLOBAL worker awareness: any worker acting on this URL drives the CTA, here
  // and on every other surface that renders this offer (the jobs store is global).
  const job = useMemo(
    () => jobs.filter((j) => j.input === offer.url).sort((a, b) => b.startedAt - a.startedAt)[0],
    [jobs, offer.url],
  );
  const working = job?.status === "running";
  const doneEval = job?.status === "done" && job.kind === "evaluate";
  const statusLabel = WORKER_LABEL[job?.kind ?? ""] ?? "Working…";

  const isAdded = added.has(offer.url) || inPipeline || working || doneEval;
  const isAdding = adding.has(offer.url);
  const unverified = offer.verification === "unconfirmed";
  const fresh = freshness(offer.postedAt) || offer.postedHint || "";

  const evaluate = () => {
    addToPipeline([offer]); // evaluating implies it's in the pipeline — record it
    startJob({ title: `Evaluate · ${offer.company}`, subtitle: offer.title, kind: "evaluate", input: offer.url, page: "/explore" });
  };

  return (
    <div className="co-rise group flex min-w-0 flex-col gap-2.5 rounded-xl border border-border bg-card/40 p-3.5 text-left transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-sm">
      <div className="flex items-start gap-3">
        <Logo company={offer.company} />
        <a href={offer.url} target="_blank" rel="noopener noreferrer" className="block min-w-0 flex-1 max-sm:min-h-[44px]">
          <h3 className={`${GeistSans.className} truncate text-[17px] leading-tight text-foreground transition-colors group-hover:text-primary`}>{offer.title}</h3>
          <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
            {offer.company}
            {offer.location && <span className="text-muted-foreground"> · {offer.location}</span>}
          </p>
        </a>
        <a
          href={offer.url}
          target="_blank"
          rel="noopener noreferrer"
          title="Open the posting"
          aria-label="Open the posting"
          className="-m-1 inline-flex shrink-0 items-center justify-center rounded p-1 text-muted-foreground transition-colors hover:text-foreground max-sm:min-h-[44px] max-sm:min-w-[44px]"
        >
          <ExternalLink className="size-4" />
        </a>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="rounded border border-border px-1.5 py-0.5 font-medium text-muted-foreground">{ATS_LABEL[offer.ats as AtsSource] ?? offer.ats}</span>
        {fresh && <span className="text-muted-foreground">{fresh}</span>}
        {unverified && (
          <span
            className="inline-flex items-center gap-1 rounded border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 font-medium text-amber-600 dark:text-amber-300"
            title="Found by AI on the public web — we can't confirm it's still live without opening it. Evaluating runs a real browser check and sets the verdict."
          >
            <ShieldQuestion className="size-3" /> unverified
          </span>
        )}
        {offer.matchedKeyword && (
          <span className="text-muted-foreground" title="Keyword match — not yet scored. Evaluate to get an A–F fit score.">
            · matched <span className="text-primary/80">{offer.matchedKeyword}</span>
          </span>
        )}
      </div>

      {offer.why && (
        <p className="flex items-start gap-1.5 text-[12px] leading-snug text-primary/80">
          <Sparkles className="mt-0.5 size-3 shrink-0" />
          {offer.why}
        </p>
      )}

      <div className="mt-0.5">
        {evaluatedN || doneEval ? (
          <a
            href={evaluatedN ? `/pipeline/${evaluatedN}` : job ? `/jobs/${job.id}` : "/pipeline"}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-accent px-2.5 py-2 text-xs font-medium text-primary max-sm:min-h-[44px]"
          >
            <Check className="size-3.5" /> Evaluated · view report
          </a>
        ) : working ? (
          <div className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-primary/30 bg-accent/60 px-2.5 py-2 text-xs font-medium text-primary">
            <Loader2 className="size-3.5 animate-spin" />
            {statusLabel}
            <span className="text-primary/60">· in pipeline</span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isAdded || isAdding}
              onClick={() => addToPipeline([offer])}
              className={cn(
                "inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-2 text-xs font-medium transition-colors max-sm:min-h-[44px]",
                isAdded ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-accent text-foreground hover:bg-accent hover:text-primary",
              )}
            >
              {isAdding ? <Loader2 className="size-3.5 animate-spin" /> : isAdded ? <Check className="size-3.5" /> : <Plus className="size-3.5" />}
              {isAdded ? "In pipeline" : "Add to pipeline"}
            </button>
            <button
              type="button"
              onClick={evaluate}
              title={unverified ? "Runs a real evaluation — and verifies the posting is live. Uses tokens." : "Runs a real A–F evaluation. Uses tokens."}
              className="inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-primary/30 px-2.5 py-2 text-xs font-medium text-primary transition-colors hover:bg-accent max-sm:min-h-[44px]"
            >
              Evaluate <Coins className="size-3.5 opacity-80" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
