export const QUESTION_MS = 5 * 60 * 1000;
export const DEBATE_MS = 15 * 60 * 1000;
export const RECONNECT_MS = 8 * 1000;
export const MAX_PLAYERS = 2;
export const MAX_ANSWER_LENGTH = 600;
export const MAX_CHAT_LENGTH = 280;
export const MAX_NICKNAME_LENGTH = 16;

export type Phase = "waiting" | "question" | "debate" | "ended";

export type PlayerPublic = {
  id: string;
  nickname: string;
  color: string;
  connected: boolean;
  hasAnswer: boolean;
};

export type Stance = {
  playerId: string;
  nickname: string;
  color: string;
  text: string;
};

export type ChatMessage = {
  id: string;
  playerId: string;
  nickname: string;
  color: string;
  text: string;
  at: number;
};

export type Surrender = {
  playerId: string;
  nickname: string;
};

export type RoomState = {
  code: string;
  phase: Phase;
  question: string;
  phaseEndsAt: number | null;
  players: PlayerPublic[];
  stances: Stance[];
  messages: ChatMessage[];
  myAnswer: string | null;
  surrender: Surrender | null;
};

export type ClientMessage =
  | { type: "join"; nickname: string; roomCode?: string; playerId: string }
  | { type: "resume"; playerId: string }
  | { type: "submit_answer"; text: string }
  | { type: "chat"; text: string }
  | { type: "play_again" };

export type ServerMessage =
  | { type: "welcome"; playerId: string; room: RoomState }
  | { type: "state"; room: RoomState }
  | { type: "chat"; message: ChatMessage }
  | { type: "opponent_left"; playerId: string; nickname: string }
  | { type: "error"; message: string };
