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
