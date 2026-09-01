export type GameStatus = "setup" | "running" | "paused" | "ended";
export type GrowthModel = "none" | "multiplier" | "logistic";
export type VillageCount = 1 | 2;
export type StationSelectionMode = "buttons" | "qr";
export type SeasonLimitMode = "time" | "fuel";
export type FeedbackMode = "hidden" | "qualitative" | "exact";

export interface Village {
  id: string;
  name: string;
  collapsedAtSeason: number | null;
  futureFoodCostPerPlayer: number;
}

export interface BoatDefinition {
  id: string;
  name: string;
  description: string;
  cost: number;
  catchSize: number;
  fuelCost: number;
}

export interface GameSettings {
  villageCount: VillageCount;
  startingBalance: number;
  maintenanceCost: number;
  seasonLimitMode: SeasonLimitMode;
  seasonDurationSeconds: number;
  seasonFuel: number;
  maxSeasons: number;
  growthModel: GrowthModel;
  reproductionRate: number;
  catchVariance: number;
  tradingEnabled: boolean;
  showPopulationToPlayers: boolean;
  feedbackMode: FeedbackMode;
  initialResearchEnabled: boolean;
  researchCost: number;
  showSeasonCountToPlayers: boolean;
  collapsedGroupsCanWin: boolean;
  stationSelectionMode: StationSelectionMode;
  scaleResourcesToPlayers: boolean;
  capacityPerPlayer: number;
  startingStockRatio: number;
  expectedPlayerCount: number;
  workshopName: string;
}

export interface StationSeed {
  name: string;
  startingPopulation: number;
  carryingCapacity: number;
}

export interface Station extends StationSeed {
  id: string;
  villageId: string;
  population: number;
  totalCaught: number;
  seasonCaught: number;
  history: number[];
  lastGrowth: number;
}

export interface Player {
  id: string;
  name: string;
  villageId: string;
  balance: number;
  totalCaught: number;
  seasonCaught: number;
  boatSpending: number;
  fuel: number;
  boatId: string;
  active: boolean;
  readyForNextSeason: boolean;
  joinedAt: number;
  knownStations: Record<string, { population: number; observedAt: number }>;
}

export interface GameEvent {
  id: string;
  at: number;
  type: "join" | "catch" | "growth" | "trade" | "purchase" | "status" | "research";
  message: string;
  stationId?: string;
  playerId?: string;
  recipientId?: string;
  villageId?: string;
}

export interface GameState {
  code: string;
  title: string;
  status: GameStatus;
  season: number;
  createdAt: number;
  seasonStartedAt: number | null;
  countdownEndsAt: number | null;
  seasonHasRun: boolean;
  settings: GameSettings;
  villages: Village[];
  stations: Station[];
  players: Player[];
  events: GameEvent[];
  boats: BoatDefinition[];
  rounds: WorkshopRound[];
  roundIndex: number;
  roundResults: RoundResult[];
}

export interface WorkshopRound {
  id: string;
  name: string;
  scored: boolean;
  settings: GameSettings;
  stations: StationSeed[];
}

export interface PlayerRoundResult {
  playerId: string;
  name: string;
  totalCaught: number;
  purchases: number;
  finalBalance: number;
  sustained: boolean;
}

export interface RoundResult {
  roundId: string;
  roundName: string;
  scored: boolean;
  completedAt: number;
  collapsedAtSeason: number | null;
  totalExtracted: number;
  sustainedPlayers: number;
  players: PlayerRoundResult[];
}

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

export interface BrowserSession {
  facilitator: boolean;
  player?: {
    code: string;
    playerId: string;
  };
}

export interface PlayerJoinResult {
  game: GameState;
  playerId: string;
}

