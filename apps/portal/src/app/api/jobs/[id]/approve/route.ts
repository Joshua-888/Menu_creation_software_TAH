import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  getPortalStore,
  parseSignedSession,
  SESSION_COOKIE,
  sessionSecret,
} from "@engine/portal/index.js";
import { schedulePostReviewLiveIfReady } from "@engine/portal/worker.js";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const jar = await cookies();
  const token = parseSignedSession(
    jar.get(SESSION_COOKIE)?.value,
    sessionSecret(),
  );
  const store = getPortalStore();
  if (!token || !store.getSessionEmployee(token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const job = store.getJob(id);
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (job.status !== "AWAITING_OPERATOR_APPROVAL") {
    return NextResponse.json(
      { error: `Job is not awaiting approval (status=${job.status})` },
      { status: 409 },
    );
  }
  if (!schedulePostReviewLiveIfReady(id)) {
    return NextResponse.json(
      { error: "Approval could not be scheduled" },
      { status: 409 },
    );
  }
  return NextResponse.json({ scheduled: true, status: "LIVE_EXECUTING" });
}
