/**
 * POST /api/hirecute/runs/current/resume/accept — "Accept changes".
 *
 * Records which recommendations the visitor applied and which items they
 * unchecked on the review step. The tailored CVs built in Bulk Apply use
 * exactly that resume, and nothing else.
 *
 * Refuses an unknown recommendation ID rather than dropping it, so what the
 * visitor saw applied is what the server stores. Accepting twice returns the
 * first acceptance: CVs may already have been built from it.
 */

import { badRequest, json, notFound, readJson, requireSameOrigin, stringArray } from "@/lib/hirecute/http";
import { currentRunFor } from "@/lib/hirecute/runs";
import { currentSession } from "@/lib/hirecute/session";
import { appendEvent, readRunFile } from "@/lib/hirecute/store";
import { itemPaths } from "@/lib/hirecute/resume.mjs";

export async function POST(request: Request) {
  const blocked = requireSameOrigin(request);
  if (blocked) return blocked;

  const session = await currentSession();
  const file = await currentRunFor(session);
  if (!file) return notFound();

  const refine = file.snapshot.stages.refine?.result;
  // Only the sectioned (recruiter) refine has recommendations to accept.
  if (refine?.kind !== "refine" || !("resume" in refine)) {
    return badRequest("Your resume is not ready to accept yet.");
  }

  if (file.snapshot.resumeAcceptance) {
    return json({ acceptance: file.snapshot.resumeAcceptance });
  }

  const body = await readJson<{ appliedRecommendationIds?: unknown; excludedItems?: unknown }>(request);
  const ids = stringArray(body?.appliedRecommendationIds ?? [], 50);
  const excluded = stringArray(body?.excludedItems ?? [], 500);
  if (ids === null || excluded === null) return badRequest("Those changes could not be read.");

  const known = new Set(refine.recommendations.map((r) => r.id));
  if (ids.some((id) => !known.has(id))) return badRequest("One of those changes is no longer available.");
  if (new Set(ids).size !== ids.length) return badRequest("Duplicate changes in the request.");

  // Paths are checked against the resume as read: a path that names nothing
  // would be a silent no-op, and the visitor's view must match what is stored.
  const paths = new Set(itemPaths(refine.resume));
  if (excluded.some((p) => !paths.has(p))) return badRequest("One of those items is no longer available.");

  const acceptance = {
    appliedRecommendationIds: ids,
    excludedItems: [...new Set(excluded)],
    acceptedAt: new Date().toISOString(),
  };
  await appendEvent(file.snapshot.id, "resume.accepted", { acceptance });

  const after = await readRunFile(file.snapshot.id);
  return json({ acceptance: after?.snapshot.resumeAcceptance ?? acceptance });
}
