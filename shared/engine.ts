import { randomUUID } from "node:crypto";
import {
  boats,
  defaultSettings,
  type ActionResult,
  type GameEvent,
  type GameSettings,
  type GameState,
  type Player,
  type RoundResult,
  type StationSeed,
  type Village,
  type WorkshopRound,
} from "./game.js";

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
}

export function calculateNextPopulation(
  population: number,
  capacity: number,
  settings: Pick<GameSettings, "growthModel" | "reproductionRate">,
): number {
  if (population <= 0 || capacity <= 0) return 0;

  if (settings.growthModel === "none") return Math.round(population);

  if (settings.growthModel === "multiplier") {
    return Math.round(clamp(population * settings.reproductionRate, 0, capacity));
  }

  const growth =
    settings.reproductionRate * population * (1 - population / capacity);
  return Math.round(clamp(population + growth, 0, capacity));
}

function event(
  type: GameEvent["type"],
  message: string,
  details: Partial<
    Pick<GameEvent, "stationId" | "playerId" | "recipientId" | "villageId">
  > = {},
): GameEvent {
  return { id: randomUUID(), at: Date.now(), type, message, ...details };
}

function pushEvent(game: GameState, nextEvent: GameEvent): void {
  game.events.unshift(nextEvent);
  game.events = game.events.slice(0, 80);
}

export function createGame(
  code: string,
  title: string,
  settings: Partial<GameSettings>,
  stationSeeds: StationSeed[],
  rounds: WorkshopRound[] = [],
): GameState {
  const completeSettings = { ...defaultSettings, ...settings };
  const now = Date.now();
  const villageCount = completeSettings.villageCount === 2 ? 2 : 1;
  completeSettings.villageCount = villageCount;
  const villages: Village[] = Array.from({ length: villageCount }, (_, index) => ({
    id: `village-${index + 1}`,
    name: villageCount === 1 ? "The Village" : `Village ${String.fromCharCode(65 + index)}`,
    collapsedAtSeason: null,
    futureFoodCostPerPlayer: 0,
  }));

  return {
    code: normalizeCode(code),
    title: title.trim() || "Commons Fishery",
    status: "setup",
    season: 1,
    createdAt: now,
    seasonStartedAt: null,
    countdownEndsAt: null,
    seasonHasRun: false,
    settings: completeSettings,
    villages,
    stations: villages.flatMap((village) =>
      stationSeeds.map((seed) => ({
        id: randomUUID(),
        villageId: village.id,
        name: seed.name.trim(),
        startingPopulation: Math.max(1, Math.round(seed.startingPopulation)),
        carryingCapacity: Math.max(
          Math.round(seed.startingPopulation),
          Math.round(seed.carryingCapacity),
        ),
        population: Math.max(1, Math.round(seed.startingPopulation)),
        totalCaught: 0,
        seasonCaught: 0,
        history: [Math.max(1, Math.round(seed.startingPopulation))],
        lastGrowth: 0,
      })),
    ),
    players: [],
    events: [event("status", "Game created")],
    boats,
    rounds: structuredClone(rounds),
    roundIndex: 0,
    roundResults: [],
  };
}

