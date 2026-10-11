# argue.io

Realtime 1v1 debate: **5 minutes** to answer one question, then **15 minutes** of live chat. No accounts, no database — rooms live in memory.

## Run

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in two tabs (or two browsers). Pick nicknames and hit **play**, or share a room code.

Production-style (serves the built client from Express):

```bash
npm run build
npm start
```

Then open [http://localhost:3001](http://localhost:3001).
