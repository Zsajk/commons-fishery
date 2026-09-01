import { describe, expect, it } from "vitest";
import { createGame } from "../shared/engine.js";
import { fisheryResultLabel } from "../src/resultLabel.js";

describe("fishery result labels", () => {
  it("distinguishes completed, collapsed, and facilitator-ended rounds", () => {
    const game = createGame("LABEL", "Label test", { maxSeasons: 5 }, [
      { name: "Bay", startingPopulation: 20, carryingCapacity: 40 },
    ]);
    expect(fisheryResultLabel(game, null)).toBe("Round ended before Season 1");
    game.seasonHasRun = true;
    game.season = 3;
    expect(fisheryResultLabel(game, null)).toBe("Round ended in Season 3");
    game.season = 5;
    expect(fisheryResultLabel(game, null)).toBe("Fishery survived 5 seasons");
    expect(fisheryResultLabel(game, 2)).toBe("Fishery collapsed in Season 2");
  });
});