export function migrateGameState(game: GameState): GameState {
  const legacySettings = game.settings as GameSettings & {
    autoPause?: boolean;
    researchFuelCost?: number;
    remoteFishingEnabled?: boolean;
  };
  const {
    autoPause: _autoPause,
    researchFuelCost: _researchFuelCost,
    remoteFishingEnabled: _remoteFishingEnabled,
    ...currentSettings
  } = legacySettings;
  game.settings = { ...defaultSettings, ...currentSettings };
  if (!game.settings.feedbackMode) {
    game.settings.feedbackMode = game.settings.showPopulationToPlayers ? "exact" : "hidden";
  }
  game.settings.showPopulationToPlayers = game.settings.feedbackMode === "exact";
  game.countdownEndsAt ??= null;
  game.rounds = Array.isArray(game.rounds)
    ? game.rounds.map((round) => ({
      ...round,
      settings: { ...defaultSettings, ...round.settings },
    }))
    : [];
  game.roundIndex = Number.isFinite(game.roundIndex) ? game.roundIndex : 0;
  game.roundResults = Array.isArray(game.roundResults) ? game.roundResults : [];
  if (!Array.isArray(game.villages) || game.villages.length === 0) {
    game.villages = [{
      id: "village-1",
      name: "The Village",
      collapsedAtSeason: null,
      futureFoodCostPerPlayer: 0,
    }];
  }
  game.villages = game.villages.map((village, index) => ({
    id: village.id || `village-${index + 1}`,
    name: village.name || (game.villages.length === 1 ? "The Village" : `Village ${String.fromCharCode(65 + index)}`),
    collapsedAtSeason: village.collapsedAtSeason ?? null,
    futureFoodCostPerPlayer: village.futureFoodCostPerPlayer ?? 0,
  }));
  game.settings.villageCount = game.villages.length === 2 ? 2 : 1;
  if (typeof game.seasonHasRun !== "boolean") {
    const latestStatus = game.events.find((item) => item.type === "status")?.message ?? "";
    game.seasonHasRun = game.status === "running" || (game.status === "paused" && !latestStatus.includes("is ready"));
  }
  const fallbackVillageId = game.villages[0].id;
  for (const station of game.stations) station.villageId ||= fallbackVillageId;
  for (const player of game.players) {
    player.villageId ||= fallbackVillageId;
    player.fuel = Number.isFinite(player.fuel) ? player.fuel : game.settings.seasonFuel;
    player.boatSpending = Number.isFinite(player.boatSpending) ? player.boatSpending : 0;
    player.readyForNextSeason = player.readyForNextSeason === true;
  }
  game.boats = boats;
  return game;
}

function scaleResourcesToPlayers(game: GameState): void {
  if (!game.settings.scaleResourcesToPlayers) return;

  for (const village of game.villages) {
    const stations = game.stations.filter((station) => station.villageId === village.id);
    if (stations.length === 0) continue;
    const playerCount = game.players.filter((player) => player.villageId === village.id).length;
    const totalCapacity = Math.max(1, playerCount) * game.settings.capacityPerPlayer;
    const totalWeight = stations.reduce((sum, station) => sum + station.carryingCapacity, 0);
    let allocated = 0;

    stations.forEach((station, index) => {
      const capacity = index === stations.length - 1
        ? Math.max(1, totalCapacity - allocated)
        : Math.max(1, Math.round(totalCapacity * (station.carryingCapacity / totalWeight)));
      allocated += capacity;
      const startingPopulation = Math.max(
        1,
        Math.min(capacity, Math.round(capacity * game.settings.startingStockRatio)),
      );
      station.carryingCapacity = capacity;
      station.startingPopulation = startingPopulation;
      station.population = startingPopulation;
      station.totalCaught = 0;
      station.seasonCaught = 0;
      station.history = [startingPopulation];
      station.lastGrowth = 0;
    });
  }
}

function updateVillageCollapse(game: GameState, villageId: string): void {
  const village = game.villages.find((item) => item.id === villageId);
  if (!village || village.collapsedAtSeason !== null) return;
  const remaining = game.stations
    .filter((station) => station.villageId === villageId)
    .reduce((sum, station) => sum + station.population, 0);
  if (remaining > 0) return;
  village.collapsedAtSeason = game.season;
  const remainingSeasons = Math.max(0, game.settings.maxSeasons - game.season);
  village.futureFoodCostPerPlayer = remainingSeasons * game.settings.maintenanceCost;
  for (const player of game.players.filter((item) => item.villageId === villageId)) {
    player.balance -= village.futureFoodCostPerPlayer;
    player.active = false;
    player.readyForNextSeason = true;
  }
  pushEvent(
    game,
    event("status", `${village.name}'s fishery collapsed; ${village.futureFoodCostPerPlayer} future food to survive was charged per fisher`, {
      villageId,
    }),
  );
  const everyVillageCollapsed = game.villages.every((item) => item.collapsedAtSeason !== null);
  if (game.villages.length === 1 || everyVillageCollapsed) {
    game.status = "ended";
    game.seasonStartedAt = null;
    game.countdownEndsAt = null;
    pushEvent(game, event("status", "The game ended because no fish remain"));
    captureRoundResult(game);
  }
}

