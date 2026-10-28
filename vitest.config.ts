import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "unit",
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["shared/**/*.ts", "server/**/*.ts"],
      // Regression floor: keep coverage from silently slipping as the suite
      // grows. Raise these as the unit/integration/e2e categories are filled in.
      thresholds: {
        lines: 5,
        functions: 8,
        branches: 1,
        statements: 5,
      },
      reporter: ["text", "clover", "json"],
    },
  },
});