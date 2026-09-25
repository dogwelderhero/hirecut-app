/**
 * PROPOSED NEW HIRECUTE TYPE SPECIFICATION — not an upstream API or implementation.
 * Companion: 01-architecture.md. No functions, validation library, storage engine,
 * Stripe SDK, worker, or network implementation is supplied by this file.
 *
 * Runtime boundaries MUST validate unknown JSON against these contracts. TypeScript
 * types alone cannot validate an upload, prove ownership, enforce numeric ranges,
 * sanitize text, establish factual support, or grant permission to submit.
 *
 * Shared invariants:
 * - IDs are server-generated opaque identifiers, never filesystem paths.
 * - Every browser route resolves session ownership from its HttpOnly cookie.
 * - No raw model reasoning, prompts, diagnostics, PAN/CVC, or client secret appears
 *   in persisted models/events. Only BillingSetupResponse carries a transient secret.
 * - Unknown is not false, zero, empty text, or an inferred affirmative answer.
 * - Preparation, card activation, application approval, and delivery are separate.
 * - Parent serializes result/event writes. Child workers receive immutable codeRoot
 *   and dataRoot context; scripts run from codeRoot with CAREER_OPS_ROOT=dataRoot
 *   and explicit CAREER_OPS_TRACKER=dataRoot/data/applications.md. Seed its empty
 *   valid tracker header. Never mutate shared parent process.env per visitor.
 */

export type RunId = string;
export type SessionId = string;
export type JobId = string;
export type FactId = string;
export type ArtifactId = string;
export type EvidenceId = string;
export type ActionId = string;
export type LetterGenerationId = string;
export type ApprovalId = string;
export type SubmissionAttemptId = string;
export type ISODateTime = string; // Runtime: valid UTC ISO 8601 instant.
export type ISODate = string; // Runtime: valid YYYY-MM-DD calendar date.
export type ContentHash = string; // Hash of canonicalized content; not user-supplied.
export type Version = number; // Runtime: positive integer; server increments on mutation.
export type Sequence = number; // Runtime: nonnegative integer, monotonic within one run.
export type HttpsUrl = string; // Runtime: approved HTTPS URL, no arbitrary server fetch.

export type StageId = "refine" | "explore" | "match" | "prepare";
export type ScreenId = "upload" | "refine" | "explore" | "matches" | "bulk_apply" | "checkout";
export type LaunchProfile = "activation_pilot" | "auto_apply_pilot";
export type RunOrigin = "uploaded_resume" | "pasted_resume" | "sample";

/** Server/worker only; never accept these paths or IDs as caller authority. */
export interface RunContext {
  runId: RunId;
  ownerSessionId: SessionId;
  codeRoot: string;
  dataRoot: string;
  journeyVersion: Version;
  sourceResumeHash: ContentHash | null;
  deadline: ISODateTime;
}

export type Known<T> = { status: "known"; value: T; evidenceIds: EvidenceId[] };
export type UnknownValue = {
  status: "unknown";
  value: null;
  reason: "not_provided" | "not_listed" | "not_verified" | "conflicting_sources";
};
export type Knowledge<T> = Known<T> | UnknownValue;

/** Server preserves the original source; generated artifacts are never new facts. */
export interface Evidence {
  id: EvidenceId;
  source: "resume_upload" | "candidate_confirmation" | "job_posting" | "public_company_page";
  sourceArtifactId: ArtifactId | null;
  sourceUrl: HttpsUrl | null;
  quote: string;
  capturedAt: ISODateTime;
  sourceHash: ContentHash;
}

export interface ResumeFact {
  id: FactId;
  kind: "identity" | "employment" | "education" | "skill" | "achievement" | "project" | "certification";
  text: string;
  evidenceIds: EvidenceId[]; // Nonempty; exact original support, not model recollection.
}

export interface CandidateProfile {
  fullName: Knowledge<string>;
  email: Knowledge<string>;
  phone: Knowledge<string>;
  location: Knowledge<string>;
  linkedInUrl: Knowledge<HttpsUrl>;
  portfolioUrl: Knowledge<HttpsUrl>;
  authorizedCountries: Knowledge<string[]>;
  needsSponsorship: Knowledge<boolean>; // Missing evidence MUST NOT become false.
  facts: ResumeFact[];
  sourceResumeArtifactId: ArtifactId;
  sourceResumeHash: ContentHash;
  version: Version;
}

