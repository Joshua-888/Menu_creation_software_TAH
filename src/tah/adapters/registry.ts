import type { AdminAdapterLifecycle, TahAdminAdapter } from "../types.js";
import { TahAdminAdapterV1, type V1AdapterOptions } from "./v1/adapter.js";

export type AdapterRegistration = {
  version: string;
  lifecycle: AdminAdapterLifecycle;
  create: (options: V1AdapterOptions) => TahAdminAdapter;
};

const registry: AdapterRegistration[] = [
  {
    version: "1.0.0",
    lifecycle: "DEVELOPMENT",
    create: (options) => new TahAdminAdapterV1(options),
  },
];

export function listAdapters(): AdapterRegistration[] {
  return [...registry];
}

export function getCertifiedAdapter(
  version?: string,
): AdapterRegistration | null {
  const matches = registry.filter((a) => a.lifecycle === "CERTIFIED");
  if (version) return matches.find((a) => a.version === version) ?? null;
  return matches[0] ?? null;
}

export function resolveAdapterForProbe(version = "1.0.0"): AdapterRegistration {
  const found = registry.find((a) => a.version === version);
  if (!found) throw new Error(`Unknown admin adapter version: ${version}`);
  return found;
}

export function assertCertifiedForProductionWrites(
  adapter: TahAdminAdapter,
): void {
  if (adapter.lifecycle !== "CERTIFIED") {
    throw new Error(
      `ADMIN_WRITE_BLOCKED: adapter ${adapter.version} lifecycle is ${adapter.lifecycle}, not CERTIFIED`,
    );
  }
}
