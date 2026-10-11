import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, RoomState, ServerMessage } from "../../shared/protocol.ts";

type Status = "idle" | "connecting" | "playing";

export function useGame() {
  const socketRef = useRef<WebSocket | null>(null);
  const statusRef = useRef<Status>("idle");
  const [status, setStatus] = useState<Status>("idle");
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const updateStatus = (next: Status) => {
    statusRef.current = next;
    setStatus(next);
  };

  const send = useCallback((message: ClientMessage) => {
    socketRef.current?.send(JSON.stringify(message));
  }, []);

  const connect = useCallback((nickname: string, roomCode?: string) => {
    setError(null);
    updateStatus("connecting");
    socketRef.current?.close();

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
    socketRef.current = socket;

    socket.onopen = () => {
      socket.send(JSON.stringify({ type: "join", nickname, roomCode } satisfies ClientMessage));
    };
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as ServerMessage;
      if (message.type === "welcome") {
        setPlayerId(message.playerId);
        setRoom(message.room);
        updateStatus("playing");
      } else if (message.type === "state") {
        setRoom(message.room);
      } else if (message.type === "chat") {
        setRoom((current) =>
          current
            ? { ...current, messages: [...current.messages, message.message] }
            : current,
        );
      } else if (message.type === "error") {
        setError(message.message);
        if (statusRef.current !== "playing") updateStatus("idle");
      }
    };
    socket.onclose = () => {
      if (statusRef.current === "connecting") updateStatus("idle");
    };
  }, []);

  useEffect(() => {
    return () => socketRef.current?.close();
  }, []);

  return { status, playerId, room, error, connect, send, setError };
}
