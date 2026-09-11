import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  getPortalStore,
  parseSignedSession,
  SESSION_COOKIE,
  sessionSecret,
} from "@engine/portal/index.js";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  const token = parseSignedSession(raw, sessionSecret());
  if (token) {
    getPortalStore().deleteSession(token);
  }
  const res = NextResponse.redirect(new URL("/login", req.url), 303);
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure:
      process.env.PORTAL_COOKIE_SECURE === "true" ||
      process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