export interface SearchPreferences {
  targetRoles: string[];
  locations: string[];
  workStyles: Array<"remote" | "hybrid" | "onsite">;
  origin: "suggested_from_resume" | "confirmed_by_candidate";
  version: Version;
  // Empty arrays mean unspecified; do not infer "authorized anywhere".
}

export interface RefinementChange {
  id: string;
  kind: "clarity" | "structure" | "formatting" | "relevance";
  before: string;
  after: string;
  explanation: string;
  sourceFactIds: FactId[];
  // Runtime rejects new employers, dates, degrees, metrics, or skills without support.
}

export interface ArtifactMetadata {
  id: ArtifactId;
  kind: "original_resume" | "base_resume" | "tailored_resume" | "cover_letter" | "job_description" | "submission_confirmation";
  mimeType: "application/pdf" | "image/png" | "text/plain" | "text/markdown" | "application/json" | "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  displayName: string;
  byteLength: number;
  contentHash: ContentHash;
  createdAt: ISODateTime;
  // Downloads use /api/hirecute/artifacts/:id. No internal path in public metadata.
}

export interface JobSource {
  provider: "greenhouse" | "lever" | "ashby" | "workday" | "other_public_ats";
  providerJobId: string | null;
  canonicalPostingUrl: HttpsUrl;
  applicationUrl: HttpsUrl | null;
  fetchedAt: ISODateTime;
  postingContentHash: ContentHash;
  liveStatus: "open" | "closed" | "unverified";
  verifiedAt: ISODateTime | null;
}

export interface SalaryRange {
  min: number | null;
  max: number | null;
  currency: string | null;
  period: "hour" | "month" | "year" | "unknown";
  advertisedText: string;
  evidenceIds: EvidenceId[];
  // No conversion to annual/base salary unless its source interval is established.
}

export type Recruiter =
  | {
      status: "identified";
      name: Knowledge<string>;
      title: Knowledge<string>;
      email: Knowledge<string>;
      company: string;
      // At least name or email must be known. Never invent a masked address.
    }
  | {
      status: "unknown";
      company: string;
      displayName: string; // Deterministic "Hiring team · {company}".
      email: null;
      reason: "contact_not_listed" | "contact_not_verified";
    };

export interface Job {
  id: JobId;
  company: string;
  title: string;
  source: JobSource;
  location: string | null;
  workStyle: "remote" | "hybrid" | "onsite" | null;
  employmentType: "full_time" | "part_time" | "contract" | "internship" | "other" | null;
  seniority: string | null;
  experienceYearsMin: number | null;
  postedAt: ISODateTime | ISODate | null;
  salary: SalaryRange | null;
  descriptionArtifactId: ArtifactId | null;
  descriptionStatus: "full" | "partial" | "missing";
  recruiter: Recruiter;
  evidenceIds: EvidenceId[];
  // Applicant count, alumni, valuation, and funding badges are absent unless a
  // later explicit source-backed extension adds them. FoundAt is not PostedAt.
}

export interface SearchCoverage {
  status: "complete_within_scope" | "partial" | "failed";
  boardsAttempted: number;
  boardsSucceeded: number;
  boardsFailed: number;
  availableCompanies: number | null;
  capHit: boolean;
  staleDataset: boolean;
  stoppedByOutage: boolean;
  undatedPostingsDropped: number;
  jobsFound: number;
  jobsRetained: number;
  scopeDescription: string; // E.g. "60 configured boards", never "all jobs".
  warnings: string[];
}

export type RequirementMatch = "strong" | "partial" | "missing" | "not_applicable";
export interface MatchEvidence {
  requirement: string;
  jobEvidenceIds: EvidenceId[];
  candidateFactIds: FactId[];
  match: RequirementMatch;
  explanation: string;
}

export interface EligibilityBlocker {
  code: "work_authorization" | "location" | "required_qualification" | "posting_closed" | "other";
  description: string;
  evidenceIds: EvidenceId[];
  certainty: "confirmed_blocker" | "needs_candidate_input";
}

