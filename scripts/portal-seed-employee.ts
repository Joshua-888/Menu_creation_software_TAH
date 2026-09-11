/**
 * Seed or ensure bootstrap admin + optional extra operator from env/CLI.
 * Usage:
 *   ADMIN_BOOTSTRAP_EMAIL=... ADMIN_BOOTSTRAP_PASSWORD=... npm run portal:seed
 *   npx tsx scripts/portal-seed-employee.ts --email a@b.com --password secret --name "Ada"
 */
import { getPortalStore } from "../src/portal/index.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return undefined;
}

const store = getPortalStore();
const admin = store.ensureBootstrapAdmin();
if (admin) {
  console.log(`Bootstrap admin ready: ${admin.email} (${admin.id})`);
} else {
  console.log(
    "No ADMIN_BOOTSTRAP_EMAIL/PASSWORD — skipped admin bootstrap.",
  );
}

const email = arg("--email");
const password = arg("--password");
const name = arg("--name") ?? "Operator";
if (email && password) {
  const existing = store.getEmployeeByEmail(email);
  if (existing) {
    console.log(`Employee already exists: ${existing.email}`);
  } else {
    const emp = store.createEmployee({
      email,
      name,
      password,
      role: "operator",
    });
    console.log(`Created operator: ${emp.email} (${emp.id})`);
  }
}

store.close();
