import { Link, useParams } from "react-router-dom";
import { Brand } from "../components/Brand";
import { WorkshopLeaderboard } from "../components/WorkshopLeaderboard";
import { useLeaderboard } from "../useLeaderboard";

export function LeaderboardPage() {
  const { workshopName = "" } = useParams();
  const name = decodeURIComponent(workshopName);
  const { standings, groups, error } = useLeaderboard(name);
  return (
    <main className="leaderboard-page">
      <header><Brand /><Link className="secondary-button" to="/host">Facilitator</Link></header>
      <div className="leaderboard-heading"><p className="eyebrow">Live group results</p><h1>{name}</h1><p>The group that extracts the most fish wins, subject to the round's collapse rule.</p></div>
      {error && <p className="form-error">{error}</p>}
      <WorkshopLeaderboard standings={standings} groups={groups} />
    </main>
  );
}
