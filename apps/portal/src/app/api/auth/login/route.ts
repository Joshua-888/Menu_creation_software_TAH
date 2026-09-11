import { NextResponse } from "next/server";
import {
  getPortalStore,
  SESSION_COOKIE,
  sessionSecret,
  signSessionValue,
  publicEmployee,
} from "@engine/portal/index.js";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json()) as { email?: string; password?: string };
  const email = body.email?.trim() ?? "";
  const password = body.password ?? "";
  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password required" },
      { status: 400 },
    );
  }

  const store = getPortalStore();
  store.ensureBootstrapAdmin();
  const emp = store.authenticate(email, password);
  if (!emp) {
    return NextResponse.json(
      { error: "Invalid email or password" },
      { status: 401 },
    );
  }

  const session = store.createSession(emp.id);
  const signed = signSessionValue(session.token, sessionSecret());
  const res = NextResponse.json({ employee: publicEmployee(emp) });
  res.cookies.set(SESSION_COOKIE, signed, {
    httpOnly: true,
    secure:
      process.env.PORTAL_COOKIE_SECURE === "true" ||
      process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(session.expiresAt),
  });
  return res;
}
