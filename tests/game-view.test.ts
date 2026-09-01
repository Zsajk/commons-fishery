import { describe, expect, it } from "vitest";
import { addPlayer, createGame, researchStation, tradeFish } from "../shared/engine";
import { gameViewFor } from "../server/game-view";

describe("role-specific game views", () => {
  it("returns the complete state to facilitators", () => {
    const game = createGame("VIEW1", "View test", { feedbackMode: "hidden" }, [
      { name: "Bay", startingPopulation: 73, carryingCapacity: 100 },
    ]);
    const player = addPlayer(game, "Ada");
    player.knownStations[game.stations[0].id] = { population: 73, observedAt: 1 };

    const view = gameViewFor(game, { facilitator: true });

    expect(view).toEqual(game);
    expect(view).not.toBe(game);
  });

  it("limits anonymous subscribers to lobby information", () => {
    const game = createGame("VIEW2", "Lobby test", {}, [
      { name: "Bay", startingPopulation: 73, carryingCapacity: 100 },
    ]);
    addPlayer(game, "Ada");

    const view = gameViewFor(game, { facilitator: false });

    expect(view.title).toBe("Lobby test");
    expect(view.players).toHaveLength(1);
    expect(view.players[0].name).toBe("Fisher");
    expect(view.stations).toEqual([]);
    expect(view.events).toEqual([]);
    expect(view.roundResults).toEqual([]);
  });

  it("shows only a player's own research and hides exact stock", () => {
    const game = createGame("VIEW3", "Player test", {
      feedbackMode: "hidden",
      initialResearchEnabled: true,
      researchCost: 0,
      expectedPlayerCount: 2,
      showSeasonCountToPlayers: false,
      maxSeasons: 5,
    }, [{ name: "Bay", startingPopulation: 73, carryingCapacity: 100 }]);
    const ada = addPlayer(game, "Ada");
    const ben = addPlayer(game, "Ben");
    expect(researchStation(game, ada.id, game.stations[0].id).ok).toBe(true);
    ben.knownStations[game.stations[0].id] = { population: 73, observedAt: 1 };

    const view = gameViewFor(game, {
      facilitator: false,
      player: { code: game.code, playerId: ada.id },
    });

    expect(view.stations[0].population).toBe(100);
    expect(view.stations[0].carryingCapacity).toBe(100);
    expect(view.stations[0].totalCaught).toBe(0);
    expect(view.players.find((player) => player.id === ada.id)?.knownStations[game.stations[0].id]?.population).toBe(73);
    expect(view.players.find((player) => player.id === ben.id)?.knownStations).toEqual({});
    expect(view.settings.maxSeasons).toBe(1);
    expect(view.roundResults).toEqual([]);
    expect(view.events).toEqual([]);
  });

  it("reduces qualitative stocks to categories without changing the stored game", () => {
    const game = createGame("VIEW4", "Qualitative test", { feedbackMode: "qualitative" }, [
      { name: "Bay", startingPopulation: 64, carryingCapacity: 100 },
    ]);
    const player = addPlayer(game, "Ada");

    const view = gameViewFor(game, {
      facilitator: false,
      player: { code: game.code, playerId: player.id },
    });

    expect(view.stations[0].population).toBe(50);
    expect(game.stations[0].population).toBe(64);
  });

  it("keeps a player's trade notices without exposing unrelated activity", () => {
    const game = createGame("VIEW5", "Trade test", {}, [
      { name: "Bay", startingPopulation: 100, carryingCapacity: 100 },
    ]);
    const ada = addPlayer(game, "Ada");
    const ben = addPlayer(game, "Ben");
    const cam = addPlayer(game, "Cam");
    expect(tradeFish(game, ben.id, ada.id, 2).ok).toBe(true);
    expect(tradeFish(game, ben.id, cam.id, 2).ok).toBe(true);

    const view = gameViewFor(game, {
      facilitator: false,
      player: { code: game.code, playerId: ada.id },
    });

    expect(view.events).toHaveLength(1);
    expect(view.events[0]).toMatchObject({
      type: "trade",
      playerId: ben.id,
      recipientId: ada.id,
    });
  });
});
