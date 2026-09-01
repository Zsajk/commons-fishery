import type { GameState } from "../shared/game";

export function fisheryResultLabel(
  game: GameState,
  collapsedAtSeason: number | null,
): string {
  if (collapsedAtSeason !== null) return `Fishery collapsed in Season ${collapsedAtSeason}`;
  if (game.season >= game.settings.maxSeasons && game.seasonHasRun) {
    return `Fishery survived ${game.settings.maxSeasons} seasons`;
  }
  if (!game.seasonHasRun) return `Round ended before Season ${game.season}`;
  return `Round ended in Season ${game.season}`;
}
