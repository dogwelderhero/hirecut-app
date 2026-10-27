/** Types for `resume.mjs`. */
export type ResumeSectionKey =
  | "contact"
  | "targetTitle"
  | "summary"
  | "experience"
  | "education"
  | "skills"
  | "certifications"
  | "awards"
  | "projects"
  | "volunteering"
  | "publications";

export interface ResumeDocument {
  contact: {
    name?: string;
    email?: string;
    phone?: string;
    location?: string;
    links?: Array<{ label?: string; url: string }>;
  };
  targetTitle: string;
  summary: string;
  experience: Array<{ role?: string; company?: string; location?: string; dates?: string; bullets?: string[] }>;
  education: Array<{ title?: string; org?: string; location?: string; year?: string; description?: string }>;
  skills: Array<{ category?: string; items: string[] }>;
  interests: string[];
  certifications: Array<{ title?: string; org?: string; year?: string }>;
  awards: Array<{ title?: string; org?: string; year?: string; description?: string }>;
  projects: Array<{ name?: string; description?: string; tech?: string; bullets?: string[] }>;
  volunteering: Array<{ role?: string; org?: string; dates?: string; bullets?: string[] }>;
  publications: Array<{ title?: string; venue?: string; year?: string; description?: string }>;
}

export interface ResumeRecommendation {
  id: string;
  section: ResumeSectionKey;
  kind: "clarity" | "structure" | "formatting" | "relevance";
  /** Short button text. */
  label: string;
  explanation: string;
  /** Exact text already in the section; "" only to fill an empty summary/target title. */
  before: string;
  after: string;
  /** Gap IDs (from the job matching step) this change answers; absent for general edits. */
  gapIds?: string[];
}

export const RESUME_SECTIONS: ReadonlyArray<{ key: ResumeSectionKey; label: string }>;
export const SECTION_KEYS: ResumeSectionKey[];
export function normalizeResume(raw: unknown): ResumeDocument;
export function isSectionEmpty(resume: ResumeDocument, key: ResumeSectionKey): boolean;
export function sectionText(resume: ResumeDocument, key: ResumeSectionKey): string;
export function resumeText(resume: ResumeDocument): string;
export function applyRecommendation(resume: ResumeDocument, rec: ResumeRecommendation): ResumeDocument | null;
export function applyRecommendations(
  resume: ResumeDocument,
  recommendations: ResumeRecommendation[],
  appliedIds: string[],
): ResumeDocument;
export function toCvPayload(resume: ResumeDocument): Record<string, unknown>;

export interface ResumeNode {
  path: string;
  text: string;
  meta?: string;
  children?: ResumeNode[];
}
export function sectionNodes(resume: ResumeDocument, key: ResumeSectionKey): ResumeNode[];
export function itemPaths(resume: ResumeDocument): string[];
export function isExcluded(excluded: string[] | Set<string>, path: string): boolean;
export function toggleExclusion(excluded: string[], path: string): string[];
export function excludeItems(resume: ResumeDocument, excluded: string[]): ResumeDocument;
export function acceptedResume(
  resume: ResumeDocument,
  recommendations: ResumeRecommendation[],
  acceptance: { appliedRecommendationIds: string[]; excludedItems?: string[] } | null | undefined,
): ResumeDocument;
