import type { BlockerRecordV1 } from "./blockerRecord.js";

export type DiagnosticPackV1 = {
  packVersion: "DiagnosticPackV1";
  blocker: BlockerRecordV1;
  operationIdentity: {
    operationId: string | null;
    sourceId: string | null;
    menuNumber: string | null;
    name: string | null;
  };
  expectedPayloadShape: string | null;
  destinationBeforeHash: string | null;
  destinationAfterHash: string | null;
  requestFieldSchema: string[];
  responseStatus: number | null;
  responseSignature: string | null;
  pageUrl: string | null;
  pageTitle: string | null;
  loginClassification: string | null;
  contractFingerprint: string;
  adapterVersion: string;
  productionSha: string;
  timestamps: { createdAt: string };
  correlationIds: { runId: string; jobId: string | null };
  recoveryRecommendation: string;
};

const SECRETISH =
  /\b(_token|token|cookie|csrf|authorization|password|session)[=:]\s*[^\s&]+/gi;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;

export function sanitizeDiagnosticText(raw: string | null | undefined): string {
  return String(raw ?? "")
    .replace(SECRETISH, "[redacted]")
    .replace(BEARER, "[redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 800);
}

export function buildDiagnosticPack(input: {
  blocker: BlockerRecordV1;
  operationId?: string | null;
  sourceId?: string | null;
  menuNumber?: string | null;
  name?: string | null;
  expectedPayloadShape?: string | null;
  destinationBeforeHash?: string | null;
  destinationAfterHash?: string | null;
  requestFieldSchema?: string[];
  responseStatus?: number | null;
  responseSignature?: string | null;
  pageUrl?: string | null;
  pageTitle?: string | null;
  loginClassification?: string | null;
  jobId?: string | null;
  recoveryRecommendation: string;
}): DiagnosticPackV1 {
  return {
    packVersion: "DiagnosticPackV1",
    blocker: input.blocker,
    operationIdentity: {
      operationId: input.operationId ?? input.blocker.operationId,
      sourceId: input.sourceId ?? null,
      menuNumber: input.menuNumber ?? null,
      name: input.name ?? null,
    },
    expectedPayloadShape: input.expectedPayloadShape ?? null,
    destinationBeforeHash: input.destinationBeforeHash ?? null,
    destinationAfterHash: input.destinationAfterHash ?? null,
    requestFieldSchema: input.requestFieldSchema ?? [],
    responseStatus: input.responseStatus ?? input.blocker.httpStatus,
    responseSignature: input.responseSignature
      ? sanitizeDiagnosticText(input.responseSignature)
      : null,
    pageUrl: input.pageUrl ?? null,
    pageTitle: input.pageTitle ? sanitizeDiagnosticText(input.pageTitle) : null,
    loginClassification: input.loginClassification ?? null,
    contractFingerprint: input.blocker.contractFingerprint,
    adapterVersion: input.blocker.adapterVersion,
    productionSha: input.blocker.productionSha,
    timestamps: { createdAt: new Date().toISOString() },
    correlationIds: {
      runId: input.blocker.runId,
      jobId: input.jobId ?? null,
    },
    recoveryRecommendation: input.recoveryRecommendation,
  };
}
