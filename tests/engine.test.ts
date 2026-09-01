import { describe, expect, it } from "vitest";
import {
  addPlayer,
  advanceSeason,
  calculateNextPopulation,
  createGame,
  fish,
  migrateGameState,
  pauseGame,
  prepareNextRound,
  purchaseBoat,
  researchStation,
  setPlayerReady,
  startGame,
  startOrAdvanceSeason,
  tradeFish,
} from "../shared/engine.js";
import { defaultSettings } from "../shared/game.js";

describe("fish replenishment", () => {
  it("multiplies the remaining stock and respects capacity", () => {
    const settings = { growthModel: "multiplier" as const, reproductionRate: 2 };
    expect(calculateNextPopulation(50, 200, settings)).toBe(100);
    expect(calculateNextPopulation(150, 200, settings)).toBe(200);
  });

  it("supports density-limited growth", () => {
    const settings = { growthModel: "logistic" as const, reproductionRate: 1 };
    expect(calculateNextPopulation(50, 200, settings)).toBe(88);
    expect(calculateNextPopulation(200, 200, settings)).toBe(200);
  });

  it("does not regenerate a population after complete depletion", () => {
    expect(calculateNextPopulation(0, 200, { growthModel: "multiplier", reproductionRate: 3 })).toBe(0);
    expect(calculateNextPopulation(0, 200, { growthModel: "logistic", reproductionRate: 2 })).toBe(0);
  });

  it("supports a finite pool with no replenishment", () => {
    expect(calculateNextPopulation(47, 200, { growthModel: "none", reproductionRate: 0 })).toBe(47);
  });
});