function captureRoundResult(game: GameState): void {
  const round = game.rounds[game.roundIndex];
  const roundId = round?.id ?? `game-${game.roundIndex + 1}`;
  if (game.roundResults.some((result) => result.roundId === roundId)) return;
  const players = game.players.map((player) => ({
    playerId: player.id,
    name: player.name,
    totalCaught: player.totalCaught,
    purchases: player.boatSpending,
    finalBalance: player.balance,
    sustained: player.balance >= 0,
  }));
  const result: RoundResult = {
    roundId,
    roundName: round?.name ?? game.title,
    scored: round?.scored ?? true,
    completedAt: Date.now(),
    collapsedAtSeason: game.villages
      .map((village) => village.collapsedAtSeason)
      .filter((season): season is number => season !== null)
      .sort((left, right) => left - right)[0] ?? null,
    totalExtracted: game.stations.reduce((sum, station) => sum + station.totalCaught, 0),
    sustainedPlayers: players.filter((player) => player.sustained).length,
    players,
  };
  game.roundResults.push(result);
}

export function addPlayer(game: GameState, name: string, requestedVillageId?: string): Player {
  const cleanName = name.trim().slice(0, 24) || "Fisher";
  const duplicate = game.players.find(
    (player) => player.name.toLowerCase() === cleanName.toLowerCase(),
  );
  const playerName = duplicate ? `${cleanName} ${game.players.length + 1}` : cleanName;
  const requestedVillage = game.villages.find((village) => village.id === requestedVillageId);
  const village = requestedVillage ?? [...game.villages].sort((left, right) => {
    const leftCount = game.players.filter((player) => player.villageId === left.id).length;
    const rightCount = game.players.filter((player) => player.villageId === right.id).length;
    return leftCount - rightCount;
  })[0];
  const player: Player = {
    id: randomUUID(),
    name: playerName,
    villageId: village.id,
    balance: game.settings.startingBalance,
    totalCaught: 0,
    seasonCaught: 0,
    boatSpending: 0,
    fuel: game.settings.seasonFuel,
    boatId: boats[0].id,
    active: true,
    readyForNextSeason: false,
    joinedAt: Date.now(),
    knownStations: {},
  };
  game.players.push(player);
  pushEvent(
    game,
    event("join", `${player.name} joined ${village.name}`, {
      playerId: player.id,
      villageId: village.id,
    }),
  );
  return player;
}

export function startGame(game: GameState, countdownMs = 0): ActionResult {
  if (game.status === "running") return { ok: false, error: "The season is already running." };
  if (game.status === "ended") return { ok: false, error: "Reset the game before restarting." };
  if (game.status === "setup") {
    const emptyVillage = game.villages.find(
      (village) => !game.players.some((player) => player.villageId === village.id),
    );
    if (emptyVillage) return { ok: false, error: `${emptyVillage.name} needs at least one fisher.` };
    scaleResourcesToPlayers(game);
    for (const player of game.players) {
      player.balance -= game.settings.maintenanceCost;
      player.knownStations = {};
    }
  }
  for (const player of game.players) {
    const village = game.villages.find((item) => item.id === player.villageId);
    player.active = village?.collapsedAtSeason === null;
    player.readyForNextSeason = false;
    if (game.settings.seasonLimitMode === "fuel" && !Number.isFinite(player.fuel)) {
      player.fuel = game.settings.seasonFuel;
    }
  }
  game.status = "running";
  game.seasonHasRun = true;
  game.seasonStartedAt = Date.now() + Math.max(0, countdownMs);
  game.countdownEndsAt = countdownMs > 0 ? game.seasonStartedAt : null;
  pushEvent(game, event("status", countdownMs > 0
    ? `Season ${game.season} starts in ${Math.ceil(countdownMs / 1000)} seconds`
    : `Season ${game.season} started`));
  return { ok: true };
}

