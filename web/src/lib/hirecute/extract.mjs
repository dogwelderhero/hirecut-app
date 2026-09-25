/**
 * Bounded resume text extraction — plain ESM so the worker can import it.
 *
 * 02-screen-guide.md §4: the first action, "Reading your resume", completes
 * only when "Extraction produced nonempty usable text". §3 adds that an
 * image-only or empty document must produce "a recoverable inline request for a
 * text-based file/pasted text, not a fake profile".
 *
 * So this module's contract is that it either returns usable text or says
 * precisely why it could not. It never returns a plausible-looking empty
 * profile, and it never guesses.
 *
 * `intake.mjs` upstream shells out to Poppler's `pdftotext` and puts .docx
 * explicitly out of scope, so it is not reusable here: a server cannot depend
 * on an operator having Poppler installed, and DOCX is half the uploads.
 */

import mammoth from "mammoth";

/** Hard ceilings. A 10 MB PDF of scanned images must not become a huge job. */
export const EXTRACT_LIMITS = {
  maxPages: 12,
  maxChars: 120_000,
  /** Below this, a "text" layer is almost certainly page furniture. */
  minUsableChars: 200,
};

/**
 * @typedef {{ok: true, text: string, pages: number, truncated: boolean}} ExtractOk
 * @typedef {{ok: false, reason: "image_only"|"empty"|"unreadable"|"unsupported", detail: string}} ExtractFail
 */

/** PDF magic bytes, not the file name. */
export function sniffKind(bytes) {
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  // DOCX is a ZIP container: PK\x03\x04.
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) return "docx";
  if (bytes.length > 0) return "text";
  return null;
}

/** Collapse the whitespace a PDF text layer produces without losing structure. */
function normalize(text) {
  return text
    .replace(/\r\n?/g, "\n")
    // Non-breaking and zero-width characters come through PDF extraction often.
    .replace(/[ ​-‍﻿]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractPdf(bytes) {
  // The legacy build is the one that runs under Node without a DOM.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  let doc;
  try {
    doc = await pdfjs.getDocument({
      data: new Uint8Array(bytes),
      // A resume needs no external resources, and fetching them from an
      // untrusted upload would be a server-side request we never want.
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
    }).promise;
  } catch (err) {
    return {
      ok: false,
      reason: "unreadable",
      detail: err instanceof Error ? err.message : "could not open the PDF",
    };
  }

  const pageCount = doc.numPages;
  const pages = Math.min(pageCount, EXTRACT_LIMITS.maxPages);
  const chunks = [];
  try {
    for (let i = 1; i <= pages; i += 1) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      // `items` carry positioned glyph runs; joining with spaces and letting
      // normalize() collapse them preserves reading order without inventing
      // line structure that is not in the document.
      chunks.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
      if (chunks.join("").length > EXTRACT_LIMITS.maxChars) break;
    }
  } finally {
    await doc.destroy?.();
  }

  const text = normalize(chunks.join("\n"));
  if (text.length < EXTRACT_LIMITS.minUsableChars) {
    // A PDF that opens cleanly but yields almost no text is a scan or an
    // image export. OCR is explicitly not a launch dependency, so we ask.
    return {
      ok: false,
      reason: "image_only",
      detail: "This PDF has no text layer — it looks like a scan or an image export.",
    };
  }
  return {
    ok: true,
    text: text.slice(0, EXTRACT_LIMITS.maxChars),
    pages: pageCount,
    truncated: pageCount > pages || text.length > EXTRACT_LIMITS.maxChars,
  };
}

async function extractDocx(bytes) {
  try {
    const result = await mammoth.extractRawText({ buffer: bytes });
    const text = normalize(result.value ?? "");
    if (text.length < EXTRACT_LIMITS.minUsableChars) {
      return {
        ok: false,
        reason: "empty",
        detail: "That document has almost no text in it.",
      };
    }
    return {
      ok: true,
      text: text.slice(0, EXTRACT_LIMITS.maxChars),
      pages: 0,
      truncated: text.length > EXTRACT_LIMITS.maxChars,
    };
  } catch (err) {
    return {
      ok: false,
      reason: "unreadable",
      detail: err instanceof Error ? err.message : "could not read the document",
    };
  }
}

/**
 * Extract text from resume bytes.
 *
 * @param {Buffer} bytes
 * @returns {Promise<ExtractOk|ExtractFail>}
 */
export async function extractResumeText(bytes) {
  const kind = sniffKind(bytes);
  if (kind === "pdf") return extractPdf(bytes);
  if (kind === "docx") return extractDocx(bytes);
  if (kind === "text") {
    // The pasted-text recovery path stores UTF-8 directly.
    const text = normalize(bytes.toString("utf8"));
    if (text.length < EXTRACT_LIMITS.minUsableChars) {
      return { ok: false, reason: "empty", detail: "That text is too short to work from." };
    }
    return { ok: true, text: text.slice(0, EXTRACT_LIMITS.maxChars), pages: 0, truncated: false };
  }
  return { ok: false, reason: "unsupported", detail: "That file type is not a PDF or DOCX." };
}

/** Visitor-facing copy for a failure. Concrete, and always offers a way out. */
export function extractionMessage(reason) {
  switch (reason) {
    case "image_only":
      return "We could not read any text from that PDF — it looks like a scan. Upload a text-based PDF or DOCX, or paste your resume text instead.";
    case "empty":
      return "That file has almost no text in it. Upload a different file, or paste your resume text instead.";
    case "unsupported":
      return "That file is not a PDF or DOCX. Upload one of those, or paste your resume text instead.";
    default:
      return "We could not read that file. Upload a different one, or paste your resume text instead.";
  }
}
