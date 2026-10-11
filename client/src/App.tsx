import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  MAX_ANSWER_LENGTH,
  MAX_CHAT_LENGTH,
  MAX_NICKNAME_LENGTH,
} from "../../shared/protocol.ts";
import { Timer } from "./Timer.tsx";
import { useGame } from "./useGame.ts";

export default function App() {
  const game = useGame();
  const { room, status, playerId } = game;
  const me = room?.players.find((p) => p.id === playerId);

  return (
    <div className="arena relative min-h-screen">
      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <div className="font-display text-2xl tracking-tight">
          argue<span className="text-lime">.io</span>
        </div>
        {room ? (
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(room.code)}
            className="rounded-full border border-line bg-panel/80 px-3 py-1 text-sm text-white/70 hover:border-lime/50"
          >
            room <span className="font-semibold text-lime">{room.code}</span>
            <span className="ml-2 text-xs uppercase tracking-widest text-white/35">copy</span>
          </button>
        ) : (
          <div className="text-xs uppercase tracking-[0.2em] text-white/40">no accounts · no db</div>
        )}
      </header>

      <main className="relative z-10 mx-auto max-w-6xl px-5 pb-16">
        {status !== "playing" || !room ? (
          <Home error={game.error} connecting={status === "connecting"} onJoin={game.connect} />
        ) : room.phase === "waiting" ? (
          <Waiting roomCode={room.code} players={room.players} />
        ) : room.phase === "question" ? (
          <Question
            question={room.question}
            endsAt={room.phaseEndsAt}
            submitted={Boolean(me?.hasAnswer)}
            onSubmit={(text) => game.send({ type: "submit_answer", text })}
            error={game.error}
          />
        ) : room.phase === "debate" ? (
          <Debate
            question={room.question}
            endsAt={room.phaseEndsAt}
            stances={room.stances}
            messages={room.messages}
            playerId={playerId}
            onChat={(text) => game.send({ type: "chat", text })}
          />
        ) : (
          <Ended
            question={room.question}
            stances={room.stances}
            onAgain={() => game.send({ type: "play_again" })}
          />
        )}
      </main>
    </div>
  );
}

function Home({
  error,
  connecting,
  onJoin,
}: {
  error: string | null;
  connecting: boolean;
  onJoin: (nickname: string, roomCode?: string) => void;
}) {
  const [nickname, setNickname] = useState("");
  const [roomCode, setRoomCode] = useState("");

  function submit(event: FormEvent, withCode: boolean) {
    event.preventDefault();
    onJoin(nickname, withCode ? roomCode : undefined);
  }

  return (
    <section className="grid gap-10 pt-6 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
      <div>
        <p className="text-sm uppercase tracking-[0.25em] text-hot">live 1v1</p>
        <h1 className="mt-3 max-w-xl font-display text-5xl leading-[0.95] sm:text-7xl">
          Drop a take.
          <br />
          Then fight for it.
        </h1>
        <p className="mt-5 max-w-lg text-lg text-white/65">
          Five minutes to answer one question. Fifteen minutes of chat to debate. No logins — pick a
          name and jump in, like an .io arena.
        </p>
        <div className="mt-8 flex flex-wrap gap-3 text-sm text-white/50">
          <Pill>5:00 write</Pill>
          <Pill>15:00 debate</Pill>
          <Pill>2 players</Pill>
        </div>
      </div>

      <form className="rounded-3xl border border-line bg-panel/90 p-6 shadow-[0_20px_80px_rgba(0,0,0,0.35)]">
        <label className="block text-sm text-white/60">nickname</label>
        <input
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          maxLength={MAX_NICKNAME_LENGTH}
          placeholder="neonfox"
          className="mt-2 w-full rounded-2xl border border-line bg-ink px-4 py-3 text-lg outline-none ring-lime/40 focus:ring-2"
        />
        <label className="mt-5 block text-sm text-white/60">private room (optional)</label>
        <input
          value={roomCode}
          onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
          maxLength={4}
          placeholder="CODE"
          className="mt-2 w-full rounded-2xl border border-line bg-ink px-4 py-3 uppercase tracking-[0.3em] outline-none ring-lime/40 focus:ring-2"
        />
        {error ? <p className="mt-3 text-sm text-hot">{error}</p> : null}
        <button
          type="submit"
          disabled={connecting}
          onClick={(e) => submit(e, false)}
          className="glow-btn mt-6 w-full rounded-2xl bg-lime py-3 font-display text-xl text-ink disabled:opacity-60"
        >
          {connecting ? "joining…" : "play"}
        </button>
        <button
          type="submit"
          disabled={connecting || roomCode.length < 4}
          onClick={(e) => submit(e, true)}
          className="mt-3 w-full rounded-2xl border border-line py-3 text-white/80 hover:border-white/40 disabled:opacity-40"
        >
          join room
        </button>
      </form>
    </section>
  );
}

