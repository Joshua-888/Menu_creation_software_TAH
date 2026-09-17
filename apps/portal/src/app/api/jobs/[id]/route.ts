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

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const emp = await currentEmployee();
  if (!emp) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const store = getPortalStore();
  const job = store.getJob(id);
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body: { action?: string; reason?: string } = {};
  try {
    body = (await req.json()) as { action?: string; reason?: string };
  } catch {
    body = {};
  }
  if (body.action !== "cancel") {
    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  }
  const reason =
    body.reason?.trim() ||
    `Cancelled by ${emp.email} — stale job, do not resume`;
  const ok = store.cancelJob(id, reason);
  if (!ok) {
    return NextResponse.json(
      {
        error:
          job.status === "LIVE_EXECUTING" || job.status === "WRITING"
            ? "Cannot cancel a job that is currently writing"
            : "Could not cancel job",
      },
      { status: 409 },
    );
  }
  return NextResponse.json({ cancelled: true, id, job: store.getJob(id) });
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