export interface MatchAssessment {
  jobId: JobId;
  score5: number; // Runtime: finite 1..5, at most one decimal; one canonical score.
  confidence: "low" | "medium" | "high";
  recommendation: "apply" | "consider" | "research_first" | "skip";
  workAuthorization: "sponsors" | "not_needed" | "unstated" | "no_sponsorship";
  legitimacy: "high_confidence" | "proceed_with_caution" | "suspicious";
  strengths: string[];
  gaps: string[];
  requirements: MatchEvidence[];
  blockers: EligibilityBlocker[];
  sourceResumeHash: ContentHash;
  jobContentHash: ContentHash;
  preferencesVersion: Version;
  modelVersion: string;
  schemaVersion: 1;
  completedAt: ISODateTime;
  // Persist score5, never an independently editable percentage. Sort/filter using
  // this score plus blockers; a high score never overrides a hard eligibility stop.
}

export interface MatchPresentation {
  /** Derived only: Math.round(assessment.score5 / 5 * 100). Not a probability. */
  matchPercent: number;
  band: "strong" | "good" | "moderate" | "low";
  explanation: "AI profile match, not an interview probability";
}

export interface LetterRevision {
  version: Version;
  author: "model" | "candidate";
  text: string;
  subject: string;
  updatedAt: ISODateTime;
  contentHash: ContentHash;
  sourceFactIds: FactId[];
  jobContentHash: ContentHash;
}

export type LetterState =
  | { status: "not_started"; current: null }
  | { status: "generating"; current: LetterRevision | null; generationId: LetterGenerationId; baseVersion: Version | null }
  | { status: "ready"; current: LetterRevision }
  | { status: "failed"; current: LetterRevision | null; error: PublicError };

export type PackageReadiness =
  | { status: "preparing" }
  | { status: "ready"; verifiedAt: ISODateTime }
  | { status: "needs_input"; missingAnswerIds: string[]; explanation: string }
  | { status: "failed"; error: PublicError };

/** Material readiness does not establish a supported delivery method. */
export type DeliveryCapability =
  | { kind: "manual_only"; reason: "pilot_disabled" | "unsupported_form" | "requires_login" | "requires_captcha" | "unverified_form" }
  | {
      kind: "supported_auto_submit";
      adapterId: string;
      adapterVersion: string;
      inspectedAt: ISODateTime;
      destinationUrl: HttpsUrl;
      inspectionHash: ContentHash;
      requiredAnswerIds: string[];
    };

export interface CandidateAnswer {
  id: string;
  question: string;
  value: Knowledge<string | boolean | string[]>;
  source: "resume_fact" | "candidate_confirmation" | "unknown";
  sourceFactIds: FactId[];
  version: Version;
  // Legal/personal/consent questions require explicit candidate confirmation.
}

export type SubmissionState =
  | { status: "not_approved" }
  | { status: "approved"; approvalId: ApprovalId }
  | { status: "queued"; approvalId: ApprovalId; attemptId: SubmissionAttemptId }
  | { status: "submitting"; approvalId: ApprovalId; attemptId: SubmissionAttemptId; startedAt: ISODateTime }
  | { status: "confirmed"; approvalId: ApprovalId; attemptId: SubmissionAttemptId; receipt: SubmissionReceipt }
  | { status: "blocked"; reason: string; approvalId: ApprovalId | null }
  | { status: "failed"; attemptId: SubmissionAttemptId; reason: string; safeToRetry: boolean }
  | { status: "unknown"; attemptId: SubmissionAttemptId; reason: string; automaticRetryAllowed: false };

export interface SubmissionReceipt {
  confirmedAt: ISODateTime;
  destinationUrl: HttpsUrl;
  externalConfirmationId: string | null;
  evidenceArtifactId: ArtifactId; // Owned confirmation evidence, not a guessed status.
  adapterId: string;
  adapterVersion: string;
  // Must reflect actual recognized confirmation, never a card event or exit code.
}

