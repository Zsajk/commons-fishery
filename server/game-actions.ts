import { randomUUID } from "node:crypto";
import {
  addPlayer,
  advanceSeason,
  createGame,
  endGame,
  fish,
  normalizeCode,
  pauseGame,
  purchaseBoat,
  researchStation,
  resetGame,
  prepareNextRound,
  setPlayerReady,
  startGame,
  startOrAdvanceSeason,
  tradeFish,
} from "../shared/engine.js";
import type {
  ActionResult,
  GameSettings,
  GameState,
  GroupStanding,
  HostGameSummary,
  StationSeed,
  WorkshopGroupSummary,
  WorkshopRound,
} from "../shared/game.js";
import type { GameRepository } from "./game-repository.js";

export interface HandledAction {
  result: ActionResult<unknown>;
  game?: GameState;
  games?: GameState[];
  subscriptionCode?: string;
}

export interface ActionAuthorization {
  facilitator: boolean;
  player?: {
    code: string;
    playerId: string;
  };
  allowPlayerJoin?: boolean;
}

const anonymousAuthorization: ActionAuthorization = { facilitator: false };

type CreatePayload = {
  code: string;
  title: string;
  settings: Partial<GameSettings>;
  stations: StationSeed[];
  rounds?: WorkshopRound[];
};

type CreateWorkshopPayload = CreatePayload & {
  workshopName: string;
  groupCount: number;
  groupPrefix: string;
};

