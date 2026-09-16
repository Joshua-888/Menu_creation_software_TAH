/** Portal domain types — employees, sessions, migration jobs. */

export type EmployeeRole = "operator" | "admin";

export type Employee = {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: EmployeeRole;
  active: boolean;
  createdAt: string;
};

export type Session = {
  token: string;
  employeeId: string;
  expiresAt: string;
  createdAt: string;
};

export type JobSourceType =
  | "pdf_upload"
  | "source_url"
  | "pdf_and_url"
  | "live_destination";

/** What the operator is trying to do with this job. */
export type JobWorkflow = "CREATE_MENU" | "QA_RECONCILE";

export type JobStatus =
  | "DRAFT"
  | "QUEUED"
  | "EXTRACTING"
  | "DOMAIN"
  | "DECISIONS"
  | "ARTIFACTS"
  | "AWAITING_REVIEW"
  | "AWAITING_OPERATOR_APPROVAL"
  | "READY_DRY_RUN"
  | "LIVE_EXECUTING"
  | "WRITING"
  | "COMPLETED"
  | "COMPLETED_WITH_ERRORS"
  | "PARTIAL_WRITE"
  | "RECOVERY_REQUIRED"
  | "LIVE_EXECUTION_FAILED"
  | "SOURCE_URL_PENDING"
  | "FAILED"
  | "CANCELLED";

export type MigrationJob = {
  id: string;
  merchantName: string;
  restaurantKey: string;
  destinationHost: string;
  sourceType: JobSourceType;
  /** CREATE_MENU = migrate from PDF; QA_RECONCILE = quality-check existing live menu. */
  workflow: JobWorkflow;
  sourceUrl: string | null;
  status: JobStatus;
  createdByEmployeeId: string;
  errorMessage: string | null;
  remainingQuestions: number;
  createdAt: string;
  updatedAt: string;
};

export type JobFile = {
  id: string;
  jobId: string;
  originalName: string;
  storedPath: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
};

export type JobRun = {
  id: string;
  jobId: string;
  runDir: string;
  startedAt: string;
  finishedAt: string | null;
  status: JobStatus;
  metricsJson: string | null;
  errorMessage: string | null;
};

export type ReviewQuestion = {
  id: string;
  jobId: string;
  decisionCaseId: string | null;
  questionType: string;
  title: string;
  prompt: string;
  optionsJson: string;
  productRef: string | null;
  batchKey: string | null;
  status: "open" | "answered" | "batch_resolved";
  createdAt: string;
};

export type ReviewAnswer = {
  id: string;
  questionId: string;
  jobId: string;
  employeeId: string;
  selectedOptionId: string;
  resolution: string;
  scopePreference: "single" | "batch_similar" | "restaurant" | "global";
  comment: string | null;
  createdAt: string;
};

export type JobMetrics = {
  pageCount?: number;
  uniqueProducts?: number;
  categoryCount?: number;
  validationBlocked?: number;
  validationWarnings?: number;
  remainingQuestions?: number;
  dryRunCreates?: number;
  dryRunReviews?: number;
  dryRunSkips?: number;
  dryRunUpdates?: number;
  dryRunBlocks?: number;
  reconcileDiffs?: number;
  reconcileUpdatable?: number;
};
