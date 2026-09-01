import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import type { GameState } from "../shared/game.js";

export interface GameStorage {
  readonly kind: "file" | "postgres";
  init(): Promise<void>;
  loadAll(): Promise<GameState[]>;
  save(game: GameState): Promise<void>;
  remove(code: string): Promise<boolean>;
  close(): Promise<void>;
}

export class FileGameStorage implements GameStorage {
  readonly kind = "file" as const;
  private readonly games = new Map<string, GameState>();
  private writeQueue = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async init(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as GameState[];
      for (const game of parsed) this.games.set(game.code, game);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  async loadAll(): Promise<GameState[]> {
    return structuredClone([...this.games.values()]);
  }

  async save(game: GameState): Promise<void> {
    const snapshot = structuredClone(game);
    this.writeQueue = this.writeQueue.catch(() => undefined).then(async () => {
      const previous = this.games.get(game.code);
      this.games.set(game.code, snapshot);
      const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
      try {
        await writeFile(temporaryPath, JSON.stringify([...this.games.values()], null, 2), "utf8");
        await rename(temporaryPath, this.filePath);
      } catch (error) {
        if (previous) this.games.set(game.code, previous);
        else this.games.delete(game.code);
        throw error;
      }
    });
    await this.writeQueue;
  }

  async remove(code: string): Promise<boolean> {
    let removed = false;
    this.writeQueue = this.writeQueue.catch(() => undefined).then(async () => {
      const previous = this.games.get(code);
      if (!previous) return;
      this.games.delete(code);
      const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
      try {
        await writeFile(temporaryPath, JSON.stringify([...this.games.values()], null, 2), "utf8");
        await rename(temporaryPath, this.filePath);
        removed = true;
      } catch (error) {
        this.games.set(code, previous);
        throw error;
      }
    });
    await this.writeQueue;
    return removed;
  }

  async close(): Promise<void> {
    await this.writeQueue;
  }
}

export class PostgresGameStorage implements GameStorage {
  readonly kind = "postgres" as const;
  private readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 5 });
  }

  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS common_waters_games (
        code TEXT PRIMARY KEY,
        state JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  }

  async loadAll(): Promise<GameState[]> {
    const result = await this.pool.query<{ state: GameState }>(
      "SELECT state FROM common_waters_games ORDER BY updated_at DESC",
    );
    return result.rows.map((row) => row.state);
  }

  async save(game: GameState): Promise<void> {
    await this.pool.query(
      `INSERT INTO common_waters_games (code, state, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (code) DO UPDATE
       SET state = EXCLUDED.state, updated_at = NOW()`,
      [game.code, JSON.stringify(game)],
    );
  }

  async remove(code: string): Promise<boolean> {
    const result = await this.pool.query(
      "DELETE FROM common_waters_games WHERE code = $1",
      [code],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export function createGameStorage(root: string): GameStorage {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) return new PostgresGameStorage(databaseUrl);
  const filePath = process.env.GAME_DATA_FILE || path.join(root, ".data", "games.json");
  return new FileGameStorage(filePath);
}
