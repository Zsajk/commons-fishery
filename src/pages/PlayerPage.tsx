import {
  ArrowRight,
  CircleCheckBig,
  Clock3,
  Fish,
  FlaskConical,
  Fuel,
  QrCode,
  Sailboat,
  Send,
  ShoppingBasket,
  Users,
  WalletCards,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import type { ActionResult, GameState, Player, PlayerJoinResult } from "../../shared/game";
import { getBrowserSession, joinGame } from "../api";
import { Brand } from "../components/Brand";
import { CountdownOverlay, useCountdownSeconds } from "../components/CountdownOverlay";
import { ErrorScreen, Loading } from "../components/Loading";
import { QrScanner } from "../components/QrScanner";
import { WorkshopLeaderboard } from "../components/WorkshopLeaderboard";
import { participantSeasonLabel as formatParticipantSeason } from "../seasonLabel";
import { fisheryResultLabel } from "../resultLabel";
import { emitWithAck } from "../socket";
import { useGame } from "../useGame";
import { villageStats } from "../gameMath";
import { formatSeasonTime, useSeasonSeconds } from "../useSeasonClock";
import { useLeaderboard } from "../useLeaderboard";

function PlayerJoin({ code, game }: { code: string; game: GameState }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [joining, setJoining] = useState(false);
  const [villageId, setVillageId] = useState(game.villages[0]?.id ?? "");

  if (game.status !== "setup") {
    return <ErrorScreen message="This game has already started. Reopen it on the device you joined with." />;
  }

  const join = async (event: React.FormEvent) => {
    event.preventDefault();
    setJoining(true);
    const result: ActionResult<PlayerJoinResult> = await joinGame(code, name, villageId).catch(() => ({
      ok: false,
      error: "Unable to reach the server.",
    }));
    setJoining(false);
    if (!result.ok || !result.data) return setError(result.error ?? "Unable to join.");
    window.location.reload();
  };

  return (
    <main className="player-join-shell">
      <Brand />
      <section className="player-join-panel">
        <span className="join-game-code">{code}</span>
        <h1>{game.title}</h1>
        <p>Choose a name that others in the room will recognize.</p>
        <form onSubmit={join}>
          <label className="field"><span>Display name</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={24} autoFocus required /></label>
          {game.villages.length === 2 && (
            <fieldset className="village-choice">
              <legend>Your village</legend>
              {game.villages.map((village, index) => (
                <button type="button" className={`village-choice-${index}`} aria-pressed={villageId === village.id} onClick={() => setVillageId(village.id)} key={village.id}>
                  <strong>{village.name}</strong>
                  <span>{game.players.filter((player) => player.villageId === village.id).length} joined</span>
                </button>
              ))}
            </fieldset>
          )}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button" disabled={joining}>{joining ? "Joining…" : "Join game"}<ArrowRight size={18} /></button>
        </form>
      </section>
    </main>
  );
}

function PlayerStatus({ game, player }: { game: GameState; player: Player }) {
  const boat = game.boats.find((item) => item.id === player.boatId) ?? game.boats[0];
  return (
    <div className="player-status">
      <div><WalletCards size={18} /><span>Balance</span><strong className="status-value" key={`balance-${player.balance}`}>{player.balance}</strong><small>fish</small></div>
      {game.status === "ended" ? (
        <div><CircleCheckBig size={18} /><span>Outcome</span><strong>{player.balance >= 0 ? "Sustained" : "Shortfall"}</strong><small>after all food costs</small></div>
      ) : (
        <div><ShoppingBasket size={18} /><span>Food to survive</span><strong>{game.settings.maintenanceCost}</strong><small>deducted each season</small></div>
      )}
      <div><Sailboat size={18} /><span>Boat</span><strong className="status-value" key={`boat-${boat.id}`}>{boat.name}</strong><small>{boat.catchSize} per catch</small></div>
    </div>
  );
}

function PlayerSeasonLimit({ game, player }: { game: GameState; player: Player }) {
  const remaining = useSeasonSeconds(
    game.seasonStartedAt,
    game.settings.seasonDurationSeconds,
    game.status === "running" && game.settings.seasonLimitMode === "time",
  );
  const boat = game.boats.find((item) => item.id === player.boatId) ?? game.boats[0];
  const isTimer = game.settings.seasonLimitMode === "time";
  const current = isTimer ? remaining : player.fuel;
  const maximum = isTimer ? game.settings.seasonDurationSeconds : game.settings.seasonFuel;
  const ratio = maximum > 0 ? Math.max(0, Math.min(1, current / maximum)) : 0;
  if (game.status === "ended") return null;

  return (
    <section className={`player-season-limit player-season-limit-${game.settings.seasonLimitMode} ${ratio <= 0.2 ? "player-season-limit-low" : ""}`} aria-label={isTimer ? `${formatSeasonTime(remaining)} remaining in the season` : `${player.fuel} fuel units remaining`}>
      <div className="player-season-limit-copy">
        <span className="player-season-limit-icon">{isTimer ? <Clock3 size={20} /> : <Fuel size={20} />}</span>
        <div><span>{isTimer ? "Season timer" : "Your fuel"}</span><strong>{isTimer ? formatSeasonTime(remaining) : `${player.fuel} / ${game.settings.seasonFuel}`}</strong></div>
        <small>{isTimer ? game.status === "running" ? "Season ends at zero" : "Starts with the season" : game.status === "running" ? `${boat.name} uses ${boat.fuelCost} per trip` : `Restores to ${game.settings.seasonFuel} next season`}</small>
      </div>
      <div className="player-season-limit-track" aria-hidden="true"><i style={{ width: `${ratio * 100}%` }} /></div>
    </section>
  );
}

function PlayerReadyControl({
  game,
  player,
  act,
}: {
  game: GameState;
  player: Player;
  act: (event: string, payload: object) => Promise<ActionResult<any>>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const village = game.villages.find((item) => item.id === player.villageId);
  const preparingFirstSeason = game.status === "setup";
  const preparingLaterSeason = game.status === "paused" && game.seasonHasRun;
  if ((!preparingFirstSeason && !preparingLaterSeason) || village?.collapsedAtSeason !== null) return null;

  const eligiblePlayers = game.players.filter((item) =>
    game.villages.find((candidate) => candidate.id === item.villageId)?.collapsedAtSeason === null);
  const readyCount = eligiblePlayers.filter((item) => item.readyForNextSeason).length;
  const ready = player.readyForNextSeason;
  const nextSeason = preparingFirstSeason ? 1 : game.season + 1;
  const nextSeasonLabel = participantSeasonLabel(game, nextSeason);
  const groupFull = !preparingFirstSeason || game.players.length >= game.settings.expectedPlayerCount;
  const toggleReady = async () => {
    setBusy(true);
    setError("");
    const result = await act("player:ready", { ready: !ready });
    setBusy(false);
    if (!result.ok) setError(result.error ?? "Unable to update readiness.");
  };

  return (
    <section className={`player-ready-control ${ready ? "player-ready-confirmed" : ""}`}>
      <span className="player-ready-icon"><CircleCheckBig size={23} /></span>
      <div>
        <strong>{ready ? `Ready for ${nextSeasonLabel}` : `Prepare for ${nextSeasonLabel}`}</strong>
        <span>{!groupFull ? `Waiting for ${game.settings.expectedPlayerCount - game.players.length} more ${game.settings.expectedPlayerCount - game.players.length === 1 ? "fisher" : "fishers"} to join.` : ready ? preparingFirstSeason ? "Waiting for the facilitator to launch the game." : `Waiting for ${eligiblePlayers.length - readyCount} other ${eligiblePlayers.length - readyCount === 1 ? "fisher" : "fishers"}.` : "Make any available choices, then press Ready."}</span>
        <small>{preparingFirstSeason ? `${game.players.length} of ${game.settings.expectedPlayerCount} joined · ${readyCount} of ${eligiblePlayers.length} ready · facilitator starts the game` : `${readyCount} of ${eligiblePlayers.length} ready · next season starts automatically`}</small>
      </div>
      <button className={ready ? "secondary-button" : "primary-button"} onClick={toggleReady} disabled={busy} aria-pressed={ready}>
        {busy ? "Saving…" : ready ? "Change choices" : "I'm ready"}
      </button>
      {error && <p className="form-error" role="alert">{error}</p>}
    </section>
  );
}

function PlayerRoster({ game }: { game: GameState }) {
  return (
    <section className="player-roster" aria-label={`${game.players.length} ${game.players.length === 1 ? "player" : "players"} in this game`}>
      <header><Users size={17} /><strong>{game.players.length} / {game.settings.expectedPlayerCount} {game.settings.expectedPlayerCount === 1 ? "fisher" : "fishers"}</strong></header>
      <div>{game.villages.map((village) => (
        <span className={village.collapsedAtSeason !== null ? "roster-village-collapsed" : ""} key={village.id}>
          {game.villages.length > 1 && <b>{village.name}</b>}
          {game.players.filter((player) => player.villageId === village.id).map((player) => <i className={player.readyForNextSeason ? "ready" : ""} key={player.id}>{player.name}{player.readyForNextSeason ? " ✓" : ""}</i>)}
        </span>
      ))}</div>
    </section>
  );
}

function PersonalFishingScene({
  boatId,
  fishing,
  caught,
  stationName,
}: {
  boatId: string;
  fishing: boolean;
  caught: number | null;
  stationName?: string;
}) {
  return (
    <div
      className={`personal-fishing-scene ${fishing ? "personal-scene-fishing" : ""} ${caught !== null ? "personal-scene-caught" : ""}`}
      aria-label={fishing ? `Fishing at ${stationName ?? "the station"}` : caught !== null ? `Caught ${caught} fish` : "Your fishing boat is ready"}
    >
      <div className="personal-scene-water" aria-hidden="true">
        <span className={`personal-scene-boat personal-scene-boat-${boatId}`}><Sailboat size={30} /></span>
        <i className="personal-scene-line" />
        <span className="personal-scene-school">
          {Array.from({ length: 6 }, (_, index) => <Fish className={`personal-scene-fish personal-scene-fish-${index}`} size={14 + (index % 3) * 2} key={index} />)}
        </span>
        {caught !== null && <span className="personal-scene-haul"><Fish size={21} /><strong>+{caught}</strong></span>}
      </div>
    </div>
  );
}

function FishingView({ game, player, act }: { game: GameState; player: Player; act: (event: string, payload: object) => Promise<ActionResult<any>> }) {
  const [scannerOpen, setScannerOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [fishingStationId, setFishingStationId] = useState<string | null>(null);
  const [catchBurst, setCatchBurst] = useState<{ id: number; caught: number; stationId: string } | null>(null);
  const [researchBurst, setResearchBurst] = useState<{ id: number; population: number; stationId: string } | null>(null);
  const isRunning = game.status === "running";
  const countdown = useCountdownSeconds(game.countdownEndsAt);
  const fishingOpen = isRunning && countdown === 0;
  const researchAvailable = game.status !== "ended" && !isRunning && game.settings.initialResearchEnabled;
  const researchCost = Math.max(0, Math.round(game.settings.researchCost));
  const groupFull = game.players.length >= game.settings.expectedPlayerCount;
  const researchSetupReady = game.status !== "setup" || !game.settings.scaleResourcesToPlayers || groupFull;
  const usesQrStations = game.settings.stationSelectionMode === "qr";
  const stations = game.stations.filter((station) => station.villageId === player.villageId);
  const singleStation = stations.length === 1;
  const boat = game.boats.find((item) => item.id === player.boatId) ?? game.boats[0];
  const hasFishingFuel = game.settings.seasonLimitMode === "time" || player.fuel >= boat.fuelCost;
  const seasonContext = game.status === "setup"
    ? `Before ${participantSeasonLabel(game, 1)}`
    : game.status === "paused" && game.seasonHasRun
      ? `Before ${participantSeasonLabel(game, game.season + 1)}`
      : participantSeasonLabel(game, game.season);

  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(() => setMessage(""), 3200);
    return () => window.clearTimeout(timeout);
  }, [message]);

  useEffect(() => {
    if (!catchBurst) return;
    const burstId = catchBurst.id;
    const timeout = window.setTimeout(() => {
      setCatchBurst((current) => current?.id === burstId ? null : current);
    }, 1250);
    return () => window.clearTimeout(timeout);
  }, [catchBurst]);

  const fishAt = useCallback(async (stationId: string) => {
    setBusy(true);
    setFishingStationId(stationId);
    const result = await act("player:fish", { stationId });
    setBusy(false);
    setFishingStationId(null);
    setScannerOpen(false);
    const caught = result.data?.caught ?? 0;
    setMessage(result.ok ? `Caught ${caught} fish` : result.error ?? "Fishing failed.");
    if (result.ok) setCatchBurst({ id: Date.now(), caught, stationId });
  }, [act]);

  const onScan = useCallback((value: string) => {
    try {
      const url = new URL(value);
      const stationId = url.searchParams.get("station");
      if (stationId && url.pathname.includes(`/play/${game.code}`)) return void fishAt(stationId);
    } catch {
      // The message below handles malformed or unrelated codes.
    }
    setScannerOpen(false);
    setMessage("That QR code is not a station in this game.");
  }, [fishAt, game.code]);

  const research = async (stationId: string) => {
    setBusy(true);
    setFishingStationId(stationId);
    const [result] = await Promise.all([
      act("player:research", { stationId }),
      new Promise((resolve) => window.setTimeout(resolve, 360)),
    ]);
    setBusy(false);
    setFishingStationId(null);
    setMessage(result.ok ? `Research found ${result.data?.population} fish${researchCost > 0 ? ` · ${researchCost} fish paid` : " · free"}` : result.error ?? "Research failed.");
    if (result.ok) setResearchBurst({ id: Date.now(), population: result.data?.population ?? 0, stationId });
  };

  return (
    <section className="player-section fishing-view">
      <header className="player-section-header">
        <div><p className="eyebrow">{seasonContext}</p><h1>{isRunning ? countdown > 0 ? "Get ready" : usesQrStations ? singleStation ? `Scan to fish at ${stations[0]?.name}` : "Scan a station to fish" : singleStation ? `Fish at ${stations[0]?.name}` : "Choose where to fish" : game.settings.feedbackMode === "exact" ? singleStation ? stations[0]?.name : "Station populations" : researchAvailable ? singleStation ? `Research ${stations[0]?.name}` : "Research a station" : preparingLabel(game)}</h1></div>
        {fishingOpen && usesQrStations && <button className="icon-button primary scan-button" onClick={() => setScannerOpen(true)} title={hasFishingFuel ? "Scan station QR code" : "Not enough fuel for another trip"} disabled={!hasFishingFuel}><QrCode size={21} /></button>}
      </header>
      {isRunning && (
        <PersonalFishingScene
          boatId={player.boatId}
          fishing={fishingStationId !== null}
          caught={catchBurst?.caught ?? null}
          stationName={stations.find((station) => station.id === fishingStationId)?.name}
        />
      )}
      {message && <button className="action-message" onClick={() => setMessage("")}>{message}</button>}
      {researchAvailable && game.settings.feedbackMode !== "exact" && (
        <div className="research-rule">
          <FlaskConical size={19} />
          <div>
            <strong>One reading per station</strong>
            <span>{!researchSetupReady ? `Research opens when all ${game.settings.expectedPlayerCount} fishers have joined.` : game.status === "setup" ? "Reveals the starting stock. The reading clears when fishing begins." : "Reveals the stock left by the last season, before replenishment."}</span>
          </div>
          <b>{researchCost === 0 ? "Free" : `${researchCost} fish each`}</b>
        </div>
      )}
      <div className="player-station-list">
        {stations.map((station, index) => {
          const observation = player.knownStations[station.id];
          const exactFeedback = game.settings.feedbackMode === "exact";
          const qualitativeFeedback = game.settings.feedbackMode === "qualitative";
          const canSee = exactFeedback || observation;
          const stockRatio = station.carryingCapacity ? station.population / station.carryingCapacity : 0;
          const condition = stockRatio > 0.65 ? "Healthy fishery" : stockRatio > 0.3 ? "Strained fishery" : "Critical fishery";
          return (
            <article className={`player-station station-color-${index % 4} ${fishingStationId === station.id ? "station-fishing" : ""} ${catchBurst?.stationId === station.id ? "station-caught" : ""} ${researchBurst?.stationId === station.id ? "station-researched" : ""}`} key={station.id}>
              <div className="station-symbol"><Fish size={25} /></div>
              <div className="station-copy">
                <strong>{station.name}</strong>
                <span>{canSee ? `${observation?.population ?? station.population} fish observed` : qualitativeFeedback ? condition : "Population unknown"}</span>
              </div>
              {!exactFeedback && researchAvailable && (
                <button
                  className="research-button"
                  title={!researchSetupReady ? "Research opens when all fishers have joined" : player.balance < researchCost ? `You need ${researchCost} fish` : "Reveal the current fish count before replenishment"}
                  onClick={() => research(station.id)}
                  disabled={busy || isRunning || Boolean(observation) || !researchSetupReady || player.balance < researchCost}
                >
                  <FlaskConical size={16} />{observation ? "Known" : !researchSetupReady ? "Waiting" : researchCost > 0 ? `Research · ${researchCost}` : "Research"}
                </button>
              )}
              {fishingOpen && !usesQrStations && (
                <button className="fish-button" onClick={() => fishAt(station.id)} disabled={busy || station.population <= 0 || !player.active || !hasFishingFuel}>
                  {fishingStationId === station.id ? <><Sailboat className="casting-boat" size={16} /> Fishing</> : <><Fish size={15} /> Fish</>}
                </button>
              )}
              {researchBurst?.stationId === station.id && <span className="research-result" key={researchBurst.id} onAnimationEnd={() => setResearchBurst(null)}><FlaskConical size={15} />{researchBurst.population} fish</span>}
            </article>
          );
        })}
      </div>
      {fishingOpen && usesQrStations && <p className="scan-prompt">{hasFishingFuel ? <><QrCode size={18} /> Scan a station code in the room to fish.</> : <><Fuel size={18} /> No fuel remains for another trip.</>}</p>}
      {scannerOpen && <QrScanner onScan={onScan} onClose={() => setScannerOpen(false)} />}
    </section>
  );
}

function FleetView({ game, player, act }: { game: GameState; player: Player; act: (event: string, payload: object) => Promise<ActionResult<any>> }) {
  const [message, setMessage] = useState("");
  const currentBoatIndex = game.boats.findIndex((boat) => boat.id === player.boatId);
  return (
    <section className="player-section">
      <header className="player-section-header"><div><h1>Boats</h1></div><ShoppingBasket size={22} /></header>
      <div className="boat-list">
        {game.boats.map((boat, boatIndex) => {
          const owned = boat.id === player.boatId;
          const previous = boatIndex < currentBoatIndex;
          return (
            <article className={owned ? "boat-option owned" : "boat-option"} key={boat.id}>
              <Sailboat size={27} />
              <div><strong>{boat.name}</strong><span>{boat.description}</span><small>Catches {boat.catchSize} fish per trip{game.settings.seasonLimitMode === "fuel" ? ` · uses ${boat.fuelCost} fuel` : ""}</small></div>
              <button
                className={owned ? "owned-button" : "secondary-button"}
                disabled={owned || previous || game.status === "running" || game.status === "ended" || player.balance < boat.cost}
                onClick={async () => {
                  const result = await act("player:purchase", { boatId: boat.id });
                  setMessage(result.ok ? `${boat.name} equipped` : result.error ?? "Purchase failed.");
                }}
              >
                {owned ? "Equipped" : previous ? "Previous" : `${boat.cost} fish`}
              </button>
            </article>
          );
        })}
      </div>
      {message && <p className="inline-note">{message}</p>}
    </section>
  );
}

function TradeView({ game, player, act }: { game: GameState; player: Player; act: (event: string, payload: object) => Promise<ActionResult<any>> }) {
  const others = game.players.filter((item) => item.id !== player.id && item.villageId === player.villageId);
  const [recipientId, setRecipientId] = useState(others[0]?.id ?? "");
  const [amount, setAmount] = useState("5");
  const [message, setMessage] = useState("");
  const [transfer, setTransfer] = useState<{ id: number; amount: number; recipient: string } | null>(null);

  return (
    <section className="player-section">
      <header className="player-section-header"><div><h1>Give fish</h1></div><Users size={22} /></header>
      {!game.settings.tradingEnabled ? <p className="empty-state">Trading is disabled for this game.</p> : game.status === "running" ? <p className="empty-state">Trading resumes between seasons.</p> : game.status === "ended" ? <p className="empty-state">The game has ended.</p> : others.length === 0 ? <p className="empty-state">Another fisher must join before you can trade.</p> : (
        <form className="trade-form" onSubmit={async (event) => {
          event.preventDefault();
          const numericAmount = Number(amount);
          if (!Number.isFinite(numericAmount) || numericAmount < 1) {
            setMessage("Enter a whole number of fish to give.");
            return;
          }
          const result = await act("player:trade", { recipientId, amount: numericAmount });
          const recipient = others.find((item) => item.id === recipientId);
          setMessage(result.ok ? `Sent ${numericAmount} fish to ${recipient?.name ?? "another fisher"}` : result.error ?? "Transfer failed.");
          if (result.ok) setTransfer({ id: Date.now(), amount: numericAmount, recipient: recipient?.name ?? "fisher" });
        }}>
          <label className="field"><span>Recipient</span><select value={recipientId} onChange={(event) => setRecipientId(event.target.value)}>{others.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className="field"><span>Amount</span><input type="number" min="1" max={Math.max(1, player.balance)} value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
          <button className="primary-button"><Send size={17} /> Send fish</button>
        </form>
      )}
      {transfer && <div className="trade-transfer" key={transfer.id} onAnimationEnd={() => setTransfer(null)}><span><Fish size={16} />{transfer.amount}</span><ArrowRight size={17} /><strong>{transfer.recipient}</strong></div>}
      {message && <p className="inline-note">{message}</p>}
    </section>
  );
}

function FinalResults({ game, villageId }: { game: GameState; villageId: string }) {
  const stats = villageStats(game, villageId);
  const village = stats.village;
  const totalExtracted = stats.stations.reduce((sum, station) => sum + station.totalCaught, 0);
  const sustained = stats.players.filter((player) => player.balance >= 0).length;
  return (
    <section className="player-section final-results">
      <div className="group-result-hero">
        <span>{village?.name} result</span>
        <strong className="group-result-status">{fisheryResultLabel(game, village?.collapsedAtSeason ?? null)}</strong>
        <div className="extraction-total"><strong>{totalExtracted}</strong><small>fish extracted</small></div>
      </div>
      <div className="player-results result-summary-grid result-summary-grid-one">
        <span><small>People sustained</small><strong>{sustained} / {stats.players.length}</strong></span>
      </div>
      <div className="table-wrap result-table"><table><thead><tr><th>Fisher</th><th>Caught</th><th>Purchases</th><th>Balance</th><th>Outcome</th></tr></thead><tbody>
        {[...stats.players].sort((left, right) => right.balance - left.balance).map((resultPlayer) => (
          <tr key={resultPlayer.id}><td data-label="Fisher"><strong>{resultPlayer.name}</strong></td><td data-label="Caught">{resultPlayer.totalCaught}</td><td data-label="Purchases">{resultPlayer.boatSpending}</td><td data-label="Balance">{resultPlayer.balance}</td><td data-label="Outcome"><span className={`table-status ${resultPlayer.balance >= 0 ? "active" : "inactive"}`}>{resultPlayer.balance >= 0 ? "sustained" : "food shortfall"}</span></td></tr>
        ))}
      </tbody></table></div>
    </section>
  );
}

function PlayerGame({ game, player }: { game: GameState; player: Player }) {
  const [tab, setTab] = useState<"fish" | "fleet" | "trade">("fish");
  const [searchParams, setSearchParams] = useSearchParams();
  const handledStation = useRef<string | null>(null);
  const village = game.villages.find((item) => item.id === player.villageId);
  const stats = villageStats(game, player.villageId);
  const latestIncomingTrade = game.events.find((item) => item.type === "trade" && item.recipientId === player.id);
  const lastTradeId = useRef(latestIncomingTrade?.id);
  const [personalNotice, setPersonalNotice] = useState("");
  const { standings, groups } = useLeaderboard(game.settings.workshopName);
  const privateVillageFish = stats.players.reduce((sum, item) => sum + item.balance, 0);
  const villageExtracted = stats.stations.reduce((sum, station) => sum + station.totalCaught, 0);
  const currentRound = game.rounds[game.roundIndex];
  const act = useCallback(async (event: string, payload: object) => {
    return emitWithAck<ActionResult<any>>(event, { code: game.code, playerId: player.id, ...payload });
  }, [game.code, player.id]);

  useEffect(() => {
    const stationId = searchParams.get("station");
    if (!stationId || handledStation.current === stationId || game.status !== "running") return;
    handledStation.current = stationId;
    void act("player:fish", { stationId }).then((result) => {
      setPersonalNotice(result.ok ? `Caught ${result.data?.caught ?? 0} fish` : result.error ?? "Fishing failed.");
    }).finally(() => setSearchParams({}, { replace: true }));
  }, [act, game.status, searchParams, setSearchParams]);

  useEffect(() => {
    if (!latestIncomingTrade || latestIncomingTrade.id === lastTradeId.current) return;
    lastTradeId.current = latestIncomingTrade.id;
    setPersonalNotice(latestIncomingTrade.message);
  }, [latestIncomingTrade]);

  return (
    <main className="player-shell">
      <CountdownOverlay endsAt={game.countdownEndsAt} />
      <header className="player-header"><Brand compact /><div><span>{player.name}</span><strong>{village?.name} · {game.code}</strong></div></header>
      <PlayerStatus game={game} player={player} />
      <div className={`player-game-state player-game-state-${game.status}`}>
        <i />
        <span>{currentRound?.name ? `${currentRound.name} · ` : ""}{game.status === "running" ? `${participantSeasonLabel(game, game.season)} is running` : game.status === "ended" ? "The game has ended" : game.status === "setup" ? `Waiting for ${participantSeasonLabel(game, 1)}` : `${participantSeasonLabel(game, game.season)} is complete`}</span>
      </div>
      <PlayerRoster game={game} />
      <PlayerSeasonLimit game={game} player={player} />
      <PlayerReadyControl game={game} player={player} act={act} />
      {personalNotice && <button className="personal-notice" onClick={() => setPersonalNotice("")}><Send size={16} />{personalNotice}</button>}
      {game.status === "paused" && !game.seasonHasRun && <div className="transition-summary"><strong>{participantSeasonLabel(game, game.season)} prepared</strong><span>{game.settings.seasonLimitMode === "time" ? "Fishing begins when the facilitator starts the timer." : `Fuel restored to ${game.settings.seasonFuel} units.`}</span></div>}
      {stats.collapsed && <div className="village-collapse-notice"><strong>No fish remain. {village?.name}'s fishery has collapsed.</strong><span>Without fish, nothing can reproduce. {game.settings.showSeasonCountToPlayers ? <>{game.settings.maxSeasons - (village?.collapsedAtSeason ?? game.season)} remaining seasons × {game.settings.maintenanceCost} food to survive = </> : <>Food for every unplayed season = </>}<b>{village?.futureFoodCostPerPlayer} fish deducted from every fisher.</b></span></div>}
      {player.balance < 0 && !stats.collapsed && game.status !== "ended" && <div className="debt-warning">Your balance is below zero. You can keep fishing and recover before the final result.</div>}
      {stats.collapsed && game.status !== "ended" ? (
        <section className="player-section waiting-section collapse-spectator"><Fish size={42} /><h1>Your village is now spectating</h1><p>The other village can continue until it also collapses or the final season ends.</p><div className="player-results"><span><small>Private fish</small><strong>{privateVillageFish}</strong></span><span><small>Fish extracted</small><strong>{villageExtracted}</strong></span></div></section>
      ) : <>
      <nav className="player-tabs">
        <button aria-pressed={tab === "fish"} onClick={() => setTab("fish")}><Fish size={18} /> Fish</button>
        <button aria-pressed={tab === "fleet"} onClick={() => setTab("fleet")}><Sailboat size={18} /> Fleet</button>
        <button aria-pressed={tab === "trade"} onClick={() => setTab("trade")}><Send size={18} /> Share</button>
      </nav>
      {tab === "fish" && (game.status === "ended" ? (
        <><FinalResults game={game} villageId={player.villageId} />{game.settings.workshopName && currentRound?.scored !== false && <WorkshopLeaderboard standings={standings} groups={groups} currentCode={game.code} />}</>
      ) : <FishingView game={game} player={player} act={act} />)}
      {tab === "fleet" && <FleetView game={game} player={player} act={act} />}
      {tab === "trade" && <TradeView game={game} player={player} act={act} />}
      </>}
    </main>
  );
}

function preparingLabel(game: GameState) {
  return game.status === "setup" ? `Waiting for ${participantSeasonLabel(game, 1)}` : "Waiting for the next season";
}

function participantSeasonLabel(game: GameState, season: number) {
  return formatParticipantSeason(
    season,
    game.settings.maxSeasons,
    game.settings.showSeasonCountToPlayers,
  );
}

export function PlayerPage() {
  const { code: routeCode } = useParams();
  const code = routeCode?.toUpperCase();
  const { game, error, loading } = useGame(code);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setSessionLoading(true);
    void getBrowserSession(controller.signal)
      .then((session) => {
        const playerSession = session.player;
        setPlayerId(playerSession && playerSession.code === code ? playerSession.playerId : null);
        setSessionLoading(false);
      })
      .catch((requestError) => {
        if ((requestError as Error).name !== "AbortError") {
          setPlayerId(null);
          setSessionLoading(false);
        }
      });
    return () => controller.abort();
  }, [code]);

  if (!code) return <ErrorScreen message="Enter a game code from the home screen." />;
  if (loading || sessionLoading) return <Loading />;
  if (error || !game) return <ErrorScreen message={error || "Game not found."} />;
  const player = game.players.find((item) => item.id === playerId);
  if (!player) return <PlayerJoin code={code} game={game} />;
  return <PlayerGame game={game} player={player} />;
}
