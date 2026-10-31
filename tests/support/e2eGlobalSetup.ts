/**
 * Global setup for the e2e suite. Uses an already-running server when one
 * answers on E2E_PORT (CI starts one with `npm start`); otherwise spawns
 * `tsx server/index.ts` for the duration of the run.
 */

import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { WebSocket } from "ws";

const PORT = Number(process.env.E2E_PORT ?? 3001);
const URL = `ws://localhost:${PORT}/ws`;

function reachable(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new WebSocket(URL);
    socket.once("open", () => {
      socket.close();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

export default async function setup(): Promise<(() => void) | void> {
  if (await reachable()) return;

  const root = path.resolve(import.meta.dirname, "../..");
  const child: ChildProcess = spawn(path.join(root, "node_modules/.bin/tsx"), ["server/index.ts"], {
    cwd: root,
    env: { ...process.env, PORT: String(PORT) },
    stdio: "ignore",
  });

  for (let i = 0; i < 50; i += 1) {
    if (await reachable()) return () => void child.kill();
    await new Promise((r) => setTimeout(r, 200));
  }
  child.kill();
  throw new Error(`e2e: server did not start on port ${PORT}`);
}
