export type * from "./types.js";
export {
  hashPassword,
  verifyPassword,
  publicEmployee,
  sessionSecret,
  signSessionValue,
  parseSignedSession,
  SESSION_COOKIE,
  readBootstrapFromEnv,
} from "./auth.js";
export { PortalStore, getPortalStore, resetPortalStoreForTests } from "./store.js";
export { submitReviewAnswer } from "./review.js";
export { readJobArtifact } from "./artifacts.js";
export {
  portalDataDir,
  portalDbPath,
  uploadsDir,
  runsDir,
  repoRoot,
} from "./paths.js";

// Worker (PDF/OCR) is intentionally NOT re-exported here — import from
// `./worker.js` only in routes that schedule jobs, so Next does not pull
// native canvas/pdf bindings into every API route graph.
