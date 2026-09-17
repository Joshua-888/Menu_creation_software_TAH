/**
 * Deployment provenance. The baked image SHA is the commit actually built.
 * A leftover GIT_COMMIT_SHA env pin must not override it.
 */
export function resolveDeployCommitSha(input: {
  baked?: string | null;
  env?: NodeJS.ProcessEnv;
}): string {
  const baked = input.baked?.trim();
  if (baked && baked !== "unknown") return baked;
  const env = input.env ?? process.env;
  for (const c of [
    env.RAILWAY_GIT_COMMIT_SHA,
    env.GIT_COMMIT_SHA,
    env.COMMIT_SHA,
    env.SOURCE_VERSION,
  ]) {
    const v = c?.trim();
    if (v && v !== "unknown") return v;
  }
  return "unknown";
}
