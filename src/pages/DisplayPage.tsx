import { Clock3, Fish, FishOff, Fuel, Sprout, Trophy, Users } from "lucide-react";
import { useParams } from "react-router-dom";
import { FishTank } from "../components/FishTank";
import { CountdownOverlay, useCountdownSeconds } from "../components/CountdownOverlay";
import { Loading, ErrorScreen } from "../components/Loading";
import { QrCode } from "../components/QrCode";
import { growthLabel, totalFish, villageCompetitionResult, villageStats } from "../gameMath";
import { fisheryResultLabel } from "../resultLabel";
import { participantSeasonLabel } from "../seasonLabel";
import { useGame } from "../useGame";
import { formatSeasonTime, useSeasonSeconds } from "../useSeasonClock";

export function DisplayPage() {
  const { code: routeCode } = useParams();
  const code = routeCode?.toUpperCase();
  const { game, error, loading } = useGame(code);

  if (loading) return <Loading message="Opening projector display" />;
  if (error || !game) return <ErrorScreen message={error || "Game not found."} />;

  const population = totalFish(game.stations);
  const capacity = game.stations.reduce((sum, station) => sum + station.carryingCapacity, 0);
  const stockRatio = capacity ? population / capacity : 0;
  const statusLabel = game.status === "running" ? "Fishing now" : game.status === "ended" ? "Game finished" : game.status === "setup" ? "Waiting to start" : "Between seasons";
  const joinUrl = `${window.location.origin}/play/${game.code}`;
  const latestEvent = game.events[0];

  return (
    <main className={`display-shell display-status-${game.status}`}>
      <CountdownOverlay endsAt={game.countdownEndsAt} />
      {game.status === "running" && <div className="display-season-cue" key={`season-${game.season}`} aria-hidden="true"><span>Season</span><strong>{game.season}</strong></div>}
      <header className="display-header">
        <div className="display-title">
          <span className="display-mark"><Fish size={28} /></span>
          <div><span>Commons Fishery</span><strong>{game.title}</strong></div>
        </div>
        <div className="display-season">
          <span>{game.rounds[game.roundIndex]?.name ?? "Season"}</span><strong>{game.season}</strong>{game.settings.showSeasonCountToPlayers && <small>of {game.settings.maxSeasons} · {game.settings.maxSeasons - game.season === 0 ? "final season" : `${game.settings.maxSeasons - game.season} remaining`}</small>}
        </div>
        <div className={`display-status-pill status-${game.status}`}><i />{statusLabel}</div>
      </header>

      {game.status === "ended" ? <DisplayFinal game={game} /> : <>
      <section className="display-overview">
        {game.villages.length === 1 ? <div className="display-stock">
          <div className="stock-number"><strong>{game.settings.feedbackMode === "exact" ? population : game.settings.feedbackMode === "qualitative" ? stockRatio > 0.65 ? "Healthy" : stockRatio > 0.3 ? "Strained" : "Critical" : "?"}</strong><span>{game.settings.feedbackMode === "exact" ? "fish remain" : "fishery"}</span></div>
          {game.settings.feedbackMode === "exact" && (
            <>
              <div className="stock-meter" aria-label={`${Math.round(stockRatio * 100)} percent of capacity`}>
                <i style={{ width: `${Math.max(0, Math.min(100, stockRatio * 100))}%` }} />
              </div>
              <small>{Math.round(stockRatio * 100)}% of the ecosystem's capacity</small>
            </>
          )}
        </div> : <div className="competition-title"><span>Two villages</span><strong>One shared challenge</strong><small>Private success and village survival unfold together</small></div>}
        <SeasonClock game={game} />
        {game.status === "setup" ? <div className="display-join">
          <QrCode value={joinUrl} label={`Join ${game.code}`} />
          <div><span>Join the fishery</span><strong>{game.code}</strong><small>{game.players.length} fishers connected</small></div>
        </div> : <div className="display-participants"><Users size={22} /><div><span>Fishers connected</span><strong>{game.players.length}</strong><small>{game.players.map((player) => player.name).join(" · ")}</small></div></div>}
      </section>

      <section className={`display-villages display-villages-${game.villages.length}`} aria-label="Village fisheries">
        {game.villages.map((village, villageIndex) => {
          const stats = villageStats(game, village.id);
          const competition = villageCompetitionResult(game, village.id);
          const richest = [...stats.players].sort((left, right) => right.balance - left.balance)[0];
          return (
            <article className={`display-village display-village-${villageIndex} ${stats.collapsed ? "display-village-collapsed" : ""}`} key={village.id}>
              {stats.collapsed && <div className="display-collapse-stamp" key={`collapse-${village.collapsedAtSeason}`}><FishOff size={24} /><div><strong>Fishery collapsed</strong><span>No reproduction · {village.futureFoodCostPerPlayer} future food to survive charged per fisher</span></div></div>}
              <header>
                <div><span>Village</span><strong>{village.name}</strong></div>
                <div className="display-village-status"><i /><strong>{stats.collapsed ? "Fishery collapsed" : competition === "ahead" ? "Last fishery standing" : "Fishery active"}</strong><span>{game.settings.feedbackMode === "exact" ? `${stats.population} fish · ${Math.round(stats.ratio * 100)}% capacity` : game.settings.feedbackMode === "qualitative" ? `${stats.ratio > 0.65 ? "Healthy" : stats.ratio > 0.3 ? "Strained" : "Critical"} · ${stats.players.length} fishers` : `${stats.players.length} fishers`}</span></div>
                <div className="display-village-leader"><span>Largest private balance</span><strong>{richest ? `${richest.name} · ${richest.balance}` : "Waiting for fishers"}</strong></div>
              </header>
              <section className="display-stations">
                {stats.stations.map((station, index) => (
                  <FishTank
                    key={station.id}
                    station={station}
                    index={index + villageIndex * 2}
                    displayMode={stats.collapsed ? "exact" : game.settings.feedbackMode}
                    compact={game.villages.length === 2}
                  />
                ))}
              </section>
            </article>
          );
        })}
      </section>

      <footer className="display-footer">
        <div className="display-rule"><Sprout size={20} /><span>Between seasons</span><strong>{growthLabel(game.settings)}</strong></div>
        <div className="display-rule"><Users size={20} /><span>Food to survive</span><strong>{game.settings.maintenanceCost} fish deducted per fisher each season</strong></div>
        <div className="activity-ticker" key={latestEvent?.id ?? "waiting"}><i /><span>{latestEvent?.message ?? "Waiting for activity"}</span></div>
      </footer>
      </>}
    </main>
  );
}

