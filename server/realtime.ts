import type { RawData, WebSocket } from "ws";
import { normalizeCode, pauseGame } from "../shared/engine.js";
import type { GameState } from "../shared/game.js";
import type { GameRepository } from "./game-repository.js";
import { handleGameAction } from "./game-actions.js";
import type { ActionAuthorization } from "./game-actions.js";
import { gameViewFor } from "./game-view.js";

interface ClientEnvelope {
  id: string;
  event: string;
  payload: unknown;
}

const isEnvelope = (value: unknown): value is ClientEnvelope => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ClientEnvelope>;
  return typeof candidate.id === "string" && typeof candidate.event === "string";
};

export class GameRealtimeHub {
  private readonly subscriptions = new Map<WebSocket, Set<string>>();
  private readonly authorizations = new Map<WebSocket, ActionAuthorization>();
  private readonly actionQueues = new Map<WebSocket, Promise<void>>();
  private readonly seasonTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly repository: GameRepository) {}

  async register(
    socket: WebSocket,
    authorization: ActionAuthorization = { facilitator: false },
  ): Promise<void> {
    this.subscriptions.set(socket, new Set());
    this.authorizations.set(socket, authorization);

    let alive = true;
    const heartbeat = setInterval(() => {
      if (!alive) {
        socket.terminate();
        return;
      }
      alive = false;
      socket.ping();
    }, 25000);

    socket.on("pong", () => {
      alive = true;
    });
    socket.on("message", (data) => {
      const previous = this.actionQueues.get(socket) ?? Promise.resolve();
      const action = previous.then(() => this.handleMessage(socket, data, authorization));
      const queue = action.catch(() => undefined);
      this.actionQueues.set(socket, queue);
      void action.finally(() => {
        if (this.actionQueues.get(socket) === queue) this.actionQueues.delete(socket);
      });
    });

    await new Promise<void>((resolve) => {
      const close = () => {
        clearInterval(heartbeat);
        this.subscriptions.delete(socket);
        this.authorizations.delete(socket);
        this.actionQueues.delete(socket);
        resolve();
      };
      socket.once("close", close);
      socket.once("error", close);
    });
  }

  receiveGame(game: GameState): void {
    this.scheduleSeasonEnd(game);
    for (const [socket, codes] of this.subscriptions) {
      if (!codes.has(game.code)) continue;
      const authorization = this.authorizations.get(socket) ?? { facilitator: false };
      const message = JSON.stringify({
        type: "event",
        event: "game:state",
        payload: gameViewFor(game, authorization),
      });
      this.send(socket, message);
    }
  }

  close(): void {
    this.clearSeasonTimers();
    for (const socket of this.subscriptions.keys()) socket.close(1001, "Server shutting down");
  }

  private async handleMessage(
    socket: WebSocket,
    data: RawData,
    authorization: ActionAuthorization,
  ): Promise<void> {
    let envelope: unknown;
    try {
      envelope = JSON.parse(data.toString());
    } catch {
      this.sendAck(socket, "", { ok: false, error: "Invalid message." });
      return;
    }
    if (!isEnvelope(envelope)) {
      this.sendAck(socket, "", { ok: false, error: "Invalid message." });
      return;
    }

    if (envelope.event === "game:subscribe" && !authorization.facilitator && !authorization.player) {
      const requestedCode = normalizeCode(String(envelope.payload ?? ""));
      const subscriptions = this.subscriptions.get(socket);
      if (subscriptions && subscriptions.size > 0 && !subscriptions.has(requestedCode)) {
        this.sendAck(socket, envelope.id, {
          ok: false,
          error: "Open another browser tab to inspect a different group.",
        });
        return;
      }
    }

    try {
      const handled = await handleGameAction(
        this.repository,
        envelope.event,
        envelope.payload,
        authorization,
      );
      if (handled.subscriptionCode) {
        this.subscriptions.get(socket)?.add(normalizeCode(handled.subscriptionCode));
        if (envelope.event === "game:subscribe") {
          const latest = await this.repository.get(handled.subscriptionCode);
          if (latest) handled.result = { ok: true, data: gameViewFor(latest, authorization) };
        }
      }
      this.sendAck(socket, envelope.id, handled.result);
      if (handled.game) this.receiveGame(handled.game);
      if (handled.games) handled.games.forEach((game) => this.receiveGame(game));
      else if (envelope.event === "game:subscribe" && handled.result.ok && handled.result.data) {
        this.scheduleSeasonEnd(handled.result.data as GameState);
      }
    } catch (error) {
      console.error(`Failed to handle ${envelope.event}:`, error);
      this.sendAck(socket, envelope.id, {
        ok: false,
        error: "The server could not complete that action. Please try again.",
      });
    }
  }

  private scheduleSeasonEnd(game: GameState): void {
    const previous = this.seasonTimers.get(game.code);
    if (previous) clearTimeout(previous);
    this.seasonTimers.delete(game.code);
    if (game.settings.seasonLimitMode !== "time" || game.status !== "running" || !game.seasonStartedAt) return;

    const seasonStartedAt = game.seasonStartedAt;
    const deadline = seasonStartedAt + game.settings.seasonDurationSeconds * 1000;
    const timer = setTimeout(() => {
      void this.repository.mutate(game.code, (current) => {
        if (current.status !== "running" || current.seasonStartedAt !== seasonStartedAt) {
          return { ok: false, error: "Season already changed." };
        }
        return pauseGame(current);
      }).then((commit) => {
        if (commit.game) this.receiveGame(commit.game);
      });
    }, Math.max(0, deadline - Date.now()));
    this.seasonTimers.set(game.code, timer);
  }

  private clearSeasonTimers(): void {
    for (const timer of this.seasonTimers.values()) clearTimeout(timer);
    this.seasonTimers.clear();
  }

  private sendAck(socket: WebSocket, id: string, result: unknown): void {
    this.send(socket, JSON.stringify({ type: "ack", id, result }));
  }

  private send(socket: WebSocket, message: string): void {
    if (socket.readyState === socket.OPEN) socket.send(message);
  }
}