export async function handleGameAction(
  repository: GameRepository,
  event: string,
  rawPayload: unknown,
  authorization: ActionAuthorization = anonymousAuthorization,
): Promise<HandledAction> {
  if (event === "game:subscribe") {
    const code = normalizeCode(String(rawPayload ?? ""));
    if (authorization.player && normalizeCode(authorization.player.code) !== code) {
      return { result: { ok: false, error: "Your player session belongs to a different group." } };
    }
    const game = await repository.get(code);
    if (!game) return { result: { ok: false, error: "Game not found." } };
    return { result: { ok: true, data: game }, subscriptionCode: code };
  }

  if (event === "host:list") {
    if (!authorization.facilitator) return facilitatorRequired();
    const games = await repository.list();
    const summaries = games
      .map(summarizeGame)
      .sort((left, right) => right.lastActivityAt - left.lastActivityAt);
    return { result: { ok: true, data: summaries } };
  }

  if (event === "host:create") {
    if (!authorization.facilitator) return facilitatorRequired();
    const payload = rawPayload as CreatePayload;
    const code = normalizeCode(payload.code);
    if (code.length < 6) {
      return { result: { ok: false, error: "Use a game code with at least six characters." } };
    }
    if (!payload.stations.length) {
      return { result: { ok: false, error: "Add at least one fishing station." } };
    }
    const game = createGame(code, payload.title, payload.settings, payload.stations, payload.rounds);
    const created = await repository.create(game);
    if (!created) return { result: { ok: false, error: "That game code is already in use." } };
    return {
      result: { ok: true, data: game },
      game,
      subscriptionCode: code,
    };
  }

  if (event === "host:create-workshop") {
    if (!authorization.facilitator) return facilitatorRequired();
    const payload = rawPayload as CreateWorkshopPayload;
    const groupCount = Math.max(1, Math.min(30, Math.round(Number(payload.groupCount) || 1)));
    const workshopName = String(payload.workshopName ?? "").trim().slice(0, 50);
    if (!workshopName) return { result: { ok: false, error: "Enter a session name." } };
    if (!Array.isArray(payload.stations) || payload.stations.length === 0) {
      return { result: { ok: false, error: "Add at least one fishing station." } };
    }

    const prefix = String(payload.groupPrefix ?? "Group").trim().slice(0, 30) || "Group";
    const games: GameState[] = [];
    const generatedCodes = new Set<string>();
    for (let index = 0; index < groupCount; index += 1) {
      let code = "";
      do {
        code = `W${randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase()}`;
      } while (generatedCodes.has(code) || await repository.get(code));
      generatedCodes.add(code);
      const settings = { ...payload.settings, workshopName };
      games.push(createGame(
        code,
        `${prefix} ${index + 1}`,
        settings,
        payload.stations,
        payload.rounds,
      ));
    }
    for (const game of games) {
      const created = await repository.create(game);
      if (!created) return { result: { ok: false, error: "A group code collided. Please try again." } };
    }
    return { result: { ok: true, data: games }, games };
  }

  if (event === "host:workshop-command") {
    if (!authorization.facilitator) return facilitatorRequired();
    const payload = rawPayload as Record<string, unknown>;
    const workshopName = String(payload.workshopName ?? "").trim().toLowerCase();
    const workshopGames = (await repository.list()).filter(
      (game) => game.settings.workshopName.trim().toLowerCase() === workshopName,
    );
    if (!workshopName || workshopGames.length === 0) {
      return { result: { ok: false, error: "Session not found." } };
    }

    if (payload.command === "start") {
      const waiting = workshopGames.filter((game) => game.status === "setup");
      if (waiting.length === 0) return { result: { ok: false, error: "No groups are waiting to start." } };
      const unready = waiting.find((game) => {
        const eligible = game.players.filter((player) =>
          game.villages.find((village) => village.id === player.villageId)?.collapsedAtSeason === null);
        return game.players.length < game.settings.expectedPlayerCount
          || eligible.length === 0
          || eligible.some((player) => !player.readyForNextSeason);
      });
      if (unready) {
        return { result: { ok: false, error: `${unready.title} is not full and ready yet.` } };
      }
      const changed: GameState[] = [];
      for (const game of waiting) {
        const commit = await repository.mutate(game.code, (current) => startGame(current, 3000));
        if (!commit.result.ok) return { result: commit.result, games: changed };
        if (commit.game) changed.push(commit.game);
      }
      return { result: { ok: true, data: changed.map(summarizeGame) }, games: changed };
    }

    if (payload.command === "next-round") {
      if (workshopGames.some((game) => game.status !== "ended")) {
        return { result: { ok: false, error: "Finish every group before preparing the next round." } };
      }
      if (workshopGames.some((game) => game.roundIndex + 1 >= game.rounds.length)) {
        return { result: { ok: false, error: "There are no more prepared rounds." } };
      }
      const changed: GameState[] = [];
      for (const game of workshopGames) {
        const commit = await repository.mutate(game.code, prepareNextRound);
        if (!commit.result.ok) return { result: commit.result, games: changed };
        if (commit.game) changed.push(commit.game);
      }
      return { result: { ok: true, data: changed.map(summarizeGame) }, games: changed };
    }

    return { result: { ok: false, error: "Unknown session command." } };
  }

  const payload = rawPayload as Record<string, unknown>;
  const code = normalizeCode(String(payload.code ?? ""));

  if (event === "player:join") {
    if (!authorization.allowPlayerJoin) {
      return { result: { ok: false, error: "Join through the participant page." } };
    }
    const commit = await repository.mutate(code, (game) => {
      if (game.status !== "setup") {
        return { ok: false, error: "This game has already started." };
      }
      if (game.players.length >= game.settings.expectedPlayerCount) {
        return { ok: false, error: "This group is full." };
      }
      const player = addPlayer(
        game,
        String(payload.name ?? ""),
        typeof payload.villageId === "string" ? payload.villageId : undefined,
      );
      return { ok: true, data: { game, playerId: player.id } };
    });
    return {
      result: commit.result,
      game: commit.game,
      subscriptionCode: commit.result.ok ? code : undefined,
    };
  }

  if (event === "host:settings") {
    if (!authorization.facilitator) return facilitatorRequired();
    return fromCommit(await repository.mutate(code, (game) => {
      if (game.status === "running") {
        return { ok: false, error: "Pause before changing settings." };
      }
      game.settings = { ...game.settings, ...(payload.settings as Partial<GameSettings>) };
      game.settings.showPopulationToPlayers = game.settings.feedbackMode === "exact";
      if (!game.seasonHasRun) {
        for (const player of game.players) player.fuel = game.settings.seasonFuel;
      }
      return { ok: true };
    }));
  }

  if (event === "host:station") {
    if (!authorization.facilitator) return facilitatorRequired();
    return fromCommit(await repository.mutate(code, (game) => {
      if (game.status === "running") {
        return { ok: false, error: "Pause before editing a station." };
      }
      const station = game.stations.find((item) => item.id === payload.stationId);
      if (!station) return { ok: false, error: "Station not found." };
      const changes = payload.changes as Partial<StationSeed>;
      if (changes.name !== undefined) station.name = changes.name.trim().slice(0, 30);
      if (changes.carryingCapacity !== undefined) {
        station.carryingCapacity = Math.max(1, Math.round(changes.carryingCapacity));
        station.population = Math.min(station.population, station.carryingCapacity);
      }
      return { ok: true };
    }));
  }

  if (event === "host:command") {
    if (!authorization.facilitator) return facilitatorRequired();
    return fromCommit(await repository.mutate(code, (game) => {
      if (payload.command === "start") {
        return game.status === "setup" ? startGame(game, 3000) : startOrAdvanceSeason(game);
      }
      if (payload.command === "pause") return pauseGame(game);
      if (payload.command === "next") return advanceSeason(game);
      if (payload.command === "end") return endGame(game);
      if (payload.command === "reset") {
        resetGame(game);
      } else if (payload.command === "next-round") {
        return prepareNextRound(game);
      } else {
        return { ok: false, error: "Unknown host command." };
      }
      return { ok: true };
    }));
  }

  if (event === "host:delete") {
    if (!authorization.facilitator) return facilitatorRequired();
    const game = await repository.get(code);
    if (!game) return { result: { ok: false, error: "Game not found." } };
    if (game.status !== "setup" && game.status !== "ended") {
      return { result: { ok: false, error: "End the game before removing it." } };
    }
    const removed = await repository.remove(code);
    return { result: removed ? { ok: true } : { ok: false, error: "Game not found." } };
  }

  const playerId = authorizedPlayerId(authorization, code, payload.playerId);
  if (event.startsWith("player:") && !playerId) {
    return { result: { ok: false, error: "Your player session is missing or no longer valid." } };
  }

  if (event === "player:fish") {
    return fromCommit(await repository.mutate(code, (game) =>
      fish(game, playerId!, String(payload.stationId ?? ""))));
  }

  if (event === "player:research") {
    return fromCommit(await repository.mutate(code, (game) =>
      researchStation(game, playerId!, String(payload.stationId ?? ""))));
  }

  if (event === "player:purchase") {
    return fromCommit(await repository.mutate(code, (game) =>
      purchaseBoat(game, playerId!, String(payload.boatId ?? ""))));
  }

  if (event === "player:trade") {
    return fromCommit(await repository.mutate(code, (game) =>
      tradeFish(
        game,
        playerId!,
        String(payload.recipientId ?? ""),
        Number(payload.amount),
      )));
  }

  if (event === "player:ready") {
    return fromCommit(await repository.mutate(code, (game) =>
      setPlayerReady(game, playerId!, payload.ready !== false)));
  }

  return { result: { ok: false, error: "Unknown game action." } };
}