export interface ApplicationPackage {
  jobId: JobId;
  version: Version;
  sourceResumeHash: ContentHash;
  tailoredResumeArtifactId: ArtifactId | null;
  letterArtifactId: ArtifactId | null;
  letter: LetterState;
  answers: CandidateAnswer[];
  readiness: PackageReadiness;
  capability: DeliveryCapability;
  submission: SubmissionState;
  packageHash: ContentHash | null; // Available once required parts are finalized.
}

export interface ApplicationSelection {
  jobIds: JobId[];
  version: Version;
  updatedAt: ISODateTime;
  // Server rejects duplicates/foreign IDs and enforces configured batch limit.
}

export interface ApplyConsent {
  consentVersion: string;
  accepted: true;
}

export interface ApprovedPackageSnapshot {
  readonly jobId: JobId;
  readonly packageVersion: Version;
  readonly packageHash: ContentHash;
  readonly sourceResumeHash: ContentHash;
  readonly tailoredResumeArtifactId: ArtifactId;
  readonly letterVersion: Version;
  readonly answerVersions: Readonly<Record<string, Version>>;
  readonly destinationUrl: HttpsUrl;
  readonly adapterId: string;
  readonly adapterVersion: string;
}

export interface BatchApproval {
  readonly id: ApprovalId;
  readonly runId: RunId;
  readonly selectionVersion: Version;
  readonly packages: readonly ApprovedPackageSnapshot[];
  readonly consentVersion: string;
  readonly approvedAt: ISODateTime;
  readonly idempotencyKey: string;
  // Generated by the server after checking the exact selected versions. Subsequent
  // edits invalidate affected approval; a fourth UI click never creates approval.
}

/** New, optional adapter specification. No upstream module implements this API. */
export interface SubmitAdapter {
  readonly id: string;
  readonly version: string;
  inspect(ctx: RunContext, job: Job): Promise<{
    capability: DeliveryCapability;
    questions: CandidateAnswer[];
  }>;
  prepare(ctx: RunContext, job: Job, material: ApplicationPackage): Promise<ApplicationPackage>;
  validate(ctx: RunContext, job: Job, material: ApplicationPackage): Promise<
    { valid: true } | { valid: false; reasons: string[] }
  >;
  submitAuthorized(ctx: RunContext, approval: BatchApproval,
    approvedPackage: ApprovedPackageSnapshot, attemptId: SubmissionAttemptId
  ): Promise<SubmissionState>;
  verifyReceipt(ctx: RunContext, attempt: SubmissionAttemptRecord): Promise<SubmissionState>;
  // Every method has server time/host bounds. Only submitAuthorized can perform
  // final delivery, and only after persisted consent, eligibility, credit and
  // dedup checks. No free-form model tool chooses the final action.
}

export interface SubmissionAttemptRecord {
  id: SubmissionAttemptId;
  ownerSessionId: SessionId;
  runId: RunId;
  jobId: JobId;
  canonicalPostingKey: string;
  approvalId: ApprovalId;
  approvedPackageHash: ContentHash;
  state: SubmissionState;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  // Uniqueness checks include candidate/session + canonical posting regardless
  // of package hash. Editing a letter cannot bypass an existing confirmed or
  // unresolved application. Unknown attempts prohibit automatic re-submission.
}

export interface PublicError {
  code:
    | "invalid_upload" | "unreadable_resume" | "queue_full" | "scan_failed"
    | "no_matching_jobs" | "model_timeout" | "invalid_model_output" | "fact_check_failed"
    | "document_render_failed" | "interrupted" | "version_conflict" | "not_found"
    | "capability_disabled" | "missing_input" | "billing_setup_failed" | "internal_error";
  message: string; // Sanitized, actionable; no paths, tokens, prompts, or stack traces.
  retryable: boolean;
  stage: StageId | null;
  jobId: JobId | null;
}

export interface ActionProgress {
  id: ActionId;
  stage: StageId;
  label: string; // Fixed orchestrator vocabulary, never raw model reasoning.
  status: "in_progress" | "completed" | "failed";
  startedAt: ISODateTime;
  completedAt: ISODateTime | null;
  error: PublicError | null;
}

