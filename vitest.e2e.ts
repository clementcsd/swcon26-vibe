import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "e2e",
    environment: "node",
    include: ["tests/e2e/**/*.test.ts"],
    // Reuses a server already listening on E2E_PORT (default 3001), or starts one.
    globalSetup: ["./tests/support/e2eGlobalSetup.ts"],
    testTimeout: 15_000,
  },
});