export function pauseGame(game: GameState): ActionResult {
  if (game.status !== "running") return { ok: false, error: "The game is not running." };
  game.status = game.season >= game.settings.maxSeasons ? "ended" : "paused";
  game.seasonStartedAt = null;
  game.countdownEndsAt = null;
  for (const player of game.players) player.readyForNextSeason = false;
  pushEvent(game, event(
    "status",
    game.status === "ended" ? "The final season ended" : `Season ${game.season} ended`,
  ));
  if (game.status === "ended") captureRoundResult(game);
  return { ok: true };
}

export function endGame(game: GameState): ActionResult {
  if (game.status === "ended") return { ok: false, error: "The game has already ended." };
  game.status = "ended";
  game.seasonStartedAt = null;
  game.countdownEndsAt = null;
  pushEvent(game, event("status", "Game ended by facilitator"));
  captureRoundResult(game);
  return { ok: true };
}

export function startOrAdvanceSeason(game: GameState, countdownMs = 0): ActionResult {
  if (game.status !== "paused" || !game.seasonHasRun) return startGame(game, countdownMs);
  const advanced = advanceSeason(game);
  if (!advanced.ok || (game as GameState).status === "ended") return advanced;
  return startGame(game, countdownMs);
}

export function setPlayerReady(
  game: GameState,
  playerId: string,
  ready: boolean,
): ActionResult<{ started: boolean }> {
  const preparingFirstSeason = game.status === "setup";
  const preparingLaterSeason = game.status === "paused" && game.seasonHasRun;
  if (!preparingFirstSeason && !preparingLaterSeason) {
    return { ok: false, error: "Ready is available while preparing a season." };
  }
  const player = game.players.find((item) => item.id === playerId);
  if (!player) return { ok: false, error: "Player not found." };
  const village = game.villages.find((item) => item.id === player.villageId);
  if (village?.collapsedAtSeason !== null) {
    return { ok: false, error: "Your village's fishery has collapsed." };
  }

  player.readyForNextSeason = ready;
  const targetSeason = preparingFirstSeason ? 1 : game.season + 1;
  pushEvent(game, event("status", `${player.name} is ${ready ? "ready" : "not ready"} for Season ${targetSeason}`, {
    playerId: player.id,
    villageId: player.villageId,
  }));

  const eligiblePlayers = game.players.filter((item) =>
    game.villages.find((candidate) => candidate.id === item.villageId)?.collapsedAtSeason === null);
  const enoughPlayers = !preparingFirstSeason
    || game.players.length >= game.settings.expectedPlayerCount;
  const everyoneReady = enoughPlayers
    && eligiblePlayers.length > 0
    && eligiblePlayers.every((item) => item.readyForNextSeason);
  if (preparingFirstSeason || !everyoneReady) {
    return { ok: true, data: { started: false } };
  }

  const started = startOrAdvanceSeason(game, 3000);
  if (!started.ok) return { ok: false, error: started.error };
  return { ok: true, data: { started: true } };
}