function facilitatorRequired(): HandledAction {
  return { result: { ok: false, error: "Facilitator access is required." } };
}

function summarizeGame(game: GameState): HostGameSummary {
  return {
    code: game.code,
    title: game.title,
    status: game.status,
    season: game.season,
    maxSeasons: game.settings.maxSeasons,
    playerCount: game.players.length,
    fishRemaining: game.stations.reduce((sum, station) => sum + station.population, 0),
    createdAt: game.createdAt,
    lastActivityAt: game.events[0]?.at ?? game.createdAt,
    seasonStartedAt: game.seasonStartedAt,
    seasonLimitMode: game.settings.seasonLimitMode,
    seasonDurationSeconds: game.settings.seasonDurationSeconds,
    seasonFuel: game.settings.seasonFuel,
    expectedPlayerCount: game.settings.expectedPlayerCount,
    workshopName: game.settings.workshopName,
    readyCount: game.players.filter((player) => player.readyForNextSeason).length,
    roundIndex: game.roundIndex,
    totalRounds: Math.max(1, game.rounds.length),
    roundName: game.rounds[game.roundIndex]?.name ?? game.title,
  };
}

export function buildGroupStandings(
  games: GameState[],
  requestedWorkshopName: string,
): GroupStanding[] {
  const workshopName = requestedWorkshopName.trim().toLowerCase();
  if (!workshopName) return [];

  return games
    .filter((game) => game.settings.workshopName.trim().toLowerCase() === workshopName)
    .filter((game) => game.rounds[game.roundIndex]?.scored !== false)
    .flatMap((game) => game.villages.map((village) => {
      const players = game.players.filter((player) => player.villageId === village.id);
      const totalExtracted = game.stations
        .filter((station) => station.villageId === village.id)
        .reduce((sum, station) => sum + station.totalCaught, 0);
      const eligibleForWin = village.collapsedAtSeason === null
        || game.settings.collapsedGroupsCanWin;
      return {
        code: game.code,
        groupName: game.villages.length === 1 ? game.title : `${game.title} · ${village.name}`,
        workshopName: game.settings.workshopName,
        villageName: village.name,
        status: game.status,
        season: game.season,
        maxSeasons: game.settings.maxSeasons,
        roundIndex: game.roundIndex,
        roundName: game.rounds[game.roundIndex]?.name ?? game.title,
        playerCount: players.length,
        collapsedAtSeason: village.collapsedAtSeason,
        collapsedGroupsCanWin: game.settings.collapsedGroupsCanWin,
        eligibleForWin,
        totalExtracted,
        sustainedPlayers: players.filter((player) => player.balance >= 0).length,
      } satisfies GroupStanding;
    }))
    .sort((left, right) =>
      Number(right.eligibleForWin) - Number(left.eligibleForWin)
      || right.totalExtracted - left.totalExtracted
      || (right.collapsedAtSeason ?? Number.POSITIVE_INFINITY)
        - (left.collapsedAtSeason ?? Number.POSITIVE_INFINITY)
      || left.groupName.localeCompare(right.groupName));
}