export interface StageResultMap {
  refine: {
    kind: "refine";
    originalArtifactId: ArtifactId;
    refinedResumeArtifactId: ArtifactId;
    changes: RefinementChange[];
    originalPreserved: true;
  };
  explore: { kind: "explore"; jobIds: JobId[]; coverage: SearchCoverage };
  match: { kind: "match"; assessments: MatchAssessment[]; rankedJobIds: JobId[] };
  prepare: { kind: "prepare"; preparedJobIds: JobId[]; blockedJobIds: JobId[]; failedJobIds: JobId[] };
}
export type StageResult = StageResultMap[StageId];

export interface StageState {
  stage: StageId;
  status: "pending" | "queued" | "running" | "completed" | "failed" | "interrupted";
  inputVersion: Version;
  inputHash: ContentHash;
  attempt: number;
  actions: ActionProgress[]; // Only started actions; no future action list revealed.
  result: StageResult | null;
  error: PublicError | null;
  // Runtime requires result.kind === stage. Completed requires durable result.
}

export interface BillingPublicState {
  status: "not_started" | "requires_card" | "requires_action" | "processing" | "activated" | "failed";
  mode: "test" | "live";
  promotionalCredit: PromotionalCreditGrant | null;
  entitlement: PilotEntitlement | null;
  amountChargedMinor: 0; // This MVP only saves a card; it never charges or subscribes.
  error: PublicError | null;
}

export interface RunSnapshot {
  schemaVersion: 1;
  id: RunId;
  origin: RunOrigin;
  launchProfile: LaunchProfile;
  status: "queued" | "running" | "preparation_complete" | "failed" | "interrupted" | "cancelled";
  currentStage: StageId | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  lastSequence: Sequence;
  journeyVersion: Version; // Increment when retry/preferences invalidate worker inputs.
  profile: CandidateProfile | null;
  preferences: SearchPreferences;
  stages: Record<StageId, StageState>;
  evidence: Evidence[];
  jobs: Job[];
  assessments: MatchAssessment[];
  applications: ApplicationPackage[];
  selection: ApplicationSelection;
  artifacts: ArtifactMetadata[];
  billing: BillingPublicState;
  // Preparation completion says nothing about payment, approval, or delivery.
}

/** Server-only ownership; never expose the session token or its hash to browser. */
export interface PersistedRun {
  snapshot: RunSnapshot;
  ownerSessionId: SessionId;
  billingRecordId: string | null;
  approvals: BatchApproval[];
}

export type StripeSetupIntentStatus =
  | "requires_payment_method" | "requires_confirmation" | "requires_action"
  | "processing" | "canceled" | "succeeded";

export interface BillingRecord {
  id: string;
  ownerSessionId: SessionId;
  runId: RunId;
  experimentId: string;
  mode: "test" | "live";
  customerId: string;
  setupIntentId: string;
  paymentMethodId: string | null;
  setupStatus: StripeSetupIntentStatus;
  usage: "on_session";
  email: string;
  consent: { version: string; acceptedAt: ISODateTime };
  selectionVersionAtSetup: Version;
  setupIdempotencyKey: string;
  lastReconciledAt: ISODateTime | null;
  creditGrantId: string | null;
  // No clientSecret, raw card fields, webhook body, or permission for future charges.
}

export interface PromotionalCreditGrant {
  id: string;
  experimentId: string;
  currency: "USD";
  promotionalValueMinor: 3000;
  grantedAt: ISODateTime;
  // Public record omits Stripe IDs; private index enforces unique SetupIntent and
  // one initial grant per experiment customer/session, even across restarted runs.
}

export interface PersistedPromotionalCreditGrant extends PromotionalCreditGrant {
  ownerSessionId: SessionId;
  customerId: string;
  setupIntentId: string;
  mode: "test" | "live";
  entitlementId: string;
  idempotencyKey: string;
}

export interface PilotEntitlement {
  id: string;
  kind: "application_packages" | "confirmed_submissions";
  unitLimit: 20; // Up to 20; never promise more jobs than actually available.
  unitsReserved: number;
  unitsConsumed: number;
  // Separate commercial entitlement. Do NOT infer $1.50 per unit from $30 / 20.
  // 0 <= consumed + reserved <= limit. Delivery unknown keeps its unit reserved.
}

