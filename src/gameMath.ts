import type { GameSettings, GameState, Station } from "../shared/game";

export function predictPopulation(
  station: Pick<Station, "population" | "carryingCapacity">,
  settings: Pick<GameSettings, "growthModel" | "reproductionRate">,
) {
  const { population, carryingCapacity } = station;
  if (population <= 0) return 0;
  if (settings.growthModel === "none") return population;
  if (settings.growthModel === "multiplier") {
    return Math.min(carryingCapacity, Math.round(population * settings.reproductionRate));
  }
  const growth =
    settings.reproductionRate * population * (1 - population / carryingCapacity);
  return Math.min(carryingCapacity, Math.max(0, Math.round(population + growth)));
}

export function growthLabel(settings: GameSettings) {
  if (settings.growthModel === "none") return "no replenishment";
  if (settings.growthModel === "multiplier") {
    return `${settings.reproductionRate.toFixed(2).replace(/\.00$/, "")}x each season`;
  }
  return `density-limited growth, r = ${settings.reproductionRate.toFixed(2)}`;
}

export function totalFish(stations: Station[]) {
  return stations.reduce((sum, station) => sum + station.population, 0);
}

export function villageStats(game: GameState, villageId: string) {
  const village = game.villages.find((item) => item.id === villageId);
  const stations = game.stations.filter((station) => station.villageId === villageId);
  const players = game.players.filter((player) => player.villageId === villageId);
  const population = totalFish(stations);
  const capacity = stations.reduce((sum, station) => sum + station.carryingCapacity, 0);
  return {
    village,
    stations,
    players,
    population,
    capacity,
    ratio: capacity ? population / capacity : 0,
    collapsed: village ? village.collapsedAtSeason !== null || population === 0 : population === 0,
  };
}

export function villageCompetitionResult(game: GameState, villageId: string) {
  if (game.villages.length < 2) return "single" as const;
  const village = game.villages.find((item) => item.id === villageId);
  const opponent = game.villages.find((item) => item.id !== villageId);
  if (!village || !opponent) return "single" as const;
  const ownSurvival = village.collapsedAtSeason ?? game.settings.maxSeasons + 1;
  const opponentSurvival = opponent.collapsedAtSeason ?? game.settings.maxSeasons + 1;
  if (ownSurvival > opponentSurvival) return "ahead" as const;
  if (ownSurvival < opponentSurvival) return "behind" as const;
  return "tied" as const;
}
