import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "e2e",
    environment: "node",
    include: ["tests/e2e/**/*.test.ts"],
    // E2E tests require a running server. Start it first (e.g. `npm start`) or
    // spin it up in `tests/support/setup.ts` before the suite runs.
  },
});
