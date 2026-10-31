# argue.io

Realtime debate lobby: host a room of **2–10** players, **5 minutes** to answer one question, then **15 minutes** of live chat. No accounts, no database — rooms live in memory.

## Run

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). **Create lobby** as host (set seats, kick, start), or **join room** with a code.

Production-style (serves the built client from Express):

```bash
npm run build
npm start
```

Then open [http://localhost:3001](http://localhost:3001).

## Test

The suite is split into three independent categories:

| Command | Category | Environment | Notes |
|---------|----------|-------------|-------|
| `npm test` / `npm run test:unit` | Unit | Node | Pure functions (censor, protocol, questions, room helpers). Fast; runs on every change. |
| `npm run test:integration` | Integration | Node | In-process room logic with mocked WebSocket + fake timers. |
| `npm run test:e2e` | E2E | Node | Full stack over a real WebSocket; reuses a server on `E2E_PORT` (default 3001) or starts one. |
| `npm run test:ci` | CI | Node | Unit + integration (the gated pipeline). |
| `npm run test:coverage` | Coverage | Node | Unit run with v8 coverage and thresholds. |
| `npm run test:watch` | Watch | Node | Interactive watch mode. |

Tests live under `tests/` mirroring the source tree (`tests/unit`, `tests/integration`, `tests/e2e`), with shared fixtures in `tests/support/`.

CI (`.github/workflows/ci.yml`) runs tests (unit + integration), coverage, client build, and end-to-end tests on every push and pull request to `main`.