export interface HostGameSummary {
  code: string;
  title: string;
  status: GameStatus;
  season: number;
  maxSeasons: number;
  playerCount: number;
  fishRemaining: number;
  createdAt: number;
  lastActivityAt: number;
  seasonStartedAt: number | null;
  seasonLimitMode: SeasonLimitMode;
  seasonDurationSeconds: number;
  seasonFuel: number;
  expectedPlayerCount: number;
  workshopName: string;
  readyCount: number;
  roundIndex: number;
  totalRounds: number;
  roundName: string;
}

export interface GroupStanding {
  code: string;
  groupName: string;
  workshopName: string;
  villageName: string;
  status: GameStatus;
  season: number;
  maxSeasons: number;
  roundIndex: number;
  roundName: string;
  playerCount: number;
  collapsedAtSeason: number | null;
  collapsedGroupsCanWin: boolean;
  eligibleForWin: boolean;
  totalExtracted: number;
  sustainedPlayers: number;
}

export interface WorkshopGroupSummary {
  code: string;
  groupName: string;
  status: GameStatus;
  season: number;
  maxSeasons: number;
  playerCount: number;
  expectedPlayerCount: number;
  readyCount: number;
  roundIndex: number;
  totalRounds: number;
  roundName: string;
  showSeasonCountToPlayers: boolean;
}

export const defaultSettings: GameSettings = {
  villageCount: 1,
  startingBalance: 40,
  maintenanceCost: 20,
  seasonLimitMode: "time",
  seasonDurationSeconds: 25,
  seasonFuel: 10,
  maxSeasons: 5,
  growthModel: "multiplier",
  reproductionRate: 2,
  catchVariance: 0,
  tradingEnabled: true,
  showPopulationToPlayers: false,
  feedbackMode: "hidden",
  initialResearchEnabled: true,
  researchCost: 0,
  showSeasonCountToPlayers: false,
  collapsedGroupsCanWin: true,
  stationSelectionMode: "buttons",
  scaleResourcesToPlayers: false,
  capacityPerPlayer: 120,
  startingStockRatio: 0.75,
  expectedPlayerCount: 5,
  workshopName: "",
};

export const renewableCommonsPreset: Partial<GameSettings> = {
  maintenanceCost: 20,
  seasonDurationSeconds: 25,
  maxSeasons: 5,
  growthModel: "logistic",
  reproductionRate: 1.2,
  tradingEnabled: false,
  scaleResourcesToPlayers: true,
  capacityPerPlayer: 100,
  startingStockRatio: 1,
};

export const hardCommonsPreset: Partial<GameSettings> = {
  ...renewableCommonsPreset,
  reproductionRate: 1.667,
  capacityPerPlayer: 60,
};

export const impossibleCommonsPreset: Partial<GameSettings> = {
  ...renewableCommonsPreset,
  reproductionRate: 2,
  capacityPerPlayer: 40,
};

export const finitePoolPreset: Partial<GameSettings> = {
  maintenanceCost: 0,
  maxSeasons: 3,
  growthModel: "none",
  reproductionRate: 0,
  tradingEnabled: false,
  scaleResourcesToPlayers: true,
  capacityPerPlayer: 50,
  startingStockRatio: 1,
};

export const defaultStations: StationSeed[] = [
  { name: "North Bank", startingPopulation: 100, carryingCapacity: 200 },
  { name: "Reed Bay", startingPopulation: 90, carryingCapacity: 200 },
  { name: "Deep Water", startingPopulation: 110, carryingCapacity: 220 },
];

export const boats: BoatDefinition[] = [
  {
    id: "rowboat",
    name: "Rowboat",
    description: "A modest catch each trip",
    cost: 0,
    catchSize: 5,
    fuelCost: 2,
  },
  {
    id: "skiff",
    name: "Skiff",
    description: "A stronger catch each trip",
    cost: 35,
    catchSize: 8,
    fuelCost: 2,
  },
  {
    id: "trawler",
    name: "Trawler",
    description: "A large catch each trip",
    cost: 85,
    catchSize: 16,
    fuelCost: 3,
  },
];
