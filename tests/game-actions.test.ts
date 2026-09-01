import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ActionResult, GameState } from "../shared/game.js";
import { buildGroupStandings, handleGameAction } from "../server/game-actions.js";
import { addPlayer, createGame } from "../shared/engine.js";
import { LocalGameRepository } from "../server/game-repository.js";
import { FileGameStorage } from "../server/storage.js";

const facilitator = { facilitator: true };
const joinAuthorization = { facilitator: false, allowPlayerJoin: true };

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })),
  );
});

async function repository() {
  const directory = await mkdtemp(path.join(tmpdir(), "commons-fishery-actions-"));
  temporaryDirectories.push(directory);
  const result = new LocalGameRepository(
    new FileGameStorage(path.join(directory, "games.json")),
  );
  await result.init();
  return result;
}

describe("realtime game actions", () => {
  it("creates and launches a ready workshop from one facilitator action", async () => {
    const games = await repository();
    const created = await handleGameAction(games, "host:create-workshop", {
      workshopName: "Workshop test",
      groupCount: 3,
      groupPrefix: "Table",
      settings: { expectedPlayerCount: 1, workshopName: "Workshop test" },
      stations: [{ name: "Bay", startingPopulation: 50, carryingCapacity: 100 }],
      rounds: [],
    }, facilitator);
    expect(created.result.ok).toBe(true);
    const workshopGames = (created.result as ActionResult<GameState[]>).data!;
    expect(workshopGames).toHaveLength(3);
    expect(new Set(workshopGames.map((game) => game.code)).size).toBe(3);

    for (const game of workshopGames) {
      const joined = await handleGameAction(games, "player:join", {
        code: game.code,
        name: `Player ${game.code}`,
      }, joinAuthorization);
      const playerId = (joined.result as ActionResult<{ playerId: string }>).data!.playerId;
      const ready = await handleGameAction(games, "player:ready", {
        code: game.code,
        ready: true,
      }, { facilitator: false, player: { code: game.code, playerId } });
      expect(ready.result).toEqual({ ok: true, data: { started: false } });
    }

    const started = await handleGameAction(games, "host:workshop-command", {
      workshopName: "Workshop test",
      command: "start",
    }, facilitator);
    expect(started.result.ok).toBe(true);
    for (const game of await games.list()) {
      expect(game.status).toBe("running");
      expect(game.countdownEndsAt).toBeGreaterThan(Date.now());
    }
    await games.close();
  });

  it("runs two villages through the shared action router", async () => {
    const games = await repository();
    const created = await handleGameAction(games, "host:create", {
      code: "WS1234",
      title: "Two waters",
      settings: { villageCount: 2, scaleResourcesToPlayers: false },
      stations: [{ name: "Bay", startingPopulation: 20, carryingCapacity: 40 }],
    }, facilitator);
    expect(created.result.ok).toBe(true);

    const initial = created.result as ActionResult<GameState>;
    const villages = initial.data!.villages;
    const firstJoin = await handleGameAction(games, "player:join", {
      code: "WS1234",
      name: "Ada",
      villageId: villages[0].id,
    }, joinAuthorization);
    const secondJoin = await handleGameAction(games, "player:join", {
      code: "WS1234",
      name: "Ben",
      villageId: villages[1].id,
    }, joinAuthorization);
    expect(firstJoin.result.ok).toBe(true);
    expect(secondJoin.result.ok).toBe(true);

    const started = await handleGameAction(games, "host:command", {
      code: "WS1234",
      command: "start",
    }, facilitator);
    expect(started.result.ok).toBe(true);

    const current = await games.get("WS1234");
    current!.countdownEndsAt = null;
    current!.seasonStartedAt = Date.now();
    const firstPlayer = current!.players.find((player) => player.villageId === villages[0].id)!;
    const secondPlayer = current!.players.find((player) => player.villageId === villages[1].id)!;
    const firstStation = current!.stations.find((station) => station.villageId === villages[0].id)!;
    const caught = await handleGameAction(games, "player:fish", {
      code: "WS1234",
      playerId: firstPlayer.id,
      stationId: firstStation.id,
    }, {
      facilitator: false,
      player: { code: "WS1234", playerId: firstPlayer.id },
    });
    expect(caught.result.ok).toBe(true);

    const saved = await games.get("WS1234");
    expect(saved!.stations.find((station) => station.id === firstStation.id)!.population).toBe(15);
    expect(saved!.stations.find((station) => station.villageId === villages[1].id)!.population).toBe(20);

    await handleGameAction(games, "host:command", { code: "WS1234", command: "pause" }, facilitator);
    const firstReady = await handleGameAction(games, "player:ready", {
      code: "WS1234",
      ready: true,
    }, { facilitator: false, player: { code: "WS1234", playerId: firstPlayer.id } });
    expect(firstReady.result).toEqual({ ok: true, data: { started: false } });
    const secondReady = await handleGameAction(games, "player:ready", {
      code: "WS1234",
      ready: true,
    }, { facilitator: false, player: { code: "WS1234", playerId: secondPlayer.id } });
    expect(secondReady.result).toEqual({ ok: true, data: { started: true } });
    expect((await games.get("WS1234"))!.season).toBe(2);
    expect((await games.get("WS1234"))!.status).toBe("running");
    await games.close();
  });

  it("rejects duplicate room codes", async () => {
    const games = await repository();
    const payload = {
      code: "SAME01",
      title: "First",
      settings: {},
      stations: [{ name: "Bay", startingPopulation: 20, carryingCapacity: 40 }],
    };
    expect((await handleGameAction(games, "host:create", payload, facilitator)).result.ok).toBe(true);
    const duplicate = await handleGameAction(games, "host:create", payload, facilitator);
    expect(duplicate.result).toEqual({ ok: false, error: "That game code is already in use." });
    await games.close();
  });

  it("rejects room codes that are too easy to enumerate", async () => {
    const games = await repository();
    const created = await handleGameAction(games, "host:create", {
      code: "SHORT",
      title: "Short code",
      settings: {},
      stations: [{ name: "Bay", startingPopulation: 20, carryingCapacity: 40 }],
    }, facilitator);
    expect(created.result).toEqual({
      ok: false,
      error: "Use a game code with at least six characters.",
    });
    await games.close();
  });

  it("limits a room to its configured group size", async () => {
    const games = await repository();
    await handleGameAction(games, "host:create", {
      code: "FULL01",
      title: "Group one",
      settings: { expectedPlayerCount: 1 },
      stations: [{ name: "Bay", startingPopulation: 20, carryingCapacity: 40 }],
    }, facilitator);
    expect((await handleGameAction(games, "player:join", {
      code: "FULL01", name: "Ada",
    }, joinAuthorization)).result.ok).toBe(true);
    expect((await handleGameAction(games, "player:join", {
      code: "FULL01", name: "Ben",
    }, joinAuthorization)).result).toEqual({ ok: false, error: "This group is full." });
    await games.close();
  });

  it("ranks groups by extraction and keeps collapse eligibility configurable", () => {
    const station = [{ name: "Bay", startingPopulation: 20, carryingCapacity: 40 }];
    const survivor = createGame("RANK1", "Survivors", {
      workshopName: "Alpbach",
      collapsedGroupsCanWin: true,
    }, station);
    const collapsed = createGame("RANK2", "Fast extractors", {
      workshopName: "Alpbach",
      collapsedGroupsCanWin: true,
    }, station);
    addPlayer(survivor, "Ada");
    addPlayer(collapsed, "Ben");
    survivor.stations[0].totalCaught = 60;
    collapsed.stations[0].totalCaught = 100;
    collapsed.villages[0].collapsedAtSeason = 2;
    survivor.status = "ended";
    collapsed.status = "ended";

    const included = buildGroupStandings([survivor, collapsed], "alpbach");
    expect(included.map((standing) => standing.groupName)).toEqual(["Fast extractors", "Survivors"]);
    expect(included[0]).toEqual(expect.objectContaining({
      totalExtracted: 100,
      eligibleForWin: true,
      collapsedAtSeason: 2,
    }));

    survivor.settings.collapsedGroupsCanWin = false;
    collapsed.settings.collapsedGroupsCanWin = false;
    const excluded = buildGroupStandings([survivor, collapsed], "alpbach");
    expect(excluded.map((standing) => standing.groupName)).toEqual(["Survivors", "Fast extractors"]);
    expect(excluded[0].eligibleForWin).toBe(true);
    expect(excluded[1]).toEqual(expect.objectContaining({
      totalExtracted: 100,
      eligibleForWin: false,
      collapsedAtSeason: 2,
    }));
  });

  it("rejects host commands without facilitator access", async () => {
    const games = await repository();
    const created = await handleGameAction(games, "host:create", {
      code: "LOCKED",
      title: "Protected waters",
      settings: {},
      stations: [{ name: "Bay", startingPopulation: 20, carryingCapacity: 40 }],
    }, facilitator);
    expect(created.result.ok).toBe(true);

    const started = await handleGameAction(games, "host:command", {
      code: "LOCKED",
      command: "start",
    });
    expect(started.result).toEqual({ ok: false, error: "Facilitator access is required." });
    expect((await games.get("LOCKED"))!.status).toBe("setup");
    await games.close();
  });

  it("lists, ends, and removes facilitator games", async () => {
    const games = await repository();
    const created = await handleGameAction(games, "host:create", {
      code: "MANAGE1",
      title: "Managed waters",
      settings: {},
      stations: [{ name: "Bay", startingPopulation: 20, carryingCapacity: 40 }],
    }, facilitator);
    expect(created.result.ok).toBe(true);

    const anonymousList = await handleGameAction(games, "host:list", {});
    expect(anonymousList.result).toEqual({ ok: false, error: "Facilitator access is required." });

    const listed = await handleGameAction(games, "host:list", {}, facilitator);
    const summaries = (listed.result as ActionResult<Array<{ code: string; title: string }>>).data!;
    expect(summaries).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "MANAGE1", title: "Managed waters" }),
    ]));

    expect((await handleGameAction(games, "host:command", {
      code: "MANAGE1",
      command: "end",
    }, facilitator)).result.ok).toBe(true);
    expect((await handleGameAction(games, "host:delete", {
      code: "MANAGE1",
    }, facilitator)).result.ok).toBe(true);
    expect(await games.get("MANAGE1")).toBeUndefined();
    await games.close();
  });

  it("binds player actions to the authenticated player and room", async () => {
    const games = await repository();
    const created = await handleGameAction(games, "host:create", {
      code: "PLAY01",
      title: "Protected players",
      settings: {},
      stations: [{ name: "Bay", startingPopulation: 20, carryingCapacity: 40 }],
    }, facilitator);
    const game = (created.result as ActionResult<GameState>).data!;
    const joined = await handleGameAction(games, "player:join", {
      code: game.code,
      name: "Ada",
      villageId: game.villages[0].id,
    }, joinAuthorization);
    const playerId = (joined.result as ActionResult<{ playerId: string }>).data!.playerId;

    const crossRoomSubscription = await handleGameAction(games, "game:subscribe", "OTHER1", {
      facilitator: false,
      player: { code: game.code, playerId },
    });
    expect(crossRoomSubscription.result).toEqual({
      ok: false,
      error: "Your player session belongs to a different group.",
    });
    await handleGameAction(games, "host:command", {
      code: game.code,
      command: "start",
    }, facilitator);

    const stationId = (await games.get(game.code))!.stations[0].id;
    const impersonation = await handleGameAction(games, "player:fish", {
      code: game.code,
      playerId: "someone-else",
      stationId,
    }, { facilitator: false, player: { code: game.code, playerId } });
    expect(impersonation.result).toEqual({
      ok: false,
      error: "Your player session is missing or no longer valid.",
    });
    expect((await games.get(game.code))!.stations[0].population).toBe(20);
    await games.close();
  });
});
