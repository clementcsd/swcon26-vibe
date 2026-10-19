import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  MAX_ANSWER_LENGTH,
  MAX_CHAT_LENGTH,
  MAX_NICKNAME_LENGTH,
  MAX_PLAYERS,
  MIN_PLAYERS,
  type PlayerPublic,
  type Surrender,
} from "../../shared/protocol.ts";
import { Timer } from "./Timer.tsx";
import { useGame } from "./useGame.ts";

export default function App() {
  const game = useGame();
  const { room, status, playerId, surrender, warning } = game;
  const me = room?.players.find((p) => p.id === playerId);
  const dropped = room?.players.filter((p) => p.id !== playerId && !p.connected) ?? [];
  const reconnecting = dropped.length > 0 && !surrender && room?.phase !== "waiting";

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
        {surrender && room ? <SurrenderBanner surrender={surrender} selfId={playerId} /> : null}
        {reconnecting ? (
          <p className="mb-4 rounded-2xl border border-amber-300/30 bg-amber-300/10 px-4 py-3 text-sm text-amber-200">
            {dropped.map((p) => p.nickname).join(", ")} dropped. Waiting to see if they reconnect…
          </p>
        ) : null}
        {status !== "playing" || !room ? (
          <Home error={game.error} connecting={status === "connecting"} onJoin={game.connect} />
        ) : room.phase === "waiting" ? (
          <Lobby
            roomCode={room.code}
            players={room.players}
            seatLimit={room.seatLimit}
            playerId={playerId}
            error={game.error}
            onCancel={game.cancel}
            onStart={() => game.send({ type: "start" })}
            onKick={(id) => game.send({ type: "kick", playerId: id })}
            onReport={(id) => game.send({ type: "report", playerId: id })}
            onSeats={(seats) => game.send({ type: "set_seats", seats })}
          />
        ) : room.phase === "question" ? (
          <Question
            roomCode={room.code}
            question={room.question}
            endsAt={room.phaseEndsAt}
            submitted={Boolean(me?.hasAnswer || room.myAnswer)}
            lockedText={room.myAnswer}
            onSubmit={(text) => game.send({ type: "submit_answer", text })}
            error={game.error}
          />
        ) : room.phase === "debate" ? (
          <Debate
            question={room.question}
            endsAt={room.phaseEndsAt}
            stances={room.stances}
            messages={room.messages}
            players={room.players}
            playerId={playerId}
            locked={Boolean(surrender)}
            warning={warning}
            onChat={(text) => game.send({ type: "chat", text })}
            onConcede={() => game.send({ type: "concede" })}
            onReport={(id) => game.send({ type: "report", playerId: id })}
          />
        ) : (
          <Ended
            question={room.question}
            stances={room.stances}
            surrender={surrender}
            consensus={room.consensus}
            selfId={playerId}
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
  const [nickname, setNickname] = useState(
    () => (typeof localStorage !== "undefined" && localStorage.getItem("argueio.nickname")) || "",
  );
  const [roomCode, setRoomCode] = useState("");

  function submit(event: FormEvent, withCode: boolean) {
    event.preventDefault();
    onJoin(nickname, withCode ? roomCode : undefined);
  }

  return (
    <section className="grid gap-10 pt-6 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
      <div>
        <p className="text-sm uppercase tracking-[0.25em] text-hot">live lobby</p>
        <h1 className="mt-3 max-w-xl font-display text-5xl leading-[0.95] sm:text-7xl">
          Drop a take.
          <br />
          Then fight for it.
        </h1>
        <p className="mt-5 max-w-lg text-lg text-white/65">
          Open a lobby, invite up to ten voices, then start when you’re ready. Five minutes to
          answer one question. Fifteen minutes of chat to debate.
        </p>
        <div className="mt-8 flex flex-wrap gap-3 text-sm text-white/50">
          <Pill>5:00 write</Pill>
          <Pill>15:00 debate</Pill>
          <Pill>2–10 players</Pill>
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
          {connecting ? "joining…" : "create lobby"}
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

function SurrenderBanner({ surrender, selfId }: { surrender: Surrender; selfId: string | null }) {
  const self = surrender.playerId === selfId;
  return (
    <p className="mb-4 rounded-2xl border border-hot/40 bg-hot/10 px-4 py-3 text-sm text-hot">
      {self
        ? "You left the arena — that counts as a surrender."
        : `${surrender.nickname} left the arena — they surrender.`}
    </p>
  );
}

function ReportButton({
  reported,
  onReport,
}: {
  reported: boolean;
  onReport: () => void;
}) {
  return (
    <button
      type="button"
      disabled={reported}
      onClick={onReport}
      className="text-xs uppercase tracking-widest text-white/40 hover:text-hot disabled:text-hot/50"
    >
      {reported ? "reported" : "report"}
    </button>
  );
}

function Lobby({
  roomCode,
  players,
  seatLimit,
  playerId,
  error,
  onCancel,
  onStart,
  onKick,
  onReport,
  onSeats,
}: {
  roomCode: string;
  players: PlayerPublic[];
  seatLimit: number;
  playerId: string | null;
  error: string | null;
  onCancel: () => void;
  onStart: () => void;
  onKick: (playerId: string) => void;
  onReport: (playerId: string) => void;
  onSeats: (seats: number) => void;
}) {
  const host = players.find((p) => p.id === playerId)?.isHost ?? false;
  const empty = Math.max(0, seatLimit - players.length);
  const canStart = players.filter((p) => p.connected).length >= MIN_PLAYERS;

  return (
    <section className="mx-auto max-w-xl pt-6">
      <p className="text-center text-sm uppercase tracking-[0.25em] text-white/40">lobby</p>
      <h2 className="mt-3 text-center font-display text-5xl">Share {roomCode}</h2>
      <p className="mt-3 text-center text-white/60">
        {host
          ? "Set the seats, kick anyone you don’t want, then start when the table feels right."
          : "Waiting for the host to start the debate."}
      </p>

      {host ? (
        <div className="mt-6 flex items-center justify-between rounded-2xl border border-line bg-panel px-4 py-3">
          <span className="text-sm text-white/60">seats</span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={seatLimit <= Math.max(MIN_PLAYERS, players.length)}
              onClick={() => onSeats(seatLimit - 1)}
              className="h-9 w-9 rounded-xl border border-line text-lg disabled:opacity-30"
            >
              −
            </button>
            <span className="font-display text-2xl tabular-nums text-lime">
              {seatLimit}
              <span className="text-sm text-white/40">/{MAX_PLAYERS}</span>
            </span>
            <button
              type="button"
              disabled={seatLimit >= MAX_PLAYERS}
              onClick={() => onSeats(seatLimit + 1)}
              className="h-9 w-9 rounded-xl border border-line text-lg disabled:opacity-30"
            >
              +
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-6 text-center text-sm text-white/40">
          {players.length}/{seatLimit} in the room
        </p>
      )}

      <ul className="mt-6 space-y-3">
        {players.map((player) => (
          <li
            key={player.id}
            className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-panel px-4 py-3"
          >
            <span className="font-medium" style={{ color: player.color }}>
              {player.nickname}
              {player.id === playerId ? " (you)" : ""}
            </span>
            <span className="flex items-center gap-3">
              {player.isHost ? (
                <span className="text-xs uppercase tracking-widest text-lime">host</span>
              ) : (
                <span className="text-xs uppercase tracking-widest text-white/40">ready</span>
              )}
              {player.id !== playerId ? (
                <ReportButton reported={player.youReported} onReport={() => onReport(player.id)} />
              ) : null}
              {host && !player.isHost ? (
                <button
                  type="button"
                  onClick={() => onKick(player.id)}
                  className="text-xs uppercase tracking-widest text-hot/80 hover:text-hot"
                >
                  kick
                </button>
              ) : null}
            </span>
          </li>
        ))}
        {Array.from({ length: empty }, (_, i) => (
          <li
            key={`empty-${i}`}
            className="rounded-2xl border border-dashed border-line px-4 py-3 text-white/35"
          >
            empty slot
          </li>
        ))}
      </ul>

      {error ? <p className="mt-4 text-center text-sm text-hot">{error}</p> : null}

      {host ? (
        <button
          type="button"
          disabled={!canStart}
          onClick={onStart}
          className="glow-btn mt-8 w-full rounded-2xl bg-lime py-3 font-display text-xl text-ink disabled:opacity-40"
        >
          start debate
        </button>
      ) : null}
      <button
        type="button"
        onClick={onCancel}
        className="mt-3 w-full rounded-2xl border border-line px-6 py-3 text-white/70 hover:border-hot/50 hover:text-hot"
      >
        {host ? "cancel lobby" : "leave lobby"}
      </button>
    </section>
  );
}

function Question({
  roomCode,
  question,
  endsAt,
  submitted,
  lockedText,
  onSubmit,
  error,
}: {
  roomCode: string;
  question: string;
  endsAt: number | null;
  submitted: boolean;
  lockedText: string | null;
  onSubmit: (text: string) => void;
  error: string | null;
}) {
  const draftKey = `argueio.draft.${roomCode}`;
  const [text, setText] = useState(() => localStorage.getItem(draftKey) ?? "");

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
          <div className="mt-10 rounded-2xl border border-lime/30 bg-lime/10 p-5">
            <p className="text-lime">Locked in. Waiting for everyone else — or the clock.</p>
            {lockedText ? (
              <p className="mt-3 whitespace-pre-wrap text-white/80">{lockedText}</p>
            ) : null}
          </div>
        ) : (
          <form onSubmit={submit} className="mt-8">
            <textarea
              value={text}
              onChange={(e) => {
                const next = e.target.value.slice(0, MAX_ANSWER_LENGTH);
                setText(next);
                localStorage.setItem(draftKey, next);
              }}
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
          <li>1. You cannot see the other takes yet.</li>
          <li>2. Submit early or ride the 5:00 timer.</li>
          <li>3. Chat opens for 15 minutes after everyone (or time) is in.</li>
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
  players,
  playerId,
  locked,
  warning,
  onChat,
  onConcede,
  onReport,
}: {
  question: string;
  endsAt: number | null;
  stances: { playerId: string; nickname: string; color: string; text: string }[];
  messages: { id: string; playerId: string; nickname: string; color: string; text: string }[];
  players: PlayerPublic[];
  playerId: string | null;
  locked: boolean;
  warning: string | null;
  onChat: (text: string) => void;
  onConcede: () => void;
  onReport: (playerId: string) => void;
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
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold" style={{ color: stance.color }}>
                  {stance.nickname}
                  {stance.playerId === playerId ? " (you)" : ""}
                </p>
                {stance.playerId !== playerId ? (
                  <ReportButton
                    reported={Boolean(players.find((p) => p.id === stance.playerId)?.youReported)}
                    onReport={() => onReport(stance.playerId)}
                  />
                ) : null}
              </div>
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
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold" style={{ color: message.color }}>
                    {message.nickname}
                  </p>
                  {message.playerId !== playerId ? (
                    <ReportButton
                      reported={Boolean(players.find((p) => p.id === message.playerId)?.youReported)}
                      onReport={() => onReport(message.playerId)}
                    />
                  ) : null}
                </div>
                <p className="text-sm text-white/90">{message.text}</p>
              </div>
            ))
          )}
        </div>
        {warning ? (
          <p className="border-t border-hot/30 bg-hot/10 px-3 py-2 text-xs text-hot">{warning}</p>
        ) : null}
        <form onSubmit={submit} className="flex gap-2 border-t border-line p-3">
          <input
            value={text}
            disabled={locked}
            onChange={(e) => setText(e.target.value.slice(0, MAX_CHAT_LENGTH))}
            placeholder={locked ? "Debate over." : "Argue in 280 characters…"}
            className="flex-1 rounded-xl border border-line bg-ink px-3 py-2 outline-none ring-lime/40 focus:ring-2 disabled:opacity-50"
          />
          <button disabled={locked} className="rounded-xl bg-lime px-4 font-display text-ink disabled:opacity-50">
            send
          </button>
        </form>
        <ConcedeBar players={players} playerId={playerId} locked={locked} onConcede={onConcede} />
      </div>
    </section>
  );
}