export interface EntitlementReservation {
  id: string;
  entitlementId: string;
  jobId: JobId;
  approvedPackageHash: ContentHash;
  status: "reserved" | "consumed" | "released";
  attemptId: SubmissionAttemptId | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  // Confirmed delivery consumes; definite failure releases; ambiguity never retries.
}

/** Fixed input identity stamped by the parent; stale workers cannot commit. */
export interface EventInputContext {
  journeyVersion: Version;
  sourceResumeHash: ContentHash | null;
  preferencesVersion: Version;
  stageInputVersion: Version | null;
  stageAttempt: number | null;
}

/** Event envelope is public NDJSON; append only after related durable writes. */
export interface EventEnvelope<K extends string, P> {
  version: 1;
  runId: RunId;
  seq: Sequence;
  time: ISODateTime;
  input: EventInputContext;
  type: K;
  payload: P;
}

export interface EventPayloadMap {
  "run.queued": { queuePosition: number | null };
  "run.started": { stage: StageId };
  "action.started": { action: ActionProgress };
  "action.completed": { stage: StageId; actionId: ActionId };
  "action.error": { stage: StageId; actionId: ActionId; error: PublicError };
  "stage.started": { stage: StageId; inputVersion: Version; attempt: number };
  "stage.result": { stage: StageId; result: StageResult; inputVersion: Version };
  "stage.error": { stage: StageId; error: PublicError; inputVersion: Version };
  "job.discovered": { job: Job };
  "job.evaluated": { assessment: MatchAssessment };
  "application.updated": { application: ApplicationPackage };
  "selection.updated": { selection: ApplicationSelection };
  "letter.started": { jobId: JobId; generationId: LetterGenerationId; baseVersion: Version | null };
  "letter.delta": {
    jobId: JobId;
    generationId: LetterGenerationId;
    baseVersion: Version | null;
    text: string; // Visible letter text only; never reasoning_content or diagnostics.
  };
  "letter.completed": { jobId: JobId; generationId: LetterGenerationId; revision: LetterRevision };
  "letter.error": { jobId: JobId; generationId: LetterGenerationId; error: PublicError };
  "billing.updated": { billing: BillingPublicState };
  "credits.granted": { grant: PromotionalCreditGrant; entitlement: PilotEntitlement };
  "submission.updated": { jobId: JobId; state: SubmissionState };
  "run.done": { outcome: "preparation_complete"; resultStage: "prepare" };
  "run.error": { error: PublicError; lastCompletedStage: StageId | null };
  "run.interrupted": { stage: StageId; canRetry: true };
  "run.cancelled": { reason: "candidate_deleted_run" };
  "keepalive": Record<string, never>;
}
export type PublicRunEvent = {
  [K in keyof EventPayloadMap]: EventEnvelope<K, EventPayloadMap[K]>
}[keyof EventPayloadMap];

// Stream EOF is NOT completion. Require explicit stage.result / letter.completed /
// run.done as appropriate. Reject stale journeyVersion/input hashes/attempts before
// committing worker events; reconnecting presentation reads the current snapshot. Ignore replayed seq <= lastSequence. A letter delta
// applies only to its generationId + baseVersion; candidate edits win over stale
// generations. Failed/cancelled generations cannot later commit letter.completed.
// A stage.result is the explicit terminal success for that stage; only advance
// presentation after it. The first three results hold for 2 seconds then pack;
// prepare stays visible. Backend completion and animation timing are independent.

export interface CreateRunFields {
  file: unknown; // Transport multipart File, not JSON. Validate actual PDF/DOCX <=10MB.
  confirmedTargetRoles?: string[];
  confirmedLocations?: string[];
  idempotencyNonce: string;
}
/** Alternative JSON body for inline unreadable-file recovery, same runs route. */
export interface CreateTextRunRequest {
  kind: "pasted_text";
  text: string; // Runtime: nonempty, bounded length; persist as original text artifact.
  confirmedTargetRoles?: string[];
  confirmedLocations?: string[];
  idempotencyNonce: string;
}
export interface CreateRunResponse { runId: RunId; status: "queued"; origin: RunOrigin }
export interface CreateSampleRunRequest { idempotencyNonce: string }
export interface CurrentRunResponse { run: RunSnapshot | null }
export interface RunEventsQuery { after: Sequence }
export interface RetryStageRequest { stage: StageId; inputVersion: Version }
export interface RetryStageResponse { stage: StageId; status: "queued"; inputVersion: Version }

