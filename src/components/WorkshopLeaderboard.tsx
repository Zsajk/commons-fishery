import { CircleAlert, Fish, Trophy, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { GroupStanding, WorkshopGroupSummary } from "../../shared/game";

function useCountUp(target: number, active: boolean) {
  const [value, setValue] = useState(active ? 0 : target);

  useEffect(() => {
    if (!active) {
      setValue(target);
      return;
    }
    const startedAt = performance.now();
    let frame = 0;
    const animate = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / 900);
      setValue(Math.round(target * (1 - (1 - progress) ** 3)));
      if (progress < 1) frame = window.requestAnimationFrame(animate);
    };
    frame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frame);
  }, [active, target]);

  return value;
}

function WinnerReveal({
  winners,
  currentCode,
}: {
  winners: GroupStanding[];
  currentCode?: string;
}) {
  const topScore = winners[0]?.totalExtracted ?? 0;
  const animatedScore = useCountUp(topScore, winners.length > 0);
  const currentGroupWon = Boolean(currentCode && winners.some((winner) => winner.code === currentCode));

  if (winners.length === 0) {
    return (
      <div className="winner-reveal winner-reveal-empty" role="status">
        <CircleAlert size={31} />
        <div><span>Round complete</span><strong>All fisheries collapsed</strong><small>No group was eligible to win this round.</small></div>
      </div>
    );
  }

  const winnerNames = winners.map((winner) => winner.groupName).join(" & ");
  return (
    <div className={`winner-reveal ${currentGroupWon ? "winner-reveal-current" : ""}`} role="status">
      <div className="winner-confetti" aria-hidden="true">
        {Array.from({ length: 22 }, (_, index) => (
          <i
            key={index}
            style={{
              left: `${3 + ((index * 37) % 94)}%`,
              animationDelay: `${(index % 7) * 70}ms`,
              animationDuration: `${900 + (index % 5) * 110}ms`,
            }}
          />
        ))}
      </div>
      <Trophy size={38} />
      <div>
        <span>{winners.length > 1 ? "Group winners" : currentGroupWon ? "Your group wins" : "Group winner"}</span>
        <strong>{winnerNames}</strong>
        <small><b>{animatedScore}</b> fish extracted</small>
      </div>
    </div>
  );
}

export function WorkshopLeaderboard({
  standings,
  groups = [],
  currentCode,
}: {
  standings: GroupStanding[];
  groups?: WorkshopGroupSummary[];
  currentCode?: string;
}) {
  const activeRound = standings[0]?.roundIndex;
  const allGroupsOnRound = groups.length > 0
    && activeRound !== undefined
    && groups.every((group) => group.roundIndex === activeRound);
  const finishedGroups = groups.filter((group) => group.roundIndex === activeRound && group.status === "ended").length;
  const competitionComplete = allGroupsOnRound && groups.every((group) => group.status === "ended");
  const winners = useMemo(() => {
    if (!competitionComplete) return [];
    const eligible = standings.filter((standing) => standing.eligibleForWin);
    if (eligible.length === 0) return [];
    const topScore = Math.max(...eligible.map((standing) => standing.totalExtracted));
    return eligible.filter((standing) => standing.totalExtracted === topScore);
  }, [competitionComplete, standings]);
  let rank = 0;
  let previousScore: number | null = null;

  return (
    <section className="workshop-leaderboard">
      <header>
        <Trophy size={21} />
        <div>
          <h2>Group ranking</h2>
          <p>Groups are ranked by total fish extracted.</p>
        </div>
        {groups.length > 0 && !competitionComplete && (
          <span className="leaderboard-progress">{finishedGroups} / {groups.length} groups finished</span>
        )}
      </header>
      {competitionComplete && <WinnerReveal winners={winners} currentCode={currentCode} />}
      {standings.length === 0 ? <p className="empty-state">Waiting for group results.</p> : (
        <div className="leaderboard-table-wrap">
          <table>
            <thead><tr><th>Rank</th><th>Group</th><th><Fish size={14} /> Fish extracted</th><th><Users size={14} /> Sustained</th><th>Result</th></tr></thead>
            <tbody>{standings.map((standing) => {
              let displayedRank = "—";
              if (standing.eligibleForWin) {
                if (previousScore !== standing.totalExtracted) rank += 1;
                displayedRank = String(rank);
                previousScore = standing.totalExtracted;
              }
              const current = standing.code === currentCode;
              return (
                <tr
                  className={`${current ? "leaderboard-current" : ""} ${standing.eligibleForWin ? "" : "leaderboard-ineligible"}`}
                  key={`${standing.code}-${standing.villageName}`}
                >
                  <td><strong>{displayedRank}</strong></td>
                  <td><strong>{standing.groupName}</strong><small>{standing.playerCount} {standing.playerCount === 1 ? "fisher" : "fishers"}</small></td>
                  <td className="leaderboard-score"><strong>{standing.totalExtracted}</strong></td>
                  <td>{standing.sustainedPlayers} / {standing.playerCount}</td>
                  <td>
                    {standing.collapsedAtSeason === null
                      ? standing.status === "ended" ? "Survived" : `Season ${standing.season}`
                      : <span className="collapse-badge">Collapsed in Season {standing.collapsedAtSeason}{!standing.eligibleForWin && <small>Cannot win</small>}</span>}
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