function DisplayFinal({ game }: { game: NonNullable<ReturnType<typeof useGame>["game"]> }) {
  return (
    <section className="display-final">
      <header className="display-final-heading">
        <Trophy size={30} />
        <div><span>Round complete</span><strong>How the fisheries finished</strong></div>
      </header>
      <div className={`display-final-groups display-final-groups-${game.villages.length}`}>
        {game.villages.map((village) => {
          const stats = villageStats(game, village.id);
          const totalExtracted = stats.stations.reduce((sum, station) => sum + station.totalCaught, 0);
          const sustained = stats.players.filter((player) => player.balance >= 0).length;
          return (
            <article className={stats.collapsed ? "display-final-group display-final-group-collapsed" : "display-final-group"} key={village.id}>
              <div className="display-final-group-title"><span>{village.name}</span><strong>{fisheryResultLabel(game, village.collapsedAtSeason)}</strong></div>
              <div className="display-final-harvest"><strong>{totalExtracted}</strong><span>fish extracted</span></div>
              <div className="display-final-metrics display-final-metrics-one">
                <span><small>People sustained</small><strong>{sustained} / {stats.players.length}</strong></span>
              </div>
              <div className="display-final-players">
                {[...stats.players].sort((left, right) => right.balance - left.balance).map((player) => <span key={player.id}><strong>{player.name}</strong><b>{player.balance}</b><small>{player.balance >= 0 ? "sustained" : "food shortfall"}</small></span>)}
              </div>
            </article>
          );
        })}
      </div>
      <footer className="display-final-note"><Fish size={19} /><span>Groups are ranked by total fish extracted.</span></footer>
    </section>
  );
}

function SeasonClock({ game }: { game: NonNullable<ReturnType<typeof useGame>["game"]> }) {
  const countdown = useCountdownSeconds(game.countdownEndsAt);
  const remaining = useSeasonSeconds(
    game.seasonStartedAt,
    game.settings.seasonDurationSeconds,
    game.status === "running" && game.settings.seasonLimitMode === "time",
  );
  if (game.status === "ended") {
    return <div className="display-clock"><Trophy size={21} /><div><span>Round complete</span><strong>Results</strong></div></div>;
  }
  if (countdown > 0) {
    return (
      <div className="display-clock display-clock-countdown">
        <Clock3 size={21} />
        <div><span>Starting together</span><strong>{countdown}</strong></div>
      </div>
    );
  }
  if (game.status === "setup" || (game.status === "paused" && game.seasonHasRun)) {
    const eligible = game.players.filter((player) =>
      game.villages.find((village) => village.id === player.villageId)?.collapsedAtSeason === null);
    const ready = eligible.filter((player) => player.readyForNextSeason).length;
    const targetSeason = game.status === "setup" ? 1 : game.season + 1;
    const targetSeasonLabel = participantSeasonLabel(
      targetSeason,
      game.settings.maxSeasons,
      game.settings.showSeasonCountToPlayers,
    );
    return (
      <div className="display-clock">
        <Users size={21} />
        <div><span>Ready for {targetSeasonLabel}</span><strong>{ready} / {game.status === "setup" ? game.settings.expectedPlayerCount : eligible.length}</strong></div>
      </div>
    );
  }
  if (game.settings.seasonLimitMode === "fuel") {
    const remainingFuel = game.players.reduce((sum, player) => sum + player.fuel, 0);
    const totalFuel = game.players.length * game.settings.seasonFuel;
    return (
      <div className="display-clock">
        <Fuel size={21} />
        <div><span>Fuel remaining</span><strong>{remainingFuel} / {totalFuel}</strong></div>
      </div>
    );
  }
  return (
    <div className="display-clock">
      <Clock3 size={21} />
      <div><span>{game.status === "running" ? "Time remaining" : "Season timer"}</span><strong>{formatSeasonTime(remaining)}</strong></div>
    </div>
  );
}