export function buildWorkshopGroups(
  games: GameState[],
  requestedWorkshopName: string,
): WorkshopGroupSummary[] {
  const workshopName = requestedWorkshopName.trim().toLowerCase();
  if (!workshopName) return [];
  return games
    .filter((game) => game.settings.workshopName.trim().toLowerCase() === workshopName)
    .map((game) => ({
      code: game.code,
      groupName: game.title,
      status: game.status,
      season: game.season,
      maxSeasons: game.settings.maxSeasons,
      playerCount: game.players.length,
      expectedPlayerCount: game.settings.expectedPlayerCount,
      readyCount: game.players.filter((player) => player.readyForNextSeason).length,
      roundIndex: game.roundIndex,
      totalRounds: Math.max(1, game.rounds.length),
      roundName: game.rounds[game.roundIndex]?.name ?? game.title,
      showSeasonCountToPlayers: game.settings.showSeasonCountToPlayers,
    }))
    .sort((left, right) => left.groupName.localeCompare(right.groupName, undefined, { numeric: true }));
}

function authorizedPlayerId(
  authorization: ActionAuthorization,
  code: string,
  requestedPlayerId: unknown,
): string | null {
  const player = authorization.player;
  if (!player || player.code !== code) return null;
  if (requestedPlayerId !== undefined && String(requestedPlayerId) !== player.playerId) return null;
  return player.playerId;
}

function fromCommit<T>(commit: { result: ActionResult<T>; game?: GameState }): HandledAction {
  return { result: commit.result, game: commit.game };
}
