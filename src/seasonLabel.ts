export function participantSeasonLabel(
  season: number,
  maxSeasons: number,
  showRemaining: boolean,
): string {
  if (!showRemaining) return `Season ${season}`;
  const remaining = Math.max(0, maxSeasons - season);
  const horizon = remaining === 0 ? "final season" : `${remaining} remaining`;
  return `Season ${season} of ${maxSeasons} · ${horizon}`;
}
