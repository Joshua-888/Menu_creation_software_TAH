import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  getPortalStore,
  parseSignedSession,
  SESSION_COOKIE,
  sessionSecret,
  submitReviewAnswer,
} from "@engine/portal/index.js";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const emp = await currentEmployee();
  if (!emp) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json()) as {
    questionId?: string;
    selectedOptionId?: string;
    scopePreference?: "single" | "batch_similar" | "restaurant" | "global";
    comment?: string;
  };

  if (!body.questionId || !body.selectedOptionId) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  try {
    const result = submitReviewAnswer({
      questionId: body.questionId,
      employeeId: emp.id,
      selectedOptionId: body.selectedOptionId,
      scopePreference: body.scopePreference ?? "single",
      comment: body.comment ?? null,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 400 },
    );
  }
}

async function currentEmployee() {
  const jar = await cookies();
  const token = parseSignedSession(jar.get(SESSION_COOKIE)?.value, sessionSecret());
  if (!token) return null;
  return getPortalStore().getSessionEmployee(token);
}