export function advanceSeason(game: GameState): ActionResult {
  if (game.status !== "paused") {
    return {
      ok: false,
      error:
        game.status === "setup"
          ? "Complete the first season before advancing."
          : game.status === "running"
            ? "End the current season before advancing."
            : "The game has ended.",
    };
  }
  if (!game.seasonHasRun) {
    return { ok: false, error: "Start this season before advancing to the next one." };
  }
  if (game.season >= game.settings.maxSeasons) {
    game.status = "ended";
    game.seasonStartedAt = null;
    game.countdownEndsAt = null;
    pushEvent(game, event("status", "The final season ended"));
    captureRoundResult(game);
    return { ok: true };
  }

  game.season += 1;
  for (const station of game.stations) {
    const village = game.villages.find((item) => item.id === station.villageId);
    const before = station.population;
    const after = village?.collapsedAtSeason !== null ? 0 : calculateNextPopulation(
      station.population,
      station.carryingCapacity,
      game.settings,
    );
    station.population = after;
    station.lastGrowth = after - before;
    station.seasonCaught = 0;
    station.history.push(after);
    pushEvent(
      game,
      event("growth", `${station.name} replenished ${before} to ${after}`, {
        stationId: station.id,
        villageId: station.villageId,
      }),
    );
  }

  for (const player of game.players) {
    const village = game.villages.find((item) => item.id === player.villageId);
    const collapsed = village?.collapsedAtSeason !== null;
    if (!collapsed) player.balance -= game.settings.maintenanceCost;
    player.seasonCaught = 0;
    player.fuel = game.settings.seasonFuel;
    player.active = !collapsed;
    player.knownStations = {};
    player.readyForNextSeason = false;
  }

  game.status = "paused";
  game.seasonStartedAt = null;
  game.countdownEndsAt = null;
  game.seasonHasRun = false;
  pushEvent(game, event("status", `Season ${game.season} is ready`));
  return { ok: true };
}

export function fish(
  game: GameState,
  playerId: string,
  stationId: string,
  random = Math.random,
): ActionResult<{ caught: number }> {
  if (game.status !== "running") return { ok: false, error: "Fishing is only available while the season is running." };
  if (game.countdownEndsAt !== null && Date.now() < game.countdownEndsAt) {
    return { ok: false, error: "Fishing begins when the countdown reaches zero." };
  }
  const player = game.players.find((item) => item.id === playerId);
  const station = game.stations.find((item) => item.id === stationId);
  if (!player || !station) return { ok: false, error: "Player or station not found." };
  if (player.villageId !== station.villageId) {
    return { ok: false, error: "You can only fish in your village's waters." };
  }
  if (!player.active) return { ok: false, error: "Your village can no longer fish." };
  if (
    game.settings.seasonLimitMode === "time"
    && game.seasonStartedAt !== null
    && Date.now() >= game.seasonStartedAt + game.settings.seasonDurationSeconds * 1000
  ) return { ok: false, error: "The season timer has ended." };

  const boat = game.boats.find((item) => item.id === player.boatId) ?? game.boats[0];
  if (game.settings.seasonLimitMode === "fuel" && player.fuel < boat.fuelCost) {
    return { ok: false, error: "Not enough fuel remains for another trip." };
  }
  if (station.population <= 0) return { ok: false, error: "No fish remain at this station." };

  const variance = game.settings.catchVariance;
  const varianceMultiplier = variance > 0 ? 1 + (random() * 2 - 1) * variance : 1;
  const requestedCatch = Math.max(1, Math.round(boat.catchSize * varianceMultiplier));
  const caught = Math.min(requestedCatch, station.population);

  station.population -= caught;
  station.totalCaught += caught;
  station.seasonCaught += caught;
  player.balance += caught;
  player.totalCaught += caught;
  player.seasonCaught += caught;
  if (game.settings.seasonLimitMode === "fuel") player.fuel -= boat.fuelCost;
  pushEvent(
    game,
    event("catch", `${player.name} caught ${caught} at ${station.name}`, {
      playerId,
      stationId,
      villageId: player.villageId,
    }),
  );
  updateVillageCollapse(game, player.villageId);
  if (
    game.status === "running"
    &&
    game.settings.seasonLimitMode === "fuel"
    && game.players.filter((item) => item.active).every((item) => {
      const itemBoat = game.boats.find((boatOption) => boatOption.id === item.boatId) ?? game.boats[0];
      return item.fuel < itemBoat.fuelCost;
    })
  ) pauseGame(game);
  return { ok: true, data: { caught } };
}

