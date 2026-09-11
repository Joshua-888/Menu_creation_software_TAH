import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Employee, EmployeeRole } from "./types.js";

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const saltHex = parts[1]!;
  const hashHex = parts[2]!;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, salt, expected.length, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function createSessionToken(): string {
  return randomBytes(32).toString("hex");
}

export function sessionExpiresAt(hours = 12): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function publicEmployee(e: Employee): Omit<Employee, "passwordHash"> {
  const { passwordHash: _, ...rest } = e;
  return rest;
}

export type BootstrapConfig = {
  email: string;
  password: string;
  name?: string;
  role?: EmployeeRole;
};

export function readBootstrapFromEnv(): BootstrapConfig | null {
  const email = process.env.ADMIN_BOOTSTRAP_EMAIL?.trim();
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD?.trim();
  if (!email || !password) return null;
  return {
    email: normalizeEmail(email),
    password,
    name: process.env.ADMIN_BOOTSTRAP_NAME?.trim() || "Portal Admin",
    role: "admin",
  };
}

/** Cookie signing — HMAC-SHA256 of token with session secret. */
export function signSessionValue(token: string, secret: string): string {
  const sig = createHmac("sha256", secret).update(token).digest("hex").slice(0, 32);
  return `${token}.${sig}`;
}

export function parseSignedSession(
  value: string | undefined,
  secret: string,
): string | null {
  if (!value) return null;
  const i = value.lastIndexOf(".");
  if (i <= 0) return null;
  const token = value.slice(0, i);
  const sig = value.slice(i + 1);
  const expected = signSessionValue(token, secret).slice(token.length + 1);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return token;
}

export function sessionSecret(): string {
  const s = process.env.PORTAL_SESSION_SECRET?.trim();
  if (s && s.length >= 16) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("PORTAL_SESSION_SECRET must be set (min 16 chars) in production");
  }
  return "dev-only-portal-session-secret";
}

export const SESSION_COOKIE = "tah_portal_session";
