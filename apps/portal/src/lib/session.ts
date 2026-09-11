import { cookies } from "next/headers";
import {
  getPortalStore,
  parseSignedSession,
  publicEmployee,
  SESSION_COOKIE,
  sessionSecret,
  type Employee,
} from "@engine/portal/index.js";

export async function getCurrentEmployee(): Promise<Employee | null> {
  const store = getPortalStore();
  store.ensureBootstrapAdmin();
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  const token = parseSignedSession(raw, sessionSecret());
  if (!token) return null;
  return store.getSessionEmployee(token);
}

export async function requireEmployee(): Promise<Employee> {
  const emp = await getCurrentEmployee();
  if (!emp) {
    throw new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return emp;
}

export function employeePublic(emp: Employee) {
  return publicEmployee(emp);
}
