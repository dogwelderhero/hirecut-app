/**
 * Letter draft isolation.
 *
 * 02-screen-guide.md §7 "Letter streaming and edit isolation". Each letter is
 * keyed by job ID + generation, never by array index, company name, or the
 * currently selected card — two requisitions at one employer need separate
 * drafts, and a delta for job A must never land in job B's panel.
 *
 * The invariant that needs code rather than care: once the visitor edits, an
 * older model generation cannot overwrite their text.
 */

import type { JobId, LetterGenerationId, LetterRevision, PublicError, Version } from "./contracts";

export interface LetterView {
  jobId: JobId;
  generationId: LetterGenerationId | null;
  /** Text accumulated from the current generation's deltas. */
  receivedText: string;
  serverVersion: Version;
  /** Present only while the visitor has uncommitted local edits. */
  editingText?: string;
  dirty: boolean;
  streaming: boolean;
  error: PublicError | null;
}

export type LetterMap = Record<JobId, LetterView>;

export function emptyLetter(jobId: JobId): LetterView {
  return {
    jobId,
    generationId: null,
    receivedText: "",
    serverVersion: 0,
    dirty: false,
    streaming: false,
    error: null,
  };
}

/** The text to render/edit: the visitor's version wins whenever it exists. */
export function displayText(view: LetterView | undefined): string {
  if (!view) return "";
  return view.dirty && view.editingText !== undefined ? view.editingText : view.receivedText;
}

export function letterStarted(
  map: LetterMap,
  jobId: JobId,
  generationId: LetterGenerationId,
): LetterMap {
  const prev = map[jobId] ?? emptyLetter(jobId);
  // A new generation starts from empty received text, but a dirty local edit is
  // preserved: regeneration must not silently discard the visitor's work.
  return {
    ...map,
    [jobId]: { ...prev, generationId, receivedText: "", streaming: true, error: null },
  };
}

export function letterDelta(
  map: LetterMap,
  jobId: JobId,
  generationId: LetterGenerationId,
  text: string,
): LetterMap {
  const prev = map[jobId];
  // A delta with no started generation, or from a superseded generation, is
  // dropped. This is what stops a late chunk from a previous job's stream.
  if (!prev || prev.generationId !== generationId) return map;
  return { ...map, [jobId]: { ...prev, receivedText: prev.receivedText + text } };
}

export function letterCompleted(
  map: LetterMap,
  jobId: JobId,
  generationId: LetterGenerationId,
  revision: LetterRevision,
): LetterMap {
  const prev = map[jobId];
  if (!prev || prev.generationId !== generationId) return map;
  // The visitor's edit outranks the finishing generation. Their text stays in
  // the editor and stays dirty; only the server version advances so a
  // subsequent save carries the right expected version.
  if (prev.dirty) {
    return { ...map, [jobId]: { ...prev, streaming: false, serverVersion: revision.version } };
  }
  return {
    ...map,
    [jobId]: {
      ...prev,
      receivedText: revision.text,
      serverVersion: revision.version,
      streaming: false,
    },
  };
}

export function letterErrored(
  map: LetterMap,
  jobId: JobId,
  generationId: LetterGenerationId,
  error: PublicError,
): LetterMap {
  const prev = map[jobId];
  if (!prev || prev.generationId !== generationId) return map;
  return { ...map, [jobId]: { ...prev, streaming: false, error } };
}

/** Local editing. Survives card switches, modal open/close and refresh. */
export function editLetter(map: LetterMap, jobId: JobId, text: string): LetterMap {
  const prev = map[jobId] ?? emptyLetter(jobId);
  return { ...map, [jobId]: { ...prev, editingText: text, dirty: true } };
}

/** A successful PATCH: the visitor's text becomes the committed revision. */
export function letterSaved(map: LetterMap, jobId: JobId, revision: LetterRevision): LetterMap {
  const prev = map[jobId] ?? emptyLetter(jobId);
  return {
    ...map,
    [jobId]: {
      ...prev,
      receivedText: revision.text,
      serverVersion: revision.version,
      editingText: undefined,
      dirty: false,
      error: null,
    },
  };
}

/**
 * A save rejected on version conflict. The visitor's text is retained and
 * surfaced inline for reconciliation rather than silently replaced
 * (§7: "retain local text, and reconcile rather than silently replacing it").
 */
export function letterSaveConflict(
  map: LetterMap,
  jobId: JobId,
  serverRevision: LetterRevision,
  error: PublicError,
): LetterMap {
  const prev = map[jobId] ?? emptyLetter(jobId);
  return {
    ...map,
    [jobId]: {
      ...prev,
      receivedText: serverRevision.text,
      serverVersion: serverRevision.version,
      dirty: true,
      error,
    },
  };
}
