import type { GameSettings, GameState, Player, Station, WorkshopRound } from "../shared/game.js";
import type { ActionAuthorization } from "./game-actions.js";

export function gameViewFor(game: GameState, authorization: ActionAuthorization): GameState {
  if (authorization.facilitator) return structuredClone(game);

  const playerId = authorization.player?.code === game.code
    && game.players.some((player) => player.id === authorization.player?.playerId)
    ? authorization.player.playerId
    : null;

  return playerId ? playerView(game, playerId) : lobbyView(game);
}

function playerView(game: GameState, playerId: string): GameState {
  const view = structuredClone(game);
  view.settings = participantSettings(game);
  view.players = view.players.map((player) => ({
    ...player,
    knownStations: player.id === playerId ? player.knownStations : {},
  }));
  view.events = view.events.filter((item) => item.type === "trade"
    && (item.playerId === playerId || item.recipientId === playerId));
  view.stations = game.stations.map((station) => participantStation(game, station));
  view.rounds = game.rounds.map((round, index) => participantRound(view.settings, round, index, game.roundIndex));
  view.roundResults = [];
  return view;
}

function lobbyView(game: GameState): GameState {
  const view = structuredClone(game);
  view.settings = participantSettings(game);
  view.players = game.players.map((player, index) => lobbyPlayer(player, index));
  view.stations = [];
  view.events = [];
  view.boats = [];
  view.rounds = game.rounds.map((round, index) => participantRound(view.settings, round, index, game.roundIndex));
  view.roundResults = [];
  return view;
}

function participantSettings(game: GameState): GameSettings {
  const settings = structuredClone(game.settings);
  if (!settings.showSeasonCountToPlayers && game.status !== "ended") {
    settings.maxSeasons = Math.max(1, game.season);
  }
  settings.capacityPerPlayer = 0;
  settings.startingStockRatio = 0;
  return settings;
}

function participantStation(game: GameState, station: Station): Station {
  if (game.settings.feedbackMode === "exact") return structuredClone(station);

  const ratio = station.carryingCapacity > 0 ? station.population / station.carryingCapacity : 0;
  const projectedPopulation = game.settings.feedbackMode === "qualitative"
    ? qualitativePopulation(station.population, ratio)
    : station.population === 0 ? 0 : 100;
  const village = game.villages.find((candidate) => candidate.id === station.villageId);
  const villageCollapsed = village?.collapsedAtSeason != null;
  const showExtraction = game.status === "ended" || villageCollapsed;

  return {
    ...structuredClone(station),
    startingPopulation: 100,
    carryingCapacity: 100,
    population: projectedPopulation,
    totalCaught: showExtraction ? station.totalCaught : 0,
    seasonCaught: showExtraction ? station.seasonCaught : 0,
    history: station.history.map((population) => {
      const historicalRatio = station.carryingCapacity > 0 ? population / station.carryingCapacity : 0;
      return game.settings.feedbackMode === "qualitative"
        ? qualitativePopulation(population, historicalRatio)
        : population === 0 ? 0 : 100;
    }),
    lastGrowth: 0,
  };
}

function qualitativePopulation(population: number, ratio: number): number {
  if (population <= 0) return 0;
  if (ratio > 0.65) return 80;
  if (ratio > 0.3) return 50;
  return 15;
}

function participantRound(
  settings: GameSettings,
  round: WorkshopRound,
  index: number,
  currentRoundIndex: number,
): WorkshopRound {
  return {
    id: round.id,
    name: index <= currentRoundIndex ? round.name : `Round ${index + 1}`,
    scored: round.scored,
    settings: structuredClone(settings),
    stations: [],
  };
}

function lobbyPlayer(player: Player, index: number): Player {
  return {
    id: `lobby-player-${index + 1}`,
    name: "Fisher",
    villageId: player.villageId,
    balance: 0,
    totalCaught: 0,
    seasonCaught: 0,
    boatSpending: 0,
    fuel: 0,
    boatId: "",
    active: player.active,
    readyForNextSeason: player.readyForNextSeason,
    joinedAt: 0,
    knownStations: {},
  };
}