function ConcedeBar({
  players,
  playerId,
  locked,
  onConcede,
}: {
  players: PlayerPublic[];
  playerId: string | null;
  locked: boolean;
  onConcede: () => void;
}) {
  const me = players.find((p) => p.id === playerId);
  const live = players.filter((p) => p.connected);
  const agreed = live.filter((p) => p.conceded);
  const waiting = live.filter((p) => !p.conceded && p.id !== playerId);

  return (
    <div className="border-t border-line px-3 py-3">
      <button
        type="button"
        disabled={locked || Boolean(me?.conceded)}
        onClick={onConcede}
        className="w-full rounded-xl border border-lime/40 bg-lime/10 py-2 font-display text-lime disabled:opacity-40"
      >
        {me?.conceded ? "you agreed" : "Agree / Concede"}
      </button>
      <p className="mt-2 text-center text-xs text-white/40">
        {agreed.length}/{live.length} ready to end
        {waiting.length > 0 ? ` — waiting on ${waiting.map((p) => p.nickname).join(", ")}` : ""}
      </p>
    </div>
  );
}

function Ended({
  question,
  stances,
  surrender,
  consensus,
  selfId,
  onAgain,
}: {
  question: string;
  stances: { playerId: string; nickname: string; color: string; text: string }[];
  surrender: Surrender | null;
  consensus: boolean;
  selfId: string | null;
  onAgain: () => void;
}) {
  const label = consensus
    ? "consensus"
    : surrender
      ? surrender.playerId === selfId
        ? "you surrendered"
        : `${surrender.nickname} surrendered`
      : "time’s up";
  return (
    <section className="mx-auto max-w-3xl pt-6 text-center">
      <p className="text-sm uppercase tracking-[0.25em] text-white/40">{label}</p>
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
      <p className="mt-3 text-sm text-white/40">Everyone still here goes back to the lobby.</p>
    </section>
  );
}
