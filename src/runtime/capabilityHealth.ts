export type CapabilityRuntimeHealth =
  | "HEALTHY"
  | "DEGRADED"
  | "CIRCUIT_OPEN"
  | "CONTRACT_CHANGED"
  | "UNKNOWN";

export type CapabilityHealthRecord = {
  capability: string;
  destinationHost: string;
  contractFingerprint: string;
  staticCertification: "CERTIFIED" | "UNCERTIFIED" | "UNAVAILABLE";
  runtime: CapabilityRuntimeHealth;
  fingerprint: string | null;
  updatedAt: string;
};

const health = new Map<string, CapabilityHealthRecord>();

function key(capability: string, host: string): string {
  return `${host}::${capability}`;
}

export function recordCapabilityRuntimeHealth(
  record: CapabilityHealthRecord,
): void {
  health.set(key(record.capability, record.destinationHost), record);
}

export function getCapabilityRuntimeHealth(
  capability: string,
  destinationHost: string,
): CapabilityHealthRecord | null {
  return health.get(key(capability, destinationHost)) ?? null;
}

export function openCreateCircuit(
  destinationHost: string,
  contractFingerprint: string,
  fingerprint: string,
): void {
  recordCapabilityRuntimeHealth({
    capability: "createHiddenProduct",
    destinationHost,
    contractFingerprint,
    staticCertification: "CERTIFIED",
    runtime: "CIRCUIT_OPEN",
    fingerprint,
    updatedAt: new Date().toISOString(),
  });
}