export function purchaseBoat(
  game: GameState,
  playerId: string,
  boatId: string,
): ActionResult {
  if (game.status === "running") return { ok: false, error: "Boats can be changed between seasons." };
  if (game.status === "ended") return { ok: false, error: "The game has ended." };
  const player = game.players.find((item) => item.id === playerId);
  const boat = game.boats.find((item) => item.id === boatId);
  if (!player || !boat) return { ok: false, error: "Player or boat not found." };
  if (game.villages.find((item) => item.id === player.villageId)?.collapsedAtSeason !== null) {
    return { ok: false, error: "Your village's fishery has collapsed." };
  }
  const currentBoatIndex = game.boats.findIndex((item) => item.id === player.boatId);
  const nextBoatIndex = game.boats.findIndex((item) => item.id === boatId);
  if (nextBoatIndex <= currentBoatIndex) {
    return { ok: false, error: "Choose a larger boat to upgrade." };
  }
  if (player.balance < boat.cost) return { ok: false, error: "Not enough fish to buy this boat." };
  player.balance -= boat.cost;
  player.boatSpending += boat.cost;
  player.boatId = boat.id;
  player.readyForNextSeason = false;
  pushEvent(game, event("purchase", `${player.name} bought a ${boat.name}`, {
    playerId,
    villageId: player.villageId,
  }));
  return { ok: true };
}

export function researchStation(
  game: GameState,
  playerId: string,
  stationId: string,
): ActionResult<{ population: number }> {
  if (!game.settings.initialResearchEnabled) {
    return { ok: false, error: "Research is disabled for this game." };
  }
  if (game.status === "running") {
    return { ok: false, error: "Research is available between seasons." };
  }
  if (game.status === "ended") return { ok: false, error: "The game has ended." };
  if (game.settings.feedbackMode === "exact") {
    return { ok: false, error: "Current fish stocks are already visible." };
  }
  const player = game.players.find((item) => item.id === playerId);
  let station = game.stations.find((item) => item.id === stationId);
  if (!player || !station) return { ok: false, error: "Player or station not found." };
  if (game.villages.find((item) => item.id === player.villageId)?.collapsedAtSeason !== null) {
    return { ok: false, error: "Your village's fishery has collapsed." };
  }
  if (player.villageId !== station.villageId) {
    return { ok: false, error: "You can only research your village's waters." };
  }
  if (player.knownStations[stationId]) {
    return { ok: false, error: "You already researched this station this season." };
  }
  if (
    game.status === "setup"
    && game.settings.scaleResourcesToPlayers
    && game.players.length < game.settings.expectedPlayerCount
  ) {
    return { ok: false, error: "Research opens when all fishers have joined." };
  }
  if (game.status === "setup" && game.settings.scaleResourcesToPlayers) {
    scaleResourcesToPlayers(game);
    station = game.stations.find((item) => item.id === stationId);
    if (!station) return { ok: false, error: "Station not found." };
  }
  const researchCost = Math.max(0, Math.round(game.settings.researchCost));
  if (researchCost > 0 && player.balance < researchCost) {
    return { ok: false, error: `You need ${researchCost} fish to research this station.` };
  }
  player.balance -= researchCost;
  player.knownStations[stationId] = { population: station.population, observedAt: Date.now() };
  player.readyForNextSeason = false;
  pushEvent(
    game,
    event("research", `${player.name} researched ${station.name}${researchCost > 0 ? ` for ${researchCost} fish` : " for free"}`, {
      playerId,
      stationId,
      villageId: player.villageId,
    }),
  );
  return { ok: true, data: { population: station.population } };
}

