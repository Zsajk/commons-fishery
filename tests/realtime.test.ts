import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { addPlayer, createGame, startGame } from "../shared/engine.js";
import { LocalGameRepository } from "../server/game-repository.js";
import { GameRealtimeHub } from "../server/realtime.js";
import { FileGameStorage } from "../server/storage.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })),
  );
});

describe("season timer", () => {
  it("ends a running season automatically when time expires", async () => {
    vi.useFakeTimers();
    const directory = await mkdtemp(path.join(tmpdir(), "commons-fishery-realtime-"));
    temporaryDirectories.push(directory);
    const repository = new LocalGameRepository(
      new FileGameStorage(path.join(directory, "games.json")),
    );
    await repository.init();

    const game = createGame("TIMER1", "Timed season", { seasonDurationSeconds: 10 }, [
      { name: "Shore", startingPopulation: 100, carryingCapacity: 200 },
    ]);
    addPlayer(game, "Mira");
    expect(startGame(game).ok).toBe(true);
    await repository.create(game);

    const hub = new GameRealtimeHub(repository);
    hub.receiveGame(game);
    await vi.advanceTimersByTimeAsync(10_000);

    expect((await repository.get(game.code))?.status).toBe("paused");
    hub.close();
    await repository.close();
  });

  it("does not schedule a timer for fuel-limited seasons", async () => {
    vi.useFakeTimers();
    const directory = await mkdtemp(path.join(tmpdir(), "commons-fishery-realtime-"));
    temporaryDirectories.push(directory);
    const repository = new LocalGameRepository(
      new FileGameStorage(path.join(directory, "games.json")),
    );
    await repository.init();

    const game = createGame("FUEL2", "Fuel season", {
      seasonLimitMode: "fuel",
      seasonDurationSeconds: 10,
    }, [{ name: "Shore", startingPopulation: 100, carryingCapacity: 200 }]);
    addPlayer(game, "Mira");
    expect(startGame(game).ok).toBe(true);
    await repository.create(game);

    const hub = new GameRealtimeHub(repository);
    hub.receiveGame(game);
    await vi.advanceTimersByTimeAsync(60_000);

    expect((await repository.get(game.code))?.status).toBe("running");
    hub.close();
    await repository.close();
  });
});
