import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, RoomState, ServerMessage, Surrender } from "../../shared/protocol.ts";

type Status = "idle" | "connecting" | "playing";

const PLAYER_KEY = "argueio.playerId";
const NICK_KEY = "argueio.nickname";
const ACTIVE_KEY = "argueio.active";

export function getOrCreatePlayerId(): string {
  const existing = localStorage.getItem(PLAYER_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(PLAYER_KEY, id);
  return id;
}

function markActive(): void {
  localStorage.setItem(ACTIVE_KEY, "1");
}

function clearActive(): void {
  localStorage.removeItem(ACTIVE_KEY);
}

export function useGame() {
  const socketRef = useRef<WebSocket | null>(null);
  const statusRef = useRef<Status>("idle");
  const resumeAttempt = useRef(false);
  const [status, setStatus] = useState<Status>("idle");
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [surrender, setSurrender] = useState<Surrender | null>(null);

  const updateStatus = (next: Status) => {
    statusRef.current = next;
    setStatus(next);
  };

  const resetToHome = useCallback(() => {
    clearActive();
    resumeAttempt.current = false;
    setRoom(null);
    setSurrender(null);
    setError(null);
    updateStatus("idle");
  }, []);

  const send = useCallback((message: ClientMessage) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(message));
  }, []);

  const openSocket = useCallback((onOpen: (socket: WebSocket) => void) => {
    socketRef.current?.close();
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
    socketRef.current = socket;

    socket.onopen = () => onOpen(socket);
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as ServerMessage;
      if (message.type === "welcome") {
        resumeAttempt.current = false;
        localStorage.setItem(PLAYER_KEY, message.playerId);
        markActive();
        setPlayerId(message.playerId);
        setRoom(message.room);
        setSurrender(message.room.surrender);
        setError(null);
        updateStatus("playing");
      } else if (message.type === "state") {
        setRoom(message.room);
        setSurrender(message.room.surrender);
      } else if (message.type === "chat") {
        setRoom((current) => {
          if (!current) return current;
          if (current.messages.some((item) => item.id === message.message.id)) return current;
          return { ...current, messages: [...current.messages, message.message] };
        });
      } else if (message.type === "opponent_left") {
        setSurrender({ playerId: message.playerId, nickname: message.nickname });
      } else if (message.type === "left") {
        resetToHome();
      } else if (message.type === "error") {
        if (resumeAttempt.current) {
          resumeAttempt.current = false;
          clearActive();
          setRoom(null);
          setSurrender(null);
          updateStatus("idle");
          return;
        }
        setError(message.message);
        if (statusRef.current !== "playing") updateStatus("idle");
      }
    };
    socket.onclose = () => {
      if (statusRef.current === "connecting") updateStatus("idle");
    };
  }, [resetToHome]);

  const connect = useCallback(
    (nickname: string, roomCode?: string) => {
      setError(null);
      setSurrender(null);
      updateStatus("connecting");
      localStorage.setItem(NICK_KEY, nickname);
      const id = getOrCreatePlayerId();
      openSocket((socket) => {
        socket.send(
          JSON.stringify({
            type: "join",
            nickname,
            roomCode,
            playerId: id,
          } satisfies ClientMessage),
        );
      });
    },
    [openSocket],
  );

  const cancel = useCallback(() => {
    send({ type: "leave" });
  }, [send]);

  useEffect(() => {
    getOrCreatePlayerId();
    if (localStorage.getItem(ACTIVE_KEY) !== "1") return;
    resumeAttempt.current = true;
    updateStatus("connecting");
    const id = getOrCreatePlayerId();
    openSocket((socket) => {
      socket.send(JSON.stringify({ type: "resume", playerId: id } satisfies ClientMessage));
    });
  }, [openSocket]);

  useEffect(() => {
    return () => socketRef.current?.close();
  }, []);

  return { status, playerId, room, error, surrender, connect, cancel, send, setError };
}