function Pill({ children }: { children: string }) {
  return (
    <span className="rounded-full border border-line bg-panel px-3 py-1">{children}</span>
  );
}

function Waiting({
  roomCode,
  players,
}: {
  roomCode: string;
  players: { id: string; nickname: string; color: string; connected: boolean }[];
}) {
  return (
    <section className="mx-auto max-w-xl pt-10 text-center">
      <p className="text-sm uppercase tracking-[0.25em] text-white/40">waiting for rival</p>
      <h2 className="mt-3 font-display text-5xl">Share {roomCode}</h2>
      <p className="mt-3 text-white/60">
        The round starts when two players are in the room. Send the code — or wait for matchmaking.
      </p>
      <ul className="mt-8 space-y-3">
        {players.map((player) => (
          <li
            key={player.id}
            className="flex items-center justify-between rounded-2xl border border-line bg-panel px-4 py-3"
          >
            <span className="font-medium" style={{ color: player.color }}>
              {player.nickname}
            </span>
            <span className="text-xs uppercase tracking-widest text-white/40">ready</span>
          </li>
        ))}
        {players.length < 2 ? (
          <li className="rounded-2xl border border-dashed border-line px-4 py-3 text-white/35">
            empty slot
          </li>
        ) : null}
      </ul>
    </section>
  );
}

function Question({
  question,
  endsAt,
  submitted,
  onSubmit,
  error,
}: {
  question: string;
  endsAt: number | null;
  submitted: boolean;
  onSubmit: (text: string) => void;
  error: string | null;
}) {
  const [text, setText] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit(text);
  }

  return (
    <section className="grid gap-8 lg:grid-cols-[1fr_320px]">
      <div className="rounded-3xl border border-line bg-panel/90 p-6 md:p-8">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm uppercase tracking-[0.25em] text-hot">write your stance</p>
          <Timer endsAt={endsAt} />
        </div>
        <h2 className="mt-6 font-display text-3xl leading-tight md:text-5xl">{question}</h2>
        {submitted ? (
          <p className="mt-10 rounded-2xl border border-lime/30 bg-lime/10 p-5 text-lime">
            Locked in. Waiting for the other player — or the clock.
          </p>
        ) : (
          <form onSubmit={submit} className="mt-8">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, MAX_ANSWER_LENGTH))}
              rows={8}
              placeholder="Your argument, no hedging…"
              className="w-full resize-none rounded-2xl border border-line bg-ink p-4 outline-none ring-lime/40 focus:ring-2"
            />
            <div className="mt-3 flex items-center justify-between text-sm text-white/40">
              <span>
                {text.length}/{MAX_ANSWER_LENGTH}
              </span>
              {error ? <span className="text-hot">{error}</span> : null}
            </div>
            <button className="glow-btn mt-4 rounded-2xl bg-lime px-6 py-3 font-display text-lg text-ink">
              lock stance
            </button>
          </form>
        )}
      </div>
      <aside className="rounded-3xl border border-line bg-panel/70 p-6">
        <h3 className="font-display text-2xl">Rules</h3>
        <ol className="mt-4 space-y-3 text-white/65">
          <li>1. You cannot see the other take yet.</li>
          <li>2. Submit early or ride the 5:00 timer.</li>
          <li>3. Chat opens for 15 minutes after both sides (or time) are in.</li>
        </ol>
      </aside>
    </section>
  );
}

