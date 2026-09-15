import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  getPortalStore,
  parseSignedSession,
  readJobArtifact,
  SESSION_COOKIE,
  sessionSecret,
} from "@engine/portal/index.js";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const emp = await currentEmployee();
  if (!emp) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const store = getPortalStore();
  const job = store.getJob(id);
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({
    job,
    files: store.listJobFiles(id),
    run: store.latestJobRun(id),
    questions: store.listOpenQuestions(id),
    dryRunSummary: readJobArtifact(id, "dry-run-summary.json"),
    policyApplication: readJobArtifact(id, "policy-application.json"),
  });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const emp = await currentEmployee();
  if (!emp) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const store = getPortalStore();
  const ok = store.deleteJob(id);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ deleted: true, id });
}

async function currentEmployee() {
  const jar = await cookies();
  const token = parseSignedSession(jar.get(SESSION_COOKIE)?.value, sessionSecret());
  if (!token) return null;
  return getPortalStore().getSessionEmployee(token);
}