export interface PatchPreferencesRequest {
  expectedVersion: Version;
  targetRoles: string[];
  locations: string[];
  workStyles: SearchPreferences["workStyles"];
}
export interface PatchPreferencesResponse {
  preferences: SearchPreferences;
  invalidatedStages: Array<"explore" | "match" | "prepare">;
}
export interface PatchApplicationsRequest { jobIds: JobId[]; expectedSelectionVersion: Version }
export interface PatchApplicationsResponse { selection: ApplicationSelection }
export interface PatchLetterRequest { text: string; expectedDraftVersion: Version }
export interface PatchLetterResponse { jobId: JobId; revision: LetterRevision }

export interface BillingSetupRequest {
  email: string;
  saveCardConsent: { accepted: true; version: string };
  selectedBatchVersion: Version;
}
/** Browser-scoped transient response: never persist, log, or put in run events. */
export interface BillingSetupResponse {
  setupIntentClientSecret: string;
  mode: "test" | "live";
  usage: "on_session";
  amountChargedMinor: 0;
  returnPath: string; // Server-defined same-origin path; not arbitrary client URL.
}
export type BillingReconcileRequest = Record<string, never>;
export interface BillingReconcileResponse { billing: BillingPublicState }
// Webhook transport is a signed RAW body and Stripe-Signature header, verified by
// Stripe SDK before mapping to this private verified command. Not a browser API.
export interface VerifiedSetupIntentCommand {
  eventId: string | null; // null for server-initiated retrieval/reconciliation.
  setupIntentId: string;
  customerId: string;
  paymentMethodId: string | null;
  status: StripeSetupIntentStatus;
  mode: "test" | "live";
}
// Server retrieves/checks its owned intent and expected customer/mode. A browser
// success boolean or event cannot construct a credit grant. Both webhook and
// reconciliation call the same serialized, idempotent grant operation.

export interface ApproveApplicationsRequest {
  selectionVersion: Version;
  packages: Array<{ jobId: JobId; packageVersion: Version; letterVersion: Version; packageHash: ContentHash }>;
  applyConsent: ApplyConsent;
  idempotencyNonce: string;
}
export type ApproveApplicationsResponse =
  | { status: "approved"; approval: BatchApproval; queuedJobIds: JobId[]; blockedJobIds: JobId[] }
  | { status: "capability_disabled"; message: string };

export type ClientFunnelEventName =
  | "landing_viewed" | "bulk_apply_viewed" | "bulk_job_selected" | "letter_edited"
  | "checkout_auto_opened" | "checkout_manual_opened" | "checkout_closed";
export interface ClientFunnelEventRequest {
  eventId: string;
  name: ClientFunnelEventName;
  jobId?: JobId;
  source?: "fourth_bulk_click" | "credits_cta";
  // No unrestricted properties, CV text, email, payment IDs, or trusted success flags.
}
export type ServerFunnelEventName =
  | "resume_validated" | "refinement_ready" | "search_ready" | "matches_ready"
  | "card_setup_started" | "card_setup_succeeded" | "credits_granted"
  | "batch_approved" | "application_confirmed" | "application_blocked" | "application_unknown";
export interface ServerFunnelEvent {
  eventId: string;
  name: ServerFunnelEventName;
  runId: RunId;
  time: ISODateTime;
  origin: RunOrigin;
  billingMode: "test" | "live" | null;
  jobId: JobId | null;
  // Live activation metric excludes sample origin and Stripe test mode.
}

export interface ApiErrorResponse { error: PublicError; currentVersion?: Version }
export interface DeleteRunResponse { deleted: true }
// GET /artifacts/:id returns an owned binary/text response, not a path JSON field.
// POST /events and verified /billing/webhook can acknowledge with HTTP 204.
// DELETE stops pending owned work and removes private run files; minimal billing
// references may remain for experiment reconciliation and grant deduplication.
