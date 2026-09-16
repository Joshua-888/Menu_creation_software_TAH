import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // SQLite decision-store suites routinely exceed 5s under parallel ship-gate load
    testTimeout: 20_000,
  },
});
