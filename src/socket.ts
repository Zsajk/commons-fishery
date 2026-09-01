type Listener = (...args: never[]) => void;
type Ack<T = unknown> = (result: T) => void;

interface PendingRequest {
  callback: Ack;
  timeout: ReturnType<typeof setTimeout>;
}

interface ServerEnvelope {
  type: "ack" | "event";
  id?: string;
  event?: string;
  result?: unknown;
  payload?: unknown;
}

class RealtimeSocket {
  connected = false;
  private webSocket: WebSocket | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly pending = new Map<string, PendingRequest>();

  constructor() {
    this.connect();
  }

  on(event: string, listener: Listener): void {
    const listeners = this.listeners.get(event) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  }

  off(event: string, listener: Listener): void {
    this.listeners.get(event)?.delete(listener);
  }

  emit<T = unknown>(event: string, payload: unknown, callback?: Ack<T>): void {
    const id = crypto.randomUUID();
    if (!this.webSocket || this.webSocket.readyState !== WebSocket.OPEN) {
      callback?.({ ok: false, error: "Reconnecting. Please try again in a moment." } as T);
      return;
    }

    if (callback) {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        callback({ ok: false, error: "The server did not respond. Please try again." } as T);
      }, 10000);
      this.pending.set(id, { callback: callback as Ack, timeout });
    }

    this.webSocket.send(JSON.stringify({ id, event, payload }));
  }

  private connect(): void {
    if (typeof window === "undefined") return;
    if (
      this.webSocket &&
      (this.webSocket.readyState === WebSocket.OPEN ||
        this.webSocket.readyState === WebSocket.CONNECTING)
    ) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const webSocket = new WebSocket(`${protocol}//${window.location.host}/api/ws`);
    this.webSocket = webSocket;

    webSocket.addEventListener("open", () => {
      if (this.webSocket !== webSocket) return;
      this.connected = true;
      this.reconnectAttempt = 0;
      this.dispatch("connect");
    });

    webSocket.addEventListener("message", (message) => {
      let envelope: ServerEnvelope;
      try {
        envelope = JSON.parse(String(message.data)) as ServerEnvelope;
      } catch {
        return;
      }

      if (envelope.type === "ack" && envelope.id) {
        const request = this.pending.get(envelope.id);
        if (!request) return;
        clearTimeout(request.timeout);
        this.pending.delete(envelope.id);
        request.callback(envelope.result);
      } else if (envelope.type === "event" && envelope.event) {
        this.dispatch(envelope.event, envelope.payload);
      }
    });

    const reconnect = () => {
      if (this.webSocket !== webSocket) return;
      this.connected = false;
      this.failPending();
      this.dispatch("disconnect");
      this.scheduleReconnect();
    };
    webSocket.addEventListener("close", reconnect, { once: true });
    webSocket.addEventListener("error", () => webSocket.close(), { once: true });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = Math.min(300 * 2 ** this.reconnectAttempt, 5000);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private failPending(): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timeout);
      request.callback({ ok: false, error: "Connection lost. Please try again." });
    }
    this.pending.clear();
  }

  private dispatch(event: string, payload?: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) {
      (listener as (value?: unknown) => void)(payload);
    }
  }
}

export const socket = new RealtimeSocket();

export function emitWithAck<T>(event: string, payload: unknown): Promise<T> {
  return new Promise((resolve) => socket.emit(event, payload, (result) => resolve(result as T)));
}
