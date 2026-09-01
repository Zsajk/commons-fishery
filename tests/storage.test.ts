import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createGame } from "../shared/engine.js";
import { FileGameStorage } from "../server/storage.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function temporaryStore() {
  const directory = await mkdtemp(path.join(tmpdir(), "commons-fishery-storage-"));
  temporaryDirectories.push(directory);
  return new FileGameStorage(path.join(directory, "games.json"));
}

describe("file game storage", () => {
  it("restores a complete game in a new storage instance", async () => {
    const firstStore = await temporaryStore();
    await firstStore.init();
    const game = createGame("SAVE1", "Saved lake", { reproductionRate: 1.75 }, [
      { name: "Harbor", startingPopulation: 75, carryingCapacity: 180 },
    ]);
    game.season = 3;
    game.stations[0].population = 42;
    await firstStore.save(game);
    await firstStore.close();

    const secondStore = new FileGameStorage(path.join(temporaryDirectories[0], "games.json"));
    await secondStore.init();
    const restored = await secondStore.loadAll();

    expect(restored).toHaveLength(1);
    expect(restored[0].code).toBe("SAVE1");
    expect(restored[0].season).toBe(3);
    expect(restored[0].settings.reproductionRate).toBe(1.75);
    expect(restored[0].stations[0].population).toBe(42);
  });

  it("updates an existing game instead of creating duplicates", async () => {
    const store = await temporaryStore();
    await store.init();
    const game = createGame("SAVE2", "Saved lake", {}, [
      { name: "Harbor", startingPopulation: 75, carryingCapacity: 180 },
    ]);
    await store.save(game);
    game.season = 2;
    await store.save(game);

    const restored = await store.loadAll();
    expect(restored).toHaveLength(1);
    expect(restored[0].season).toBe(2);
  });

  it("removes a saved game permanently", async () => {
    const store = await temporaryStore();
    await store.init();
    const game = createGame("SAVE3", "Temporary lake", {}, [
      { name: "Harbor", startingPopulation: 75, carryingCapacity: 180 },
    ]);
    await store.save(game);

    expect(await store.remove(game.code)).toBe(true);
    expect(await store.remove(game.code)).toBe(false);
    expect(await store.loadAll()).toEqual([]);
  });
});
