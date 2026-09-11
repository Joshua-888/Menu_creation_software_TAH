import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  getPortalStore,
  parseSignedSession,
  SESSION_COOKIE,
  sessionSecret,
} from "@engine/portal/index.js";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const emp = await currentEmployee();
  if (!emp) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const jobId = url.searchParams.get("job") ?? undefined;
  return NextResponse.json({
    questions: getPortalStore().listOpenQuestions(jobId),
  });
}

async function currentEmployee() {
  const jar = await cookies();
  const token = parseSignedSession(jar.get(SESSION_COOKIE)?.value, sessionSecret());
  if (!token) return null;
  return getPortalStore().getSessionEmployee(token);
}
