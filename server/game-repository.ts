import type { ActionResult, GameState } from "../shared/game.js";
import { migrateGameState, normalizeCode } from "../shared/engine.js";
import type { GameStorage } from "./storage.js";

export interface GameCommit<T = undefined> {
  result: ActionResult<T>;
  game?: GameState;
}

export interface GameRepository {
  readonly kind: string;
  init(): Promise<void>;
  get(code: string): Promise<GameState | undefined>;
  list(): Promise<GameState[]>;
  count(): Promise<number>;
  create(game: GameState): Promise<boolean>;
  mutate<T>(
    code: string,
    mutation: (game: GameState) => ActionResult<T>,
  ): Promise<GameCommit<T>>;
  remove(code: string): Promise<boolean>;
  close(): Promise<void>;
}

export class LocalGameRepository implements GameRepository {
  readonly kind: string;
  private readonly games = new Map<string, GameState>();
  private readonly mutationQueues = new Map<string, Promise<void>>();
  private readonly pendingGameCodes = new Set<string>();

  constructor(private readonly storage: GameStorage) {
    this.kind = storage.kind;
  }

  async init(): Promise<void> {
    await this.storage.init();
    for (const game of await this.storage.loadAll()) {
      const migrated = migrateGameState(game);
      this.games.set(migrated.code, migrated);
    }
  }

  async get(code: string): Promise<GameState | undefined> {
    return this.games.get(normalizeCode(code));
  }

  async list(): Promise<GameState[]> {
    return structuredClone([...this.games.values()]);
  }

  async count(): Promise<number> {
    return this.games.size;
  }

  async create(game: GameState): Promise<boolean> {
    const code = normalizeCode(game.code);
    if (this.games.has(code) || this.pendingGameCodes.has(code)) return false;
    this.pendingGameCodes.add(code);
    try {
      await this.storage.save(game);
      this.games.set(code, game);
      return true;
    } finally {
      this.pendingGameCodes.delete(code);
    }
  }

  async mutate<T>(
    code: string,
    mutation: (game: GameState) => ActionResult<T>,
  ): Promise<GameCommit<T>> {
    const normalizedCode = normalizeCode(code);
    const game = this.games.get(normalizedCode);
    if (!game) return { result: { ok: false, error: "Game not found." } };

    const previousQueue = this.mutationQueues.get(normalizedCode) ?? Promise.resolve();
    const operation = previousQueue.then(async (): Promise<GameCommit<T>> => {
      const previous = structuredClone(game);
      try {
        const result = mutation(game);
        if (!result.ok) return { result };
        await this.storage.save(game);
        return { result, game };
      } catch (error) {
        Object.assign(game, previous);
        console.error(`Failed to update game ${normalizedCode}:`, error);
        return {
          result: { ok: false, error: "The game could not be saved. Please try again." },
        };
      }
    });
    const queue = operation.then(() => undefined, () => undefined);
    this.mutationQueues.set(normalizedCode, queue);
    const result = await operation;
    if (this.mutationQueues.get(normalizedCode) === queue) {
      this.mutationQueues.delete(normalizedCode);
    }
    return result;
  }

  async remove(code: string): Promise<boolean> {
    const normalizedCode = normalizeCode(code);
    const previousQueue = this.mutationQueues.get(normalizedCode) ?? Promise.resolve();
    const operation = previousQueue.then(async () => {
      if (!this.games.has(normalizedCode)) return false;
      const removed = await this.storage.remove(normalizedCode);
      if (removed) this.games.delete(normalizedCode);
      return removed;
    });
    const queue = operation.then(() => undefined, () => undefined);
    this.mutationQueues.set(normalizedCode, queue);
    const result = await operation;
    if (this.mutationQueues.get(normalizedCode) === queue) {
      this.mutationQueues.delete(normalizedCode);
    }
    return result;
  }

  async close(): Promise<void> {
    await Promise.all(this.mutationQueues.values());
    await this.storage.close();
  }
}