describe("season lifecycle", () => {
  it("migrates legacy station controls to selectable on-screen stations", () => {
    const game = createGame("LAKE0", "Legacy controls", {}, [
      { name: "Shore", startingPopulation: 100, carryingCapacity: 200 },
    ]);
    const legacySettings = game.settings as unknown as Record<string, unknown>;
    const player = addPlayer(game, "Mira");
    delete legacySettings.stationSelectionMode;
    delete legacySettings.seasonLimitMode;
    delete legacySettings.seasonFuel;
    delete legacySettings.collapsedGroupsCanWin;
    legacySettings.remoteFishingEnabled = false;
    delete (player as unknown as Record<string, unknown>).fuel;

    migrateGameState(game);

    expect(game.settings.stationSelectionMode).toBe("buttons");
    expect(game.settings.seasonLimitMode).toBe("time");
    expect(game.settings.seasonFuel).toBe(10);
    expect(game.settings.researchCost).toBe(0);
    expect(game.settings.showSeasonCountToPlayers).toBe(false);
    expect(game.settings.collapsedGroupsCanWin).toBe(true);
    expect(player.fuel).toBe(10);
    expect("remoteFishingEnabled" in game.settings).toBe(false);
  });

  it("allows repeated fishing until the season timer ends", () => {
    const game = createGame("LAKE1", "Test lake", {}, [
      { name: "Shore", startingPopulation: 100, carryingCapacity: 200 },
    ]);
    const player = addPlayer(game, "Mira");

    expect(startGame(game).ok).toBe(true);
    expect(fish(game, player.id, game.stations[0].id, () => 0.5)).toEqual({
      ok: true,
      data: { caught: 5 },
    });
    expect(game.stations[0].population).toBe(95);
    expect(player.balance).toBe(25);
    expect(fish(game, player.id, game.stations[0].id, () => 0.5).ok).toBe(true);
    game.seasonStartedAt = Date.now() - game.settings.seasonDurationSeconds * 1000;
    expect(fish(game, player.id, game.stations[0].id, () => 0.5)).toEqual({
      ok: false,
      error: "The season timer has ended.",
    });
  });

  it("uses personal fuel instead of time and ends when every fisher is out", () => {
    const game = createGame("FUEL1", "Fuel season", {
      seasonLimitMode: "fuel",
      seasonFuel: 2,
      seasonDurationSeconds: 10,
    }, [{ name: "Shore", startingPopulation: 100, carryingCapacity: 200 }]);
    const first = addPlayer(game, "Mira");
    const second = addPlayer(game, "Noah");

    expect(startGame(game).ok).toBe(true);
    game.seasonStartedAt = Date.now() - 60_000;
    expect(fish(game, first.id, game.stations[0].id).ok).toBe(true);
    expect(first.fuel).toBe(0);
    expect(game.status).toBe("running");
    expect(fish(game, first.id, game.stations[0].id)).toEqual({
      ok: false,
      error: "Not enough fuel remains for another trip.",
    });
    expect(fish(game, second.id, game.stations[0].id).ok).toBe(true);
    expect(second.fuel).toBe(0);
    expect(game.status).toBe("paused");

    expect(advanceSeason(game).ok).toBe(true);
    expect(first.fuel).toBe(2);
    expect(second.fuel).toBe(2);
  });

  it("replenishes stocks and charges maintenance between seasons", () => {
    const game = createGame("LAKE2", "Test lake", {}, [
      { name: "Shore", startingPopulation: 100, carryingCapacity: 200 },
    ]);
    const player = addPlayer(game, "Noah");
    startGame(game);
    fish(game, player.id, game.stations[0].id, () => 0.5);
    pauseGame(game);

    expect(advanceSeason(game).ok).toBe(true);
    expect(game.season).toBe(2);
    expect(game.stations[0].population).toBe(190);
    expect(game.stations[0].lastGrowth).toBe(95);
    expect(player.balance).toBe(5);
  });

  it("supports boat upgrades and voluntary transfers between seasons", () => {
    const game = createGame("LAKE3", "Test lake", { startingBalance: 100 }, [
      { name: "Shore", startingPopulation: 100, carryingCapacity: 200 },
    ]);
    const first = addPlayer(game, "Ada");
    const second = addPlayer(game, "Ben");

    expect(purchaseBoat(game, first.id, "skiff").ok).toBe(true);
    expect(first.balance).toBe(65);
    expect(first.boatId).toBe("skiff");
    expect(tradeFish(game, first.id, second.id, 10).ok).toBe(true);
    expect(first.balance).toBe(55);
    expect(second.balance).toBe(110);
    expect(tradeFish(game, first.id, second.id, Number.NaN).ok).toBe(false);
    expect(first.balance).toBe(55);
    expect(second.balance).toBe(110);
  });

  it("only advances after a completed season and never charges twice on resume", () => {
    const game = createGame("LAKE4", "Test lake", {}, [
      { name: "Shore", startingPopulation: 100, carryingCapacity: 200 },
    ]);
    const player = addPlayer(game, "Rae");

    expect(advanceSeason(game).ok).toBe(false);
    expect(startGame(game).ok).toBe(true);
    expect(player.balance).toBe(20);
    expect(advanceSeason(game).ok).toBe(false);
    expect(pauseGame(game).ok).toBe(true);
    expect(startGame(game).ok).toBe(true);
    expect(player.balance).toBe(20);
    expect(pauseGame(game).ok).toBe(true);
    expect(advanceSeason(game).ok).toBe(true);
    expect(player.balance).toBe(0);
    expect(advanceSeason(game).ok).toBe(false);
    expect(player.balance).toBe(0);
  });

  it("keeps research and trading between seasons", () => {
    const game = createGame("LAKE5", "Test lake", {}, [
      { name: "Shore", startingPopulation: 100, carryingCapacity: 200 },
    ]);
    const first = addPlayer(game, "Ari");
    const second = addPlayer(game, "Bo");

    expect(researchStation(game, first.id, game.stations[0].id)).toEqual({
      ok: true,
      data: { population: 100 },
    });
    expect(researchStation(game, first.id, game.stations[0].id).ok).toBe(false);
    expect(tradeFish(game, first.id, second.id, 5).ok).toBe(true);
    expect(startGame(game).ok).toBe(true);
    expect(first.knownStations).toEqual({});
    expect(researchStation(game, first.id, game.stations[0].id).ok).toBe(false);
    expect(tradeFish(game, first.id, second.id, 5).ok).toBe(false);
    expect(pauseGame(game).ok).toBe(true);
    expect(researchStation(game, first.id, game.stations[0].id).ok).toBe(true);
  });

  it("can disable research for the whole game", () => {
    const game = createGame("LAKE9", "Delayed research", { initialResearchEnabled: false }, [
      { name: "Shore", startingPopulation: 100, carryingCapacity: 200 },
    ]);
    const player = addPlayer(game, "Sol");

    expect(researchStation(game, player.id, game.stations[0].id)).toEqual({
      ok: false,
      error: "Research is disabled for this game.",
    });
    expect(startGame(game).ok).toBe(true);
    expect(pauseGame(game).ok).toBe(true);
    expect(researchStation(game, player.id, game.stations[0].id)).toEqual({
      ok: false,
      error: "Research is disabled for this game.",
    });
  });

  it("charges the configured research cost exactly once per station", () => {
    const game = createGame("LAKECOST", "Costly research", {
      startingBalance: 12,
      researchCost: 5,
    }, [{ name: "Shore", startingPopulation: 100, carryingCapacity: 200 }]);
    const player = addPlayer(game, "Nia");

    expect(researchStation(game, player.id, game.stations[0].id)).toEqual({
      ok: true,
      data: { population: 100 },
    });
    expect(player.balance).toBe(7);
    expect(researchStation(game, player.id, game.stations[0].id)).toEqual({
      ok: false,
      error: "You already researched this station this season.",
    });
    expect(player.balance).toBe(7);
  });

  it("blocks research when a fisher cannot pay or exact stocks are already visible", () => {
    const costly = createGame("LAKEPOOR", "Costly research", {
      startingBalance: 4,
      researchCost: 5,
    }, [{ name: "Shore", startingPopulation: 100, carryingCapacity: 200 }]);
    const poorPlayer = addPlayer(costly, "Ari");
    expect(researchStation(costly, poorPlayer.id, costly.stations[0].id)).toEqual({
      ok: false,
      error: "You need 5 fish to research this station.",
    });
    expect(poorPlayer.balance).toBe(4);

    costly.settings.researchCost = 0;
    poorPlayer.balance = -3;
    expect(researchStation(costly, poorPlayer.id, costly.stations[0].id).ok).toBe(true);
    expect(poorPlayer.balance).toBe(-3);

    const exact = createGame("LAKEOPEN", "Visible stocks", {
      feedbackMode: "exact",
      showPopulationToPlayers: true,
    }, [{ name: "Shore", startingPopulation: 100, carryingCapacity: 200 }]);
    const exactPlayer = addPlayer(exact, "Bo");
    expect(researchStation(exact, exactPlayer.id, exact.stations[0].id)).toEqual({
      ok: false,
      error: "Current fish stocks are already visible.",
    });
  });

  it("waits for a scaled group before revealing its final starting stock", () => {
    const game = createGame("LAKESCALE", "Scaled research", {
      expectedPlayerCount: 2,
      scaleResourcesToPlayers: true,
      capacityPerPlayer: 50,
      startingStockRatio: 0.5,
    }, [{ name: "Shore", startingPopulation: 100, carryingCapacity: 200 }]);
    const first = addPlayer(game, "Mira");

    expect(researchStation(game, first.id, game.stations[0].id)).toEqual({
      ok: false,
      error: "Research opens when all fishers have joined.",
    });
    addPlayer(game, "Sol");
    expect(researchStation(game, first.id, game.stations[0].id)).toEqual({
      ok: true,
      data: { population: 50 },
    });
  });

  it("advances and starts the next season with one action", () => {
    const game = createGame("LAKE8", "One-button seasons", {}, [
      { name: "Shore", startingPopulation: 100, carryingCapacity: 200 },
    ]);
    addPlayer(game, "Mira");

    expect(startOrAdvanceSeason(game).ok).toBe(true);
    expect(game.status).toBe("running");
    pauseGame(game);
    expect(startOrAdvanceSeason(game).ok).toBe(true);
    expect(game.status).toBe("running");
    expect(game.season).toBe(2);
    expect(game.stations[0].population).toBe(200);
  });

  it("starts the next season when every fisher is ready", () => {
    const game = createGame("READY1", "Ready together", {}, [
      { name: "Shore", startingPopulation: 100, carryingCapacity: 200 },
    ]);
    const first = addPlayer(game, "Mira");
    const second = addPlayer(game, "Sol");

    startGame(game);
    pauseGame(game);
    expect(setPlayerReady(game, first.id, true)).toEqual({ ok: true, data: { started: false } });
    expect(game.status).toBe("paused");
    expect(setPlayerReady(game, second.id, true)).toEqual({ ok: true, data: { started: true } });
    expect(game.status).toBe("running");
    expect(game.season).toBe(2);
    expect(game.countdownEndsAt).toBeGreaterThan(Date.now());
    expect(fish(game, first.id, game.stations[0].id)).toEqual({
      ok: false,
      error: "Fishing begins when the countdown reaches zero.",
    });
    expect(game.players.every((player) => !player.readyForNextSeason)).toBe(true);
  });

  it("reports setup readiness without starting Season 1", () => {
    const game = createGame("READY0", "Ready at setup", { expectedPlayerCount: 2 }, [
      { name: "Shore", startingPopulation: 100, carryingCapacity: 200 },
    ]);
    const first = addPlayer(game, "Mira");

    expect(setPlayerReady(game, first.id, true)).toEqual({ ok: true, data: { started: false } });
    expect(game.status).toBe("setup");
    const second = addPlayer(game, "Sol");
    expect(setPlayerReady(game, second.id, true)).toEqual({ ok: true, data: { started: false } });
    expect(game.status).toBe("setup");
    expect(game.season).toBe(1);
  });

  it("ends a depleted one-village game and charges all future food", () => {
    const game = createGame("EMPTY1", "Collapse", {
      maxSeasons: 5,
      maintenanceCost: 20,
      startingBalance: 20,
    }, [{ name: "Shore", startingPopulation: 5, carryingCapacity: 100 }]);
    const player = addPlayer(game, "Mira");

    startGame(game);
    expect(fish(game, player.id, game.stations[0].id).ok).toBe(true);
    expect(game.status).toBe("ended");
    expect(game.villages[0].collapsedAtSeason).toBe(1);
    expect(game.villages[0].futureFoodCostPerPlayer).toBe(80);
    expect(player.balance).toBe(-75);
    expect(player.active).toBe(false);
  });

  it("allows transfers to restore an indebted fisher before the next season", () => {
    const game = createGame("LAKE6", "Test lake", { startingBalance: 0 }, [
      { name: "Shore", startingPopulation: 100, carryingCapacity: 200 },
    ]);
    const struggling = addPlayer(game, "Sol");
    const helper = addPlayer(game, "Kim");
    helper.balance = 100;

    startGame(game);
    pauseGame(game);
    advanceSeason(game);
    expect(struggling.balance).toBe(-40);
    expect(struggling.active).toBe(true);

    expect(tradeFish(game, helper.id, struggling.id, 25).ok).toBe(true);
    expect(struggling.balance).toBe(-15);
    expect(struggling.active).toBe(true);
    expect(startGame(game).ok).toBe(true);
    expect(fish(game, struggling.id, game.stations[0].id).ok).toBe(true);
  });

  it("keeps indebted fishers active so they can recover during the season", () => {
    const game = createGame("DEBT1", "Recovery", { startingBalance: 5, maintenanceCost: 20 }, [
      { name: "Shore", startingPopulation: 100, carryingCapacity: 200 },
    ]);
    const player = addPlayer(game, "Mira");

    expect(startGame(game).ok).toBe(true);
    expect(player.balance).toBe(-15);
    expect(player.active).toBe(true);
    expect(fish(game, player.id, game.stations[0].id).ok).toBe(true);
  });

  it("blocks fishing during the facilitator countdown", () => {
    const game = createGame("COUNT1", "Countdown", {}, [
      { name: "Shore", startingPopulation: 100, carryingCapacity: 200 },
    ]);
    const player = addPlayer(game, "Mira");

    expect(startGame(game, 3000).ok).toBe(true);
    expect(fish(game, player.id, game.stations[0].id)).toEqual({
      ok: false,
      error: "Fishing begins when the countdown reaches zero.",
    });
    game.countdownEndsAt = Date.now() - 1;
    expect(fish(game, player.id, game.stations[0].id).ok).toBe(true);
  });

  it("records group results and prepares the next configured round", () => {
    const firstSettings = { ...defaultSettings, maxSeasons: 1, workshopName: "Test" };
    const secondSettings = { ...defaultSettings, maxSeasons: 3, reproductionRate: 1.667, workshopName: "Test" };
    const stations = [{ name: "Shore", startingPopulation: 100, carryingCapacity: 200 }];
    const game = createGame("ROUNDS", "Group 1", firstSettings, stations, [
      { id: "practice", name: "Practice", scored: false, settings: firstSettings, stations },
      { id: "hard", name: "Hard round", scored: true, settings: secondSettings, stations },
    ]);
    const player = addPlayer(game, "Mira");

    startGame(game);
    fish(game, player.id, game.stations[0].id);
    pauseGame(game);
    expect(game.roundResults[0]).toEqual(expect.objectContaining({
      roundName: "Practice",
      scored: false,
      totalExtracted: 5,
      sustainedPlayers: 1,
    }));
    expect(game.roundResults[0]).not.toHaveProperty("fishRemaining");
    expect(game.roundResults[0]).not.toHaveProperty("groupScore");
    const playerId = player.id;
    expect(prepareNextRound(game).ok).toBe(true);
    expect(game.roundIndex).toBe(1);
    expect(game.status).toBe("setup");
    expect(game.settings.maxSeasons).toBe(3);
    expect(game.settings.reproductionRate).toBe(1.667);
    expect(game.players[0].id).toBe(playerId);
    expect(game.players[0].totalCaught).toBe(0);
  });

  it("allows boat upgrades but prevents repeat purchases and downgrades", () => {
    const game = createGame("LAKE7", "Test lake", { startingBalance: 200 }, [
      { name: "Shore", startingPopulation: 100, carryingCapacity: 200 },
    ]);
    const player = addPlayer(game, "Lee");

    expect(purchaseBoat(game, player.id, "skiff").ok).toBe(true);
    expect(purchaseBoat(game, player.id, "skiff").ok).toBe(false);
    expect(purchaseBoat(game, player.id, "rowboat").ok).toBe(false);
    expect(player.balance).toBe(165);
  });

  it("keeps two village fisheries and transfers separate", () => {
    const game = createGame("TWIN1", "Twin waters", { villageCount: 2 }, [
      { name: "Pond", startingPopulation: 100, carryingCapacity: 200 },
    ]);
    const first = addPlayer(game, "Ada", game.villages[0].id);
    const second = addPlayer(game, "Ben", game.villages[1].id);
    const firstPond = game.stations.find((station) => station.villageId === first.villageId)!;
    const secondPond = game.stations.find((station) => station.villageId === second.villageId)!;

    expect(startGame(game).ok).toBe(true);
    expect(fish(game, first.id, secondPond.id).ok).toBe(false);
    expect(fish(game, first.id, firstPond.id).ok).toBe(true);
    expect(firstPond.population).toBe(95);
    expect(secondPond.population).toBe(100);
    pauseGame(game);
    expect(tradeFish(game, first.id, second.id, 5).ok).toBe(false);
  });

  it("scales each village's total capacity to its own player count", () => {
    const game = createGame("TWIN2", "Scaled waters", {
      villageCount: 2,
      scaleResourcesToPlayers: true,
      capacityPerPlayer: 100,
      startingStockRatio: 0.5,
    }, [{ name: "Pond", startingPopulation: 100, carryingCapacity: 200 }]);
    addPlayer(game, "A1", game.villages[0].id);
    addPlayer(game, "A2", game.villages[0].id);
    addPlayer(game, "B1", game.villages[1].id);

    expect(startGame(game).ok).toBe(true);
    const first = game.stations.find((station) => station.villageId === game.villages[0].id)!;
    const second = game.stations.find((station) => station.villageId === game.villages[1].id)!;
    expect([first.carryingCapacity, first.population]).toEqual([200, 100]);
    expect([second.carryingCapacity, second.population]).toEqual([100, 50]);
  });

  it("records the season when a village fishery collapses", () => {
    const game = createGame("TWIN3", "Collapse", { villageCount: 2 }, [
      { name: "Pond", startingPopulation: 5, carryingCapacity: 5 },
    ]);
    const first = addPlayer(game, "A", game.villages[0].id);
    addPlayer(game, "B", game.villages[1].id);
    const pond = game.stations.find((station) => station.villageId === first.villageId)!;

    startGame(game);
    expect(fish(game, first.id, pond.id).ok).toBe(true);
    expect(game.villages[0].collapsedAtSeason).toBe(1);
    expect(game.events[0].message).toContain("collapsed");
  });

  it("does not start a two-village game with an empty village", () => {
    const game = createGame("TWIN4", "Empty village", { villageCount: 2 }, [
      { name: "Pond", startingPopulation: 100, carryingCapacity: 100 },
    ]);
    addPlayer(game, "Only", game.villages[0].id);
    expect(startGame(game)).toEqual({ ok: false, error: "Village B needs at least one fisher." });
  });
});
