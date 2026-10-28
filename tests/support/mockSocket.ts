/**
 * Minimal in-memory WebSocket stand-in for deterministic integration tests.
 *
 * rooms.ts only touches a small subset of the real `ws` API: `readyState`,
 * `send`, `close`, and the `on("message"/"close"/"error")` handlers. This mock
 * reproduces that surface so we can drive the room logic without opening real
 * sockets or bound ports.
 */

export const WebSocketStates = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
} as const;

type MessageHandler = (data: string) => void;
type CloseHandler = () => void;
type ErrorHandler = () => void;

export class MockWebSocket {
  readyState: number = WebSocketStates.OPEN;
  readonly url: string;
  private sent: string[] = [];
  private onMessage?: MessageHandler;
  private onClose?: CloseHandler;
  private onError?: ErrorHandler;
  private closed = false;

  constructor(url: string) {
    this.url = url;
  }

  send(data: string): void {
    if (this.readyState !== WebSocketStates.OPEN) {
      throw new Error("WebSocket is not open");
    }
    this.sent.push(data);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.readyState = WebSocketStates.CLOSED;
    this.onClose?.();
  }

  // Called by the test harness to simulate the server pushing a message.
  receive(data: string): void {
    this.onMessage?.(data);
  }

  get lastSent(): string | null {
    return this.sent[this.sent.length - 1] ?? null;
  }

  get sentCount(): number {
    return this.sent.length;
  }

  clearSent(): void {
    this.sent = [];
  }

  on(event: string, handler: (...args: unknown[]) => void): void {
    if (event === "message") this.onMessage = handler as MessageHandler;
    else if (event === "close") this.onClose = handler as CloseHandler;
    else if (event === "error") this.onError = handler as ErrorHandler;
  }

  removeListener(): void {
    // No-op; mocks are discarded per test.
  }

  simulateClose(): void {
    this.close();
  }
}

export function createMockSocket(url = "ws://localhost/ws"): MockWebSocket {
  return new MockWebSocket(url);
}