export function tradeFish(
  game: GameState,
  fromPlayerId: string,
  toPlayerId: string,
  amount: number,
): ActionResult {
  if (!game.settings.tradingEnabled) return { ok: false, error: "Trading is disabled." };
  if (game.status === "running") return { ok: false, error: "Trading is available between seasons." };
  if (game.status === "ended") return { ok: false, error: "The game has ended." };
  const from = game.players.find((item) => item.id === fromPlayerId);
  const to = game.players.find((item) => item.id === toPlayerId);
  const wholeAmount = Math.floor(amount);
  if (!from || !to || from.id === to.id) return { ok: false, error: "Choose another player." };
  if (game.villages.find((item) => item.id === from.villageId)?.collapsedAtSeason !== null) {
    return { ok: false, error: "Your village's fishery has collapsed." };
  }
  if (from.villageId !== to.villageId) {
    return { ok: false, error: "Fish can only be shared within your village." };
  }
  if (!Number.isFinite(wholeAmount) || wholeAmount <= 0 || wholeAmount > from.balance) {
    return { ok: false, error: "Enter an amount you can afford." };
  }
  from.balance -= wholeAmount;
  to.balance += wholeAmount;
  from.readyForNextSeason = false;
  to.readyForNextSeason = false;
  pushEvent(
    game,
    event("trade", `${from.name} gave ${wholeAmount} fish to ${to.name}`, {
      playerId: from.id,
      recipientId: to.id,
      villageId: from.villageId,
    }),
  );
  return { ok: true };
}

export function resetGame(game: GameState): void {
  const currentRoundId = game.rounds[game.roundIndex]?.id ?? `game-${game.roundIndex + 1}`;
  game.roundResults = game.roundResults.filter((result) => result.roundId !== currentRoundId);
  game.status = "setup";
  game.season = 1;
  game.seasonStartedAt = null;
  game.countdownEndsAt = null;
  game.seasonHasRun = false;
  game.villages.forEach((village) => {
    village.collapsedAtSeason = null;
    village.futureFoodCostPerPlayer = 0;
  });
  game.stations.forEach((station) => {
    station.population = station.startingPopulation;
    station.totalCaught = 0;
    station.seasonCaught = 0;
    station.lastGrowth = 0;
    station.history = [station.startingPopulation];
  });
  game.players.forEach((player) => {
    player.balance = game.settings.startingBalance;
    player.totalCaught = 0;
    player.seasonCaught = 0;
    player.boatSpending = 0;
    player.fuel = game.settings.seasonFuel;
    player.boatId = boats[0].id;
    player.active = true;
    player.readyForNextSeason = false;
    player.knownStations = {};
  });
  game.events = [event("status", "Game reset")];
}

export function prepareNextRound(game: GameState): ActionResult {
  if (game.status !== "ended") {
    return { ok: false, error: "Finish the current round before preparing the next one." };
  }
  const nextRound = game.rounds[game.roundIndex + 1];
  if (!nextRound) return { ok: false, error: "There are no more prepared rounds." };

  captureRoundResult(game);
  const sharedSettings = {
    workshopName: game.settings.workshopName,
    expectedPlayerCount: game.settings.expectedPlayerCount,
    villageCount: game.settings.villageCount,
  };
  game.roundIndex += 1;
  game.settings = { ...defaultSettings, ...nextRound.settings, ...sharedSettings };
  game.settings.showPopulationToPlayers = game.settings.feedbackMode === "exact";
  game.stations = game.villages.flatMap((village) =>
    nextRound.stations.map((seed) => ({
      id: randomUUID(),
      villageId: village.id,
      name: seed.name.trim(),
      startingPopulation: Math.max(1, Math.round(seed.startingPopulation)),
      carryingCapacity: Math.max(
        Math.round(seed.startingPopulation),
        Math.round(seed.carryingCapacity),
      ),
      population: Math.max(1, Math.round(seed.startingPopulation)),
      totalCaught: 0,
      seasonCaught: 0,
      history: [Math.max(1, Math.round(seed.startingPopulation))],
      lastGrowth: 0,
    })),
  );
  resetGame(game);
  game.events = [event("status", `${nextRound.name} is ready`)];
  return { ok: true };
}