function Debate({
  question,
  endsAt,
  stances,
  messages,
  playerId,
  onChat,
}: {
  question: string;
  endsAt: number | null;
  stances: { playerId: string; nickname: string; color: string; text: string }[];
  messages: { id: string; playerId: string; nickname: string; color: string; text: string }[];
  playerId: string | null;
  onChat: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim()) return;
    onChat(text);
    setText("");
  }

  return (
    <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
      <div>
        <div className="mb-4 flex items-end justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.25em] text-hot">debate</p>
            <h2 className="mt-2 font-display text-2xl md:text-3xl">{question}</h2>
          </div>
          <Timer endsAt={endsAt} />
        </div>
        <div className="grid gap-4">
          {stances.map((stance) => (
            <article key={stance.playerId} className="rounded-3xl border border-line bg-panel p-5">
              <p className="text-sm font-semibold" style={{ color: stance.color }}>
                {stance.nickname}
                {stance.playerId === playerId ? " (you)" : ""}
              </p>
              <p className="mt-2 whitespace-pre-wrap text-white/80">{stance.text}</p>
            </article>
          ))}
          {stances.length === 0 ? (
            <p className="rounded-3xl border border-dashed border-line p-5 text-white/40">
              Nobody locked a stance. Chat anyway.
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex h-[min(70vh,720px)] flex-col rounded-3xl border border-line bg-panel">
        <div ref={listRef} className="chat-scroller flex-1 space-y-3 overflow-y-auto p-4">
          {messages.length === 0 ? (
            <p className="pt-8 text-center text-white/35">First word wins the vibe.</p>
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                className={`max-w-[85%] rounded-2xl px-3 py-2 ${
                  message.playerId === playerId ? "ml-auto bg-lime/15" : "bg-ink"
                }`}
              >
                <p className="text-xs font-semibold" style={{ color: message.color }}>
                  {message.nickname}
                </p>
                <p className="text-sm text-white/90">{message.text}</p>
              </div>
            ))
          )}
        </div>
        <form onSubmit={submit} className="flex gap-2 border-t border-line p-3">
          <input
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MAX_CHAT_LENGTH))}
            placeholder="Argue in 280 characters…"
            className="flex-1 rounded-xl border border-line bg-ink px-3 py-2 outline-none ring-lime/40 focus:ring-2"
          />
          <button className="rounded-xl bg-lime px-4 font-display text-ink">send</button>
        </form>
      </div>
    </section>
  );
}

function Ended({
  question,
  stances,
  onAgain,
}: {
  question: string;
  endsAt?: number | null;
  stances: { playerId: string; nickname: string; color: string; text: string }[];
  onAgain: () => void;
}) {
  return (
    <section className="mx-auto max-w-3xl pt-6 text-center">
      <p className="text-sm uppercase tracking-[0.25em] text-white/40">time’s up</p>
      <h2 className="mt-3 font-display text-4xl md:text-5xl">{question}</h2>
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        {stances.map((stance) => (
          <article key={stance.playerId} className="rounded-3xl border border-line bg-panel p-5 text-left">
            <p className="font-semibold" style={{ color: stance.color }}>
              {stance.nickname}
            </p>
            <p className="mt-2 whitespace-pre-wrap text-white/75">{stance.text}</p>
          </article>
        ))}
      </div>
      <button
        onClick={onAgain}
        className="glow-btn mt-10 rounded-2xl bg-lime px-8 py-3 font-display text-xl text-ink"
      >
        rematch
      </button>
      <p className="mt-3 text-sm text-white/40">Both players need to still be here.</p>
    </section>
  );
}
