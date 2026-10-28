/**
 * Vitest setup file for the integration and e2e categories.
 *
 * Shared fixtures, global mocks, and server bootstrapping live here so test
 * files stay focused on assertions rather than scaffolding.
 */

import { beforeAll, afterAll, vi } from "vitest";

// Deterministic fake timers for integration tests that exercise rooms.ts
// timeouts (phase transitions, reconnect grace, etc.).
beforeAll(() => {
  vi.useFakeTimers();
});

afterAll(() => {
  vi.useRealTimers();
});
