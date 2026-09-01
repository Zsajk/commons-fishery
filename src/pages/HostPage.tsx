import {
  Activity,
  ArrowDown,
  ArrowUp,
  BarChart3,
  CircleStop,
  Clock3,
  ExternalLink,
  Fish,
  Fuel,
  Gauge,
  LayoutList,
  LockKeyhole,
  Pause,
  Play,
  Plus,
  QrCode as QrCodeIcon,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  defaultSettings,
  defaultStations,
  finitePoolPreset,
  hardCommonsPreset,
  impossibleCommonsPreset,
  renewableCommonsPreset,
  type ActionResult,
  type GameSettings,
  type GameState,
  type HostGameSummary,
  type StationSeed,
  type WorkshopRound,
} from "../../shared/game";
import { FishTank } from "../components/FishTank";
import { Brand } from "../components/Brand";
import { CountdownOverlay, useCountdownSeconds } from "../components/CountdownOverlay";
import { GameHeader } from "../components/GameHeader";
import { GrowthPreview } from "../components/GrowthPreview";
import { HistoryChart } from "../components/HistoryChart";
import { ErrorScreen, Loading } from "../components/Loading";
import { QrCode } from "../components/QrCode";
import { growthLabel, totalFish, villageCompetitionResult, villageStats } from "../gameMath";
import { fisheryResultLabel } from "../resultLabel";
import { getBrowserSession, loginFacilitator } from "../api";
import { emitWithAck, socket } from "../socket";
import { useGame } from "../useGame";
import { formatSeasonTime, useSeasonSeconds } from "../useSeasonClock";

type HostTab = "live" | "rules" | "people" | "stations";

function FacilitatorAccess({ children }: { children: React.ReactNode }) {
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void getBrowserSession(controller.signal)
      .then((session) => setAuthorized(session.facilitator))
      .catch((requestError) => {
        if ((requestError as Error).name !== "AbortError") setAuthorized(false);
      });
    return () => controller.abort();
  }, []);

  if (authorized === null) return <Loading message="Checking facilitator access" />;
  if (authorized) return children;

  const login = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    const result = await loginFacilitator(pin).catch(() => ({
      ok: false,
      error: "Unable to reach the server.",
    }));
    setSubmitting(false);
    if (!result.ok) return setError(result.error ?? "Unable to unlock facilitator access.");
    window.location.reload();
  };

  return (
    <main className="access-shell">
      <Brand />
      <form className="access-form" onSubmit={login}>
        <span className="access-icon"><LockKeyhole size={25} /></span>
        <div><p className="eyebrow">Facilitator access</p><h1>Enter your PIN</h1></div>
        <p>Participants do not need this PIN.</p>
        <label className="field">
          <span>Facilitator PIN</span>
          <input
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            value={pin}
            onChange={(event) => setPin(event.target.value)}
            autoFocus
            required
          />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-button" disabled={submitting}>
          {submitting ? "Checking…" : "Continue"}
        </button>
      </form>
    </main>
  );
}

function randomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const suffix = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
  return `CF${suffix}`;
}

const hostTemplateKey = "common-waters-host-template";

type SetupPreset = "easy" | "hard" | "impossible" | "finite" | "custom";
type DraftRound = WorkshopRound & { preset: SetupPreset };

type HostTemplate = {
  settings?: Partial<GameSettings>;
  stations?: StationSeed[];
  rounds?: DraftRound[];
  groupCount?: number;
  groupPrefix?: string;
};

function settingsForPreset(preset: Exclude<SetupPreset, "custom">): Partial<GameSettings> {
  return preset === "easy"
    ? renewableCommonsPreset
    : preset === "hard"
      ? hardCommonsPreset
      : preset === "impossible"
        ? impossibleCommonsPreset
        : finitePoolPreset;
}

function presetMatchesSettings(preset: Exclude<SetupPreset, "custom">, settings: GameSettings) {
  const values = settingsForPreset(preset);
  return (Object.keys(values) as Array<keyof GameSettings>)
    .every((key) => Object.is(settings[key], values[key]));
}

function loadHostTemplate(): HostTemplate {
  try {
    const template = JSON.parse(window.localStorage.getItem(hostTemplateKey) ?? "{}") as HostTemplate;
    template.settings = { ...defaultSettings, ...template.settings };
    if (template.rounds) {
      template.rounds = template.rounds.map((round) => {
        const settings = { ...defaultSettings, ...template.settings, ...round.settings };
        const savedPreset = round.preset;
        const preset = savedPreset && savedPreset !== "custom" && presetMatchesSettings(savedPreset, settings)
          ? savedPreset
          : "custom";
        return { ...round, settings, preset };
      });
    }
    return template;
  } catch {
    return {};
  }
}

function newRound(
  name: string,
  preset: Exclude<SetupPreset, "custom">,
  base: Partial<GameSettings> = {},
  stations: StationSeed[] = defaultStations,
): DraftRound {
  const presetSettings = settingsForPreset(preset);
  return {
    id: `round-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    scored: true,
    preset,
    settings: { ...defaultSettings, ...base, ...presetSettings },
    stations: structuredClone(stations),
  };
}

function defaultRoundPlan(base: Partial<GameSettings>, stations: StationSeed[]): DraftRound[] {
  const practice = newRound("Practice", "easy", base, stations);
  practice.scored = false;
  practice.settings.maxSeasons = 2;
  practice.preset = "custom";
  const firstRound = newRound("Round 1", "easy", base, stations);
  return [
    practice,
    firstRound,
    newRound("Round 2", "easy", base, stations),
    newRound("Round 3", "hard", base, stations),
  ];
}

function NumberField({
  label,
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    const parsed = Number(draft);
    if (!draft.trim() || !Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const bounded = Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min, parsed));
    setDraft(String(bounded));
    if (bounded !== value) onChange(bounded);
  };

  return (
    <label className="field">
      <span>{label}</span>
      <span className="number-input">
        <input
          type="number"
          value={draft}
          min={min}
          max={max}
          step={step}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
              event.currentTarget.blur();
            }
          }}
        />
        {suffix && <em>{suffix}</em>}
      </span>
    </label>
  );
}

type FishSupplyVillage = {
  name: string;
  fishers: number | null;
  fixedStarting: number;
  fixedCapacity: number;
};

function FishSupplyControl({
  settings,
  villages,
  onChange,
  timingNote,
}: {
  settings: GameSettings;
  villages: FishSupplyVillage[];
  onChange: (settings: GameSettings) => void;
  timingNote: string;
}) {
  const scaled = settings.scaleResourcesToPlayers;

  return (
    <div className="fish-supply-control">
      <div className="fish-supply-heading">
        <div>
          <strong>Fish supply at Season 1</strong>
          <span>{scaled ? "Each village receives fish according to its own number of fishers." : "Each village uses the starting fish and capacity entered for its stations."}</span>
        </div>
        <div className="segmented-control" aria-label="Fish supply calculation">
          <button type="button" aria-pressed={!scaled} onClick={() => onChange({ ...settings, scaleResourcesToPlayers: false })}>Fixed amounts</button>
          <button type="button" aria-pressed={scaled} onClick={() => onChange({ ...settings, scaleResourcesToPlayers: true })}>Per fisher</button>
        </div>
      </div>

      {scaled && (
        <div className="fish-supply-fields">
          <NumberField
            label="Maximum fish per fisher"
            value={settings.capacityPerPlayer}
            suffix="fish"
            min={10}
            onChange={(value) => onChange({ ...settings, capacityPerPlayer: value })}
          />
          <NumberField
            label="How full at the start"
            value={Math.round(settings.startingStockRatio * 100)}
            suffix="%"
            min={10}
            max={100}
            onChange={(value) => onChange({ ...settings, startingStockRatio: value / 100 })}
          />
        </div>
      )}

      <div className="fish-supply-preview" aria-live="polite">
        {villages.map((village) => {
          const fishers = Math.max(1, village.fishers ?? 1);
          const capacity = scaled ? fishers * settings.capacityPerPlayer : village.fixedCapacity;
          const starting = scaled ? Math.round(capacity * settings.startingStockRatio) : village.fixedStarting;
          return (
            <div className="fish-supply-preview-row" key={village.name}>
              <div>
                <strong>{village.name}</strong>
                <small>{scaled
                  ? `${fishers} ${fishers === 1 ? "fisher" : "fishers"} × ${settings.capacityPerPlayer} fish`
                  : "Total of the station values above"}</small>
              </div>
              <div className="fish-supply-numbers">
                <span><Fish size={15} /><strong>{starting}</strong> at start</span>
                <span><Gauge size={15} /><strong>{capacity}</strong> maximum</span>
              </div>
            </div>
          );
        })}
      </div>

      <p className="fish-supply-note"><strong>{timingNote}</strong> Replenishment is separate: it changes the population between seasons, up to the maximum shown here.</p>
    </div>
  );
}

function relativeTime(timestamp: number) {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function HostGameRow({
  game,
  busy,
  open,
  end,
  remove,
}: {
  game: HostGameSummary;
  busy: boolean;
  open: () => void;
  end: () => void;
  remove: () => void;
}) {
  const seconds = useSeasonSeconds(
    game.seasonStartedAt,
    game.seasonDurationSeconds,
    game.status === "running" && game.seasonLimitMode === "time",
  );
  const statusLabel = game.status === "paused" ? "between seasons" : game.status === "ended" ? "finished" : game.status;
  const canRemove = game.status === "setup" || game.status === "ended";
  return (
    <article className="host-game-row">
      <div className="host-game-name"><strong>{game.title}</strong><span>{game.code}{game.workshopName ? ` · ${game.workshopName}` : ""}</span></div>
      <span className={`host-game-status status-${game.status}`}><i />{statusLabel}</span>
      <div className="host-game-metric"><span>Season</span><strong>{game.season} / {game.maxSeasons}</strong></div>
      <div className="host-game-metric"><span>Players</span><strong>{game.playerCount} / {game.expectedPlayerCount}</strong></div>
      <div className="host-game-metric"><span>{game.status === "running" ? game.seasonLimitMode === "time" ? "Time left" : "Season limit" : "Last activity"}</span><strong>{game.status === "running" ? game.seasonLimitMode === "time" ? formatSeasonTime(seconds) : `${game.seasonFuel} fuel` : relativeTime(game.lastActivityAt)}</strong></div>
      <div className="host-game-actions">
        <button className="secondary-button" onClick={open}><ExternalLink size={16} /> Open</button>
        <button className="icon-button" title={`End ${game.code}`} aria-label={`End ${game.code}`} onClick={end} disabled={busy || game.status === "ended"}><CircleStop size={17} /></button>
        <button className="icon-button danger" title={canRemove ? `Remove ${game.code}` : "End this game before removing it"} aria-label={`Remove ${game.code}`} onClick={remove} disabled={busy || !canRemove}><Trash2 size={17} /></button>
      </div>
    </article>
  );
}

function HostGameIndex({
  games,
  loading,
  error,
  refresh,
  createNew,
  open,
  end,
  remove,
  busyCode,
  workshopCommand,
  busyWorkshop,
}: {
  games: HostGameSummary[];
  loading: boolean;
  error: string;
  refresh: () => void;
  createNew: () => void;
  open: (code: string) => void;
  end: (game: HostGameSummary) => void;
  remove: (game: HostGameSummary) => void;
  busyCode: string;
  workshopCommand: (workshop: string, command: "start" | "next-round") => void;
  busyWorkshop: string;
}) {
  const [query, setQuery] = useState("");
  const filtered = games.filter((game) => `${game.title} ${game.code} ${game.workshopName}`.toLowerCase().includes(query.trim().toLowerCase()));
  const active = filtered.filter((game) => game.status !== "ended");
  const finished = filtered.filter((game) => game.status === "ended");
  const workshops = [...new Set(games.map((game) => game.workshopName).filter(Boolean))];

  const group = (title: string, items: HostGameSummary[]) => items.length > 0 && (
    <section className="host-game-group">
      <header><h2>{title}</h2><span>{items.length}</span></header>
      <div className="host-game-list">
        {items.map((game) => <HostGameRow game={game} busy={busyCode === game.code} open={() => open(game.code)} end={() => end(game)} remove={() => remove(game)} key={game.code} />)}
      </div>
    </section>
  );

  return (
    <main className="setup-shell">
      <header className="setup-header host-index-header">
        <a className="back-link" href="/">Commons Fishery</a>
        <div><p className="eyebrow">Facilitator console</p><h1>Your games</h1></div>
        <button className="primary-button host-header-action" onClick={createNew}><Plus size={17} /> New game</button>
      </header>
      <div className="host-game-index">
        <div className="host-game-toolbar">
          <label className="host-game-search"><Search size={17} /><input aria-label="Search games" placeholder="Search name or code" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <button className="icon-button" title="Refresh games" aria-label="Refresh games" onClick={refresh} disabled={loading}><RefreshCw size={17} /></button>
        </div>
        {workshops.length > 0 && <div className="workshop-control-list">{workshops.map((workshop) => {
          const workshopGames = games.filter((game) => game.workshopName === workshop);
          const waiting = workshopGames.filter((game) => game.status === "setup");
          const allReady = waiting.length > 0 && waiting.every((game) => game.playerCount >= game.expectedPlayerCount && game.readyCount >= game.expectedPlayerCount);
          const canPrepareRound = workshopGames.length > 0 && workshopGames.every((game) => game.status === "ended" && game.roundIndex + 1 < game.totalRounds);
          const joined = workshopGames.reduce((sum, game) => sum + game.playerCount, 0);
          const expected = workshopGames.reduce((sum, game) => sum + game.expectedPlayerCount, 0);
          const ready = workshopGames.reduce((sum, game) => sum + game.readyCount, 0);
          return (
            <section className="workshop-control" key={workshop}>
              <div><strong>{workshop}</strong><span>{workshopGames.length} {workshopGames.length === 1 ? "group" : "groups"} · {joined}/{expected} joined · {ready} ready</span></div>
              <div>
                <a className="secondary-button" href={`/workshop/${encodeURIComponent(workshop)}`} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Lobby</a>
                <a className="secondary-button" href={`/leaderboard/${encodeURIComponent(workshop)}`} target="_blank" rel="noreferrer"><BarChart3 size={16} /> Ranking</a>
                {canPrepareRound ? <button className="primary-button" onClick={() => workshopCommand(workshop, "next-round")} disabled={busyWorkshop === workshop}><Play size={16} /> Prepare next round</button> : <button className="primary-button" onClick={() => workshopCommand(workshop, "start")} disabled={!allReady || busyWorkshop === workshop}><Play size={16} /> Start all groups</button>}
              </div>
            </section>
          );
        })}</div>}
        {error && <p className="form-error" role="alert">{error}</p>}
        {loading && games.length === 0 ? <p className="empty-state">Loading games…</p> : filtered.length === 0 ? (
          <div className="host-games-empty"><strong>{query ? "No matching games" : "No games yet"}</strong><span>{query ? "Try another name or room code." : "Create a room to begin a session."}</span>{!query && <button className="primary-button" onClick={createNew}><Plus size={17} /> New game</button>}</div>
        ) : <>{group("Active games", active)}{group("Finished games", finished)}</>}
      </div>
    </main>
  );
}

function HostSetup() {
  const navigate = useNavigate();
  const template = useMemo(loadHostTemplate, []);
  const [code, setCode] = useState(randomCode);
  const [title, setTitle] = useState("Group 1");
  const baseSettings = useMemo<GameSettings>(() => ({
    ...defaultSettings,
    ...renewableCommonsPreset,
    workshopName: "Commons Session",
    ...template.settings,
  }), [template.settings]);
  const [groupCount, setGroupCount] = useState(template.groupCount ?? 6);
  const [groupPrefix, setGroupPrefix] = useState(template.groupPrefix ?? "Group");
  const [workshopName, setWorkshopName] = useState(baseSettings.workshopName);
  const [expectedPlayerCount, setExpectedPlayerCount] = useState(baseSettings.expectedPlayerCount);
  const [villageCount, setVillageCount] = useState<1 | 2>(baseSettings.villageCount);
  const [rounds, setRounds] = useState<DraftRound[]>(() => template.rounds?.length
    ? template.rounds
    : defaultRoundPlan(baseSettings, template.stations ?? defaultStations));
  const [activeRoundIndex, setActiveRoundIndex] = useState(0);
  const [error, setError] = useState("");
  const [createdMessage, setCreatedMessage] = useState("");
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [games, setGames] = useState<HostGameSummary[]>([]);
  const [gamesLoading, setGamesLoading] = useState(true);
  const [gamesError, setGamesError] = useState("");
  const [busyCode, setBusyCode] = useState("");
  const [busyWorkshop, setBusyWorkshop] = useState("");
  const activeRound = rounds[activeRoundIndex] ?? rounds[0];
  const settings: GameSettings = {
    ...activeRound.settings,
    workshopName,
    expectedPlayerCount,
    villageCount,
  };
  const stations = activeRound.stations;
  const preset = activeRound.preset;

  const setSettings: React.Dispatch<React.SetStateAction<GameSettings>> = (next) => {
    const resolved = typeof next === "function" ? next(settings) : next;
    setWorkshopName(resolved.workshopName);
    setExpectedPlayerCount(resolved.expectedPlayerCount);
    setVillageCount(resolved.villageCount);
    setRounds((current) => current.map((round, index) =>
      index === activeRoundIndex ? { ...round, settings: resolved, preset: "custom" } : round));
  };

  const setStations: React.Dispatch<React.SetStateAction<StationSeed[]>> = (next) => {
    setRounds((current) => current.map((round, index) => {
      if (index !== activeRoundIndex) return round;
      const resolved = typeof next === "function" ? next(round.stations) : next;
      return { ...round, stations: resolved };
    }));
  };

  const setPreset = (nextPreset: SetupPreset) => {
    setRounds((current) => current.map((round, index) =>
      index === activeRoundIndex ? { ...round, preset: nextPreset } : round));
  };

  const loadGames = useCallback(async () => {
    setGamesLoading(true);
    const result = await emitWithAck<ActionResult<HostGameSummary[]>>("host:list", {});
    setGamesLoading(false);
    if (!result.ok || !result.data) return setGamesError(result.error ?? "Unable to load games.");
    setGames(result.data);
    setGamesError("");
  }, []);

  useEffect(() => {
    void loadGames();
    const reconnect = () => void loadGames();
    socket.on("connect", reconnect);
    const interval = window.setInterval(() => void loadGames(), 10_000);
    return () => {
      socket.off("connect", reconnect);
      window.clearInterval(interval);
    };
  }, [loadGames]);

  const updateStation = (index: number, changes: Partial<StationSeed>) => {
    setPreset("custom");
    setStations((current) =>
      current.map((station, stationIndex) =>
        stationIndex === index ? { ...station, ...changes } : station,
      ),
    );
  };

  const applyPreset = (nextPreset: Exclude<SetupPreset, "custom">) => {
    const values = settingsForPreset(nextPreset);
    setSettings((current) => ({ ...current, ...values }));
    setPreset(nextPreset);
  };

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    const createAnother = ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value === "another";
    setCreating(true);
    setError("");
    setCreatedMessage("");
    const preparedRounds: WorkshopRound[] = rounds.map((round) => ({
      id: round.id,
      name: round.name,
      scored: round.scored,
      settings: { ...round.settings, workshopName, expectedPlayerCount, villageCount },
      stations: round.stations,
    }));
    const firstRound = preparedRounds[0];
    const result = groupCount === 1
      ? await emitWithAck<ActionResult<GameState>>("host:create", {
        code,
        title,
        settings: firstRound.settings,
        stations: firstRound.stations,
        rounds: preparedRounds,
      })
      : await emitWithAck<ActionResult<GameState[]>>("host:create-workshop", {
        workshopName,
        groupCount,
        groupPrefix,
        code,
        title,
        settings: firstRound.settings,
        stations: firstRound.stations,
        rounds: preparedRounds,
      });
    setCreating(false);
    if (!result.ok || !result.data) return setError(result.error ?? "Unable to create the game.");
    window.localStorage.setItem(hostTemplateKey, JSON.stringify({
      settings: firstRound.settings,
      stations: firstRound.stations,
      rounds,
      groupCount,
      groupPrefix,
    }));
    if (groupCount > 1) {
      setCreatedMessage(`${groupCount} groups created with ${preparedRounds.length} prepared rounds.`);
      setShowCreate(false);
      await loadGames();
      return;
    }
    if (createAnother) {
      const previousTitle = title;
      setTitle((current) => current.replace(/(\d+)$/, (value) => String(Number(value) + 1)));
      setCode(randomCode());
      setCreatedMessage(`${previousTitle} created. The same rules are ready for the next group.`);
      await loadGames();
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    navigate(`/host/${(result.data as GameState).code}`);
  };

  const endListedGame = async (game: HostGameSummary) => {
    if (!window.confirm(`End ${game.title} (${game.code})? Players will no longer be able to fish.`)) return;
    setBusyCode(game.code);
    const result = await emitWithAck<ActionResult>("host:command", { code: game.code, command: "end" });
    setBusyCode("");
    if (!result.ok) return setGamesError(result.error ?? "Unable to end the game.");
    await loadGames();
  };

  const removeListedGame = async (game: HostGameSummary) => {
    if (!window.confirm(`Permanently remove ${game.title} (${game.code})? This cannot be undone.`)) return;
    setBusyCode(game.code);
    const result = await emitWithAck<ActionResult>("host:delete", { code: game.code });
    setBusyCode("");
    if (!result.ok) return setGamesError(result.error ?? "Unable to remove the game.");
    await loadGames();
  };

  const runWorkshopCommand = async (workshop: string, command: "start" | "next-round") => {
    setBusyWorkshop(workshop);
    setGamesError("");
    const result = await emitWithAck<ActionResult>("host:workshop-command", {
      workshopName: workshop,
      command,
    });
    setBusyWorkshop("");
    if (!result.ok) return setGamesError(result.error ?? "Unable to update the session.");
    await loadGames();
  };

  if (!showCreate) {
    return <HostGameIndex games={games} loading={gamesLoading} error={gamesError} refresh={() => void loadGames()} createNew={() => setShowCreate(true)} open={(gameCode) => navigate(`/host/${gameCode}`)} end={(game) => void endListedGame(game)} remove={(game) => void removeListedGame(game)} busyCode={busyCode} workshopCommand={(workshop, command) => void runWorkshopCommand(workshop, command)} busyWorkshop={busyWorkshop} />;
  }

  return (
    <main className="setup-shell">
      <header className="setup-header">
        <a className="back-link" href="/">Commons Fishery</a>
        <div>
          <p className="eyebrow">Facilitator setup</p>
          <h1>Create session games</h1>
        </div>
        <button className="secondary-button host-header-action" onClick={() => setShowCreate(false)}>Your games</button>
      </header>

      <form className="setup-form" onSubmit={create}>
        <section className="setup-band">
          <header>
            <span className="step-number">1</span>
            <div><h2>Session</h2><p>Each group receives a stable code for the full session.</p></div>
          </header>
          <div className="form-grid two-columns">
            <label className="field">
              <span>Session name</span>
              <input value={workshopName} maxLength={50} onChange={(event) => setWorkshopName(event.target.value)} required />
            </label>
            <NumberField label="Number of groups" value={groupCount} min={1} max={30} onChange={setGroupCount} />
            <NumberField label="Fishers per group" value={expectedPlayerCount} min={1} max={50} onChange={setExpectedPlayerCount} />
            {groupCount > 1 ? (
              <label className="field"><span>Group name prefix</span><input value={groupPrefix} maxLength={30} onChange={(event) => setGroupPrefix(event.target.value)} required /></label>
            ) : (
              <>
                <label className="field"><span>Group name</span><input value={title} maxLength={40} onChange={(event) => setTitle(event.target.value)} required /></label>
                <label className="field"><span>Game code</span><input className="code-input" value={code} minLength={6} maxLength={10} onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} required /></label>
              </>
            )}
          </div>
          <div className="setup-choice-row">
            <div><strong>Villages</strong><span>Run one commons or compare two villages side by side.</span></div>
            <div className="segmented-control" aria-label="Number of villages">
              <button type="button" aria-pressed={villageCount === 1} onClick={() => setVillageCount(1)}>One</button>
              <button type="button" aria-pressed={villageCount === 2} onClick={() => setVillageCount(2)}>Two</button>
            </div>
          </div>
        </section>

        <section className="setup-band">
          <header>
            <span className="step-number">2</span>
            <div><h2>Prepared rounds</h2><p>Groups keep the same codes and players; rules reset between rounds.</p></div>
          </header>
          <div className="round-planner-tabs" role="tablist" aria-label="Prepared rounds">
            {rounds.map((round, index) => (
              <button type="button" role="tab" aria-selected={activeRoundIndex === index} onClick={() => setActiveRoundIndex(index)} key={round.id}>
                <span>{index + 1}</span><strong>{round.name}</strong><small>{round.settings.maxSeasons} seasons · {round.scored ? "scored" : "practice"}</small>
              </button>
            ))}
            <button type="button" className="round-add" onClick={() => {
              const copy = structuredClone(activeRound);
              copy.id = `round-${Date.now()}`;
              copy.name = `Round ${rounds.length}`;
              setRounds((current) => [...current, copy]);
              setActiveRoundIndex(rounds.length);
            }}><Plus size={17} /> Add round</button>
          </div>
          <div className="round-editor-bar">
            <label className="field"><span>Round name</span><input value={activeRound.name} maxLength={32} onChange={(event) => setRounds((current) => current.map((round, index) => index === activeRoundIndex ? { ...round, name: event.target.value } : round))} /></label>
            <label className="round-check"><input type="checkbox" checked={activeRound.scored} onChange={(event) => setRounds((current) => current.map((round, index) => index === activeRoundIndex ? { ...round, scored: event.target.checked } : round))} /><span>Include in ranking</span></label>
            <div className="round-order-actions">
              <button type="button" className="icon-button" title="Move round up" disabled={activeRoundIndex === 0} onClick={() => setRounds((current) => { const copy = [...current]; [copy[activeRoundIndex - 1], copy[activeRoundIndex]] = [copy[activeRoundIndex], copy[activeRoundIndex - 1]]; setActiveRoundIndex(activeRoundIndex - 1); return copy; })}><ArrowUp size={16} /></button>
              <button type="button" className="icon-button" title="Move round down" disabled={activeRoundIndex === rounds.length - 1} onClick={() => setRounds((current) => { const copy = [...current]; [copy[activeRoundIndex + 1], copy[activeRoundIndex]] = [copy[activeRoundIndex], copy[activeRoundIndex + 1]]; setActiveRoundIndex(activeRoundIndex + 1); return copy; })}><ArrowDown size={16} /></button>
              <button type="button" className="icon-button danger" title="Remove round" disabled={rounds.length === 1} onClick={() => { setRounds((current) => current.filter((_, index) => index !== activeRoundIndex)); setActiveRoundIndex(Math.max(0, activeRoundIndex - 1)); }}><Trash2 size={16} /></button>
            </div>
          </div>
        </section>

        <section className="setup-band">
          <header>
            <span className="step-number">3</span>
            <div><h2>Fishing stations</h2><p>{settings.scaleResourcesToPlayers ? "The per-fisher total is divided among stations using the share weights below." : "Each station uses its own starting population and capacity."}</p></div>
          </header>
          <div className="station-editor-list">
            {stations.map((station, index) => (
              <div className={`station-editor ${settings.scaleResourcesToPlayers ? "station-editor-scaled" : ""}`} key={index}>
                <label className="field station-name-field">
                  <span>Name</span>
                  <input value={station.name} onChange={(event) => updateStation(index, { name: event.target.value })} required />
                </label>
                {!settings.scaleResourcesToPlayers && <NumberField
                    label="Starting fish"
                    value={station.startingPopulation}
                    min={1}
                    onChange={(value) => updateStation(index, { startingPopulation: value })}
                  />}
                <NumberField
                  label={settings.scaleResourcesToPlayers ? "Share weight" : "Capacity"}
                  value={station.carryingCapacity}
                  min={settings.scaleResourcesToPlayers ? 1 : station.startingPopulation}
                  onChange={(value) => updateStation(index, { carryingCapacity: value })}
                />
                <button
                  className="icon-button danger"
                  type="button"
                  aria-label={`Remove ${station.name}`}
                  title="Remove station"
                  disabled={stations.length === 1}
                  onClick={() => setStations((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                >
                  <Trash2 size={17} />
                </button>
              </div>
            ))}
            <button
              className="text-button"
              type="button"
              onClick={() =>
                setStations((current) => [
                  ...current,
                  { name: `Station ${current.length + 1}`, startingPopulation: 100, carryingCapacity: 200 },
                ])
              }
            >
              <Plus size={16} /> Add station
            </button>
          </div>
        </section>

        <section className="setup-band reproduction-setup">
          <header>
            <span className="step-number">4</span>
            <div><h2>Replenishment</h2><p>Choose exactly how fish return between seasons.</p></div>
          </header>
          <div className="preset-picker" aria-label="Game preset">
            <button type="button" aria-pressed={preset === "easy"} onClick={() => applyPreset("easy")}><strong>Easy</strong><span>r 1.20 · 100 capacity/fisher · 25 sec · 5 seasons</span></button>
            <button type="button" aria-pressed={preset === "hard"} onClick={() => applyPreset("hard")}><strong>Hard</strong><span>r 1.667 · 60 capacity/fisher · 25 sec · 5 seasons</span></button>
            <button type="button" aria-pressed={preset === "impossible"} onClick={() => applyPreset("impossible")}><strong>Very tight</strong><span>r 2.00 · 40 capacity/fisher · 25 sec · 5 seasons</span></button>
            <button type="button" aria-pressed={preset === "finite"} onClick={() => applyPreset("finite")}><strong>Finite pool</strong><span>No replenishment · 50 capacity/fisher · 3 seasons</span></button>
          </div>
          {preset === "custom" && <p className="custom-settings-note"><strong>Custom settings active</strong><span>{growthLabel(settings)} · {settings.scaleResourcesToPlayers ? `${settings.capacityPerPlayer} capacity/fisher` : "fixed station capacity"} · {settings.seasonLimitMode === "time" ? `${settings.seasonDurationSeconds} sec` : `${settings.seasonFuel} fuel`} · {settings.maxSeasons} seasons</span></p>}
          <div className="segmented-control" aria-label="Growth model">
            <button
              type="button"
              aria-pressed={settings.growthModel === "none"}
              onClick={() => { setPreset("custom"); setSettings({ ...settings, growthModel: "none", reproductionRate: 0 }); }}
            >
              None
            </button>
            <button
              type="button"
              aria-pressed={settings.growthModel === "multiplier"}
              onClick={() => { setPreset("custom"); setSettings({ ...settings, growthModel: "multiplier", reproductionRate: 2 }); }}
            >
              Multiplier
            </button>
            <button
              type="button"
              aria-pressed={settings.growthModel === "logistic"}
              onClick={() => { setPreset("custom"); setSettings({ ...settings, growthModel: "logistic", reproductionRate: 1 }); }}
            >
              Density-limited
            </button>
          </div>
          {settings.growthModel !== "none" && <div className="reproduction-control">
            <label>
              <span>{settings.growthModel === "multiplier" ? "Population multiplier" : "Growth rate"}</span>
              <strong>{settings.reproductionRate.toFixed(2)}</strong>
              <input
                type="range"
                min={settings.growthModel === "multiplier" ? 1 : 0}
                max={settings.growthModel === "multiplier" ? 3 : 2.5}
                step="0.05"
                value={settings.reproductionRate}
                onChange={(event) => { setPreset("custom"); setSettings({ ...settings, reproductionRate: Number(event.target.value) }); }}
              />
            </label>
            <div className="formula-preview">
              {settings.growthModel === "multiplier" ? (
                <><span>50 fish</span><strong>× {settings.reproductionRate.toFixed(2)}</strong><span>= {Math.min(200, Math.round(50 * settings.reproductionRate))}</span></>
              ) : (
                <><span>50 fish</span><strong>+ density-limited growth</strong><span>= {Math.round(50 + settings.reproductionRate * 50 * (1 - 50 / 200))}</span></>
              )}
            </div>
          </div>}
        </section>

        <section className="setup-band">
          <header>
            <span className="step-number">5</span>
            <div><h2>Season rules</h2><p>Choose what limits fishing in each season.</p></div>
          </header>
          <div className="setup-choice-row">
            <div><strong>Season limit</strong><span>{settings.seasonLimitMode === "time" ? "Everyone fishes until the shared timer ends." : "Each fisher has personal fuel for a limited number of trips."}</span></div>
            <div className="segmented-control" aria-label="Season limit">
              <button type="button" aria-pressed={settings.seasonLimitMode === "time"} onClick={() => setSettings({ ...settings, seasonLimitMode: "time" })}><Clock3 size={15} /> Timer</button>
              <button type="button" aria-pressed={settings.seasonLimitMode === "fuel"} onClick={() => setSettings({ ...settings, seasonLimitMode: "fuel" })}><Fuel size={15} /> Fuel</button>
            </div>
          </div>
          <div className="form-grid four-columns">
            <NumberField label="Starting balance" value={settings.startingBalance} suffix="fish" onChange={(value) => setSettings({ ...settings, startingBalance: value })} />
            <NumberField label="Food needed per fisher" value={settings.maintenanceCost} suffix="fish / season" onChange={(value) => setSettings({ ...settings, maintenanceCost: value })} />
            {settings.seasonLimitMode === "time" ? (
              <NumberField label="Season duration" value={settings.seasonDurationSeconds} suffix="sec" min={10} max={900} onChange={(value) => setSettings({ ...settings, seasonDurationSeconds: value })} />
            ) : (
              <NumberField label="Fuel per fisher" value={settings.seasonFuel} suffix="units" min={3} max={100} onChange={(value) => setSettings({ ...settings, seasonFuel: value })} />
            )}
            <NumberField label="Maximum seasons" value={settings.maxSeasons} min={2} max={30} onChange={(value) => setSettings({ ...settings, maxSeasons: value })} />
          </div>
          <p className="season-food-note"><strong>Food to survive:</strong> this amount is deducted from every fisher's balance after each season.</p>
          <div className="setup-choice-row">
            <div><strong>Season information for players</strong><span>Show the total and remaining seasons, or reveal only the current season.</span></div>
            <div className="segmented-control" aria-label="Participant season horizon">
              <button type="button" aria-pressed={settings.showSeasonCountToPlayers} onClick={() => setSettings({ ...settings, showSeasonCountToPlayers: true })}>Show remaining</button>
              <button type="button" aria-pressed={!settings.showSeasonCountToPlayers} onClick={() => setSettings({ ...settings, showSeasonCountToPlayers: false })}>Hide remaining</button>
            </div>
          </div>
          <div className="setup-choice-row">
            <div><strong>Collapsed groups</strong><span>Collapsed groups always appear in the results. Choose whether they can still win by extracting the most fish.</span></div>
            <div className="segmented-control" aria-label="Collapsed group winner eligibility">
              <button type="button" aria-pressed={settings.collapsedGroupsCanWin} onClick={() => setSettings({ ...settings, collapsedGroupsCanWin: true })}>Can win</button>
              <button type="button" aria-pressed={!settings.collapsedGroupsCanWin} onClick={() => setSettings({ ...settings, collapsedGroupsCanWin: false })}>Cannot win</button>
            </div>
          </div>
          <FishSupplyControl
            settings={settings}
            villages={[{
              name: "Example: one village with 5 fishers",
              fishers: 5,
              fixedStarting: stations.reduce((sum, station) => sum + station.startingPopulation, 0),
              fixedCapacity: stations.reduce((sum, station) => sum + station.carryingCapacity, 0),
            }]}
            onChange={(nextSettings) => { setPreset("custom"); setSettings(nextSettings); }}
            timingNote="The final amount is calculated separately for each village when Season 1 starts."
          />
          <div className="setup-choice-row">
            <div><strong>Fishing method</strong><span>Players either tap a station or scan its printed QR code.</span></div>
            <div className="segmented-control" aria-label="Fishing method">
              <button type="button" aria-pressed={settings.stationSelectionMode === "buttons"} onClick={() => setSettings({ ...settings, stationSelectionMode: "buttons" })}>Tap station</button>
              <button type="button" aria-pressed={settings.stationSelectionMode === "qr"} onClick={() => setSettings({ ...settings, stationSelectionMode: "qr" })}>Scan QR</button>
            </div>
          </div>
          <div className="setup-choice-row">
            <div><strong>Live fish feedback</strong><span>Choose how much the shared display reveals while people fish.</span></div>
            <div className="segmented-control" aria-label="Live fish feedback">
              <button type="button" aria-pressed={settings.feedbackMode === "hidden"} onClick={() => setSettings({ ...settings, feedbackMode: "hidden", showPopulationToPlayers: false })}>Hidden</button>
              <button type="button" aria-pressed={settings.feedbackMode === "qualitative"} onClick={() => setSettings({ ...settings, feedbackMode: "qualitative", showPopulationToPlayers: false })}>Condition</button>
              <button type="button" aria-pressed={settings.feedbackMode === "exact"} onClick={() => setSettings({ ...settings, feedbackMode: "exact", showPopulationToPlayers: true })}>Exact</button>
            </div>
          </div>
          <div className="toggle-row">
            <label><input type="checkbox" checked={settings.tradingEnabled} onChange={(event) => setSettings({ ...settings, tradingEnabled: event.target.checked })} /> Share fish</label>
            <label><input type="checkbox" checked={settings.initialResearchEnabled} disabled={settings.feedbackMode === "exact"} onChange={(event) => setSettings({ ...settings, initialResearchEnabled: event.target.checked })} /> Enable research</label>
          </div>
          {settings.initialResearchEnabled && settings.feedbackMode !== "exact" && (
            <div className="research-setting-row">
              <div><strong>Research rule</strong><span>Before Season 1 and after each season, every fisher may read each station once. The reading shows the current stock and clears when fishing starts.</span></div>
              <NumberField label="Cost per reading" value={settings.researchCost} suffix="fish" min={0} max={1000} onChange={(value) => setSettings({ ...settings, researchCost: value })} />
            </div>
          )}
        </section>

        {error && <p className="form-error" role="alert">{error}</p>}
        {createdMessage && <p className="setup-success" role="status">{createdMessage}</p>}
        <div className="setup-submit">
          <span>{groupCount} {groupCount === 1 ? "group" : "groups"} · {rounds.length} {rounds.length === 1 ? "round" : "rounds"} · {growthLabel(settings)}</span>
          <div className="setup-submit-actions">
            {groupCount === 1 && <button className="secondary-button" type="submit" value="another" disabled={creating}>{creating ? "Creating…" : "Create and add another"}</button>}
            <button className="primary-button" type="submit" value="open" disabled={creating}>{creating ? "Creating…" : groupCount === 1 ? "Create and open" : `Create ${groupCount} groups`}</button>
          </div>
        </div>
      </form>
    </main>
  );
}

function RulesPanel({ game }: { game: GameState }) {
  const [settings, setSettings] = useState(game.settings);
  const [saved, setSaved] = useState(false);

  useEffect(() => setSettings(game.settings), [game.settings]);

  const save = async () => {
    const result = await emitWithAck<ActionResult>("host:settings", { code: game.code, settings });
    setSaved(result.ok);
    window.setTimeout(() => setSaved(false), 1600);
  };

  const supplyVillages = game.villages.map((village) => {
    const stations = game.stations.filter((station) => station.villageId === village.id);
    return {
      name: village.name,
      fishers: game.players.filter((player) => player.villageId === village.id).length,
      fixedStarting: stations.reduce((sum, station) => sum + station.startingPopulation, 0),
      fixedCapacity: stations.reduce((sum, station) => sum + station.carryingCapacity, 0),
    };
  });

  return (
    <div className="host-two-column rules-layout">
      <section className="panel rule-controls">
        <header className="panel-header"><div><h2>Resource dynamics</h2><p>Applied when the next season is created.</p></div><Settings2 size={20} /></header>
        <div className="segmented-control">
          <button type="button" aria-pressed={settings.growthModel === "none"} onClick={() => setSettings({ ...settings, growthModel: "none", reproductionRate: 0 })}>None</button>
          <button type="button" aria-pressed={settings.growthModel === "multiplier"} onClick={() => setSettings({ ...settings, growthModel: "multiplier" })}>Multiplier</button>
          <button type="button" aria-pressed={settings.growthModel === "logistic"} onClick={() => setSettings({ ...settings, growthModel: "logistic" })}>Density-limited</button>
        </div>
        {settings.growthModel !== "none" && <label className="range-field">
          <span><span>{settings.growthModel === "multiplier" ? "Reproduction multiplier" : "Intrinsic growth rate"}</span><strong>{settings.reproductionRate.toFixed(2)}</strong></span>
          <input
            type="range"
            min={settings.growthModel === "multiplier" ? 1 : 0}
            max={settings.growthModel === "multiplier" ? 3 : 2.5}
            step="0.05"
            value={settings.reproductionRate}
            onChange={(event) => setSettings({ ...settings, reproductionRate: Number(event.target.value) })}
          />
        </label>}
        <div className="setup-choice-row">
          <div><strong>Season limit</strong><span>{settings.seasonLimitMode === "time" ? "The shared timer ends the season automatically." : "Fuel limits each fisher's trips; the season ends when everyone runs out."}</span></div>
          <div className="segmented-control" aria-label="Season limit">
            <button type="button" aria-pressed={settings.seasonLimitMode === "time"} onClick={() => setSettings({ ...settings, seasonLimitMode: "time" })}><Clock3 size={15} /> Timer</button>
            <button type="button" aria-pressed={settings.seasonLimitMode === "fuel"} onClick={() => setSettings({ ...settings, seasonLimitMode: "fuel" })}><Fuel size={15} /> Fuel</button>
          </div>
        </div>
        <div className="form-grid two-columns compact-fields">
          <NumberField label="Food needed per fisher" value={settings.maintenanceCost} suffix="fish / season" onChange={(value) => setSettings({ ...settings, maintenanceCost: value })} />
          {settings.seasonLimitMode === "time" ? (
            <NumberField label="Season duration" value={settings.seasonDurationSeconds} suffix="sec" min={10} max={900} onChange={(value) => setSettings({ ...settings, seasonDurationSeconds: value })} />
          ) : (
            <NumberField label="Fuel per fisher" value={settings.seasonFuel} suffix="units" min={3} max={100} onChange={(value) => setSettings({ ...settings, seasonFuel: value })} />
          )}
          <NumberField label="Maximum seasons" value={settings.maxSeasons} min={2} onChange={(value) => setSettings({ ...settings, maxSeasons: value })} />
        </div>
        <div className="setup-choice-row">
          <div><strong>Season information for players</strong><span>Show the total and remaining seasons, or reveal only the current season.</span></div>
          <div className="segmented-control" aria-label="Participant season horizon">
            <button type="button" aria-pressed={settings.showSeasonCountToPlayers} onClick={() => setSettings({ ...settings, showSeasonCountToPlayers: true })}>Show remaining</button>
            <button type="button" aria-pressed={!settings.showSeasonCountToPlayers} onClick={() => setSettings({ ...settings, showSeasonCountToPlayers: false })}>Hide remaining</button>
          </div>
        </div>
        <div className="setup-choice-row">
          <div><strong>Collapsed groups</strong><span>Keep every group visible, and decide whether collapsed groups remain eligible to win.</span></div>
          <div className="segmented-control" aria-label="Collapsed group winner eligibility">
            <button type="button" aria-pressed={settings.collapsedGroupsCanWin} onClick={() => setSettings({ ...settings, collapsedGroupsCanWin: true })}>Can win</button>
            <button type="button" aria-pressed={!settings.collapsedGroupsCanWin} onClick={() => setSettings({ ...settings, collapsedGroupsCanWin: false })}>Cannot win</button>
          </div>
        </div>
        <FishSupplyControl
          settings={settings}
          villages={supplyVillages}
          onChange={setSettings}
          timingNote={game.status === "setup"
            ? "These amounts will be applied when Season 1 starts."
            : "To apply changed amounts, save the rules, reset the game, and start Season 1 again."}
        />
        <div className="setup-choice-row">
          <div><strong>Fishing method</strong><span>Choose buttons or printed station codes.</span></div>
          <div className="segmented-control" aria-label="Fishing method">
            <button type="button" aria-pressed={settings.stationSelectionMode === "buttons"} onClick={() => setSettings({ ...settings, stationSelectionMode: "buttons" })}>Tap station</button>
            <button type="button" aria-pressed={settings.stationSelectionMode === "qr"} onClick={() => setSettings({ ...settings, stationSelectionMode: "qr" })}>Scan QR</button>
          </div>
        </div>
        <div className="setup-choice-row">
          <div><strong>Live fish feedback</strong><span>Hidden, qualitative condition, or exact counts.</span></div>
          <div className="segmented-control" aria-label="Live fish feedback">
            <button type="button" aria-pressed={settings.feedbackMode === "hidden"} onClick={() => setSettings({ ...settings, feedbackMode: "hidden", showPopulationToPlayers: false })}>Hidden</button>
            <button type="button" aria-pressed={settings.feedbackMode === "qualitative"} onClick={() => setSettings({ ...settings, feedbackMode: "qualitative", showPopulationToPlayers: false })}>Condition</button>
            <button type="button" aria-pressed={settings.feedbackMode === "exact"} onClick={() => setSettings({ ...settings, feedbackMode: "exact", showPopulationToPlayers: true })}>Exact</button>
          </div>
        </div>
        <div className="toggle-stack">
          <label><input type="checkbox" checked={settings.tradingEnabled} onChange={(event) => setSettings({ ...settings, tradingEnabled: event.target.checked })} /><span><strong>Player trading</strong><small>Allow direct fish transfers</small></span></label>
          <label><input type="checkbox" checked={settings.initialResearchEnabled} disabled={settings.feedbackMode === "exact"} onChange={(event) => setSettings({ ...settings, initialResearchEnabled: event.target.checked })} /><span><strong>Enable research</strong><small>Let players reveal hidden stocks between seasons</small></span></label>
        </div>
        {settings.initialResearchEnabled && settings.feedbackMode !== "exact" && (
          <div className="research-setting-row research-setting-row-compact">
            <div><strong>Research rule</strong><span>Before Season 1 and after each season, every fisher may read each station once. Readings clear when fishing starts.</span></div>
            <NumberField label="Cost per reading" value={settings.researchCost} suffix="fish" min={0} max={1000} onChange={(value) => setSettings({ ...settings, researchCost: value })} />
          </div>
        )}
        <button className="primary-button" onClick={save} disabled={game.status === "running"}>{saved ? "Saved" : "Apply rules"}</button>
      </section>
      <section className="panel growth-explanation">
        <header className="panel-header"><div><h2>Replenishment preview</h2><p>The exact result if you advance now.</p></div><Activity size={20} /></header>
        <GrowthPreview stations={game.stations} settings={settings} villages={game.villages} />
        <div className="formula-note">
          {settings.growthModel === "none" ? (
            <><strong>Finite pool</strong><code>next = current</code><p>Fish do not return between seasons.</p></>
          ) : settings.growthModel === "multiplier" ? (
            <><strong>Multiplier model</strong><code>next = min(capacity, current × rate)</code><p>This reproduces the original doubling rule when the rate is 2.00.</p></>
          ) : (
            <><strong>Density-limited model</strong><code>next = current + r × current × (1 − current / capacity)</code><p>Growth is fastest at intermediate stock and slows near capacity.</p></>
          )}
        </div>
      </section>
    </div>
  );
}

function LivePanel({ game, command }: { game: GameState; command: (command: "start" | "pause" | "end" | "reset" | "next-round") => void }) {
  const totalCapacity = game.stations.reduce((sum, station) => sum + station.carryingCapacity, 0);
  const fishRemaining = totalFish(game.stations);
  const ratio = totalCapacity ? Math.round((fishRemaining / totalCapacity) * 100) : 0;
  const secondsRemaining = useSeasonSeconds(
    game.seasonStartedAt,
    game.settings.seasonDurationSeconds,
    game.status === "running" && game.settings.seasonLimitMode === "time",
  );
  const fuelRemaining = game.players.reduce((sum, player) => sum + player.fuel, 0);
  const eligiblePlayers = game.players.filter((player) =>
    game.villages.find((village) => village.id === player.villageId)?.collapsedAtSeason === null);
  const readyCount = eligiblePlayers.filter((player) => player.readyForNextSeason).length;
  const readinessTotal = game.status === "setup" ? game.settings.expectedPlayerCount : eligiblePlayers.length;
  const waitingForPlayers = game.status === "setup" || (game.status === "paused" && game.seasonHasRun);
  const nextSeason = game.status === "setup" ? 1 : game.season + 1;
  const countdown = useCountdownSeconds(game.countdownEndsAt);
  const setupCanStart = game.players.length >= game.settings.expectedPlayerCount
    && eligiblePlayers.length > 0
    && eligiblePlayers.every((player) => player.readyForNextSeason);
  const hasNextRound = game.roundIndex + 1 < game.rounds.length;
  const result = game.roundResults.find((item) => item.roundId === (game.rounds[game.roundIndex]?.id ?? `game-${game.roundIndex + 1}`));

  return (
    <div className="live-stack">
      <section className="run-strip">
        <div className="season-readout"><span>Season</span><strong>{game.season}</strong><small>of {game.settings.maxSeasons}</small></div>
        <div className={`status-readout status-${game.status}`}><i /><span>{countdown > 0 ? `starting in ${countdown}` : game.status === "paused" ? "between seasons" : game.status}</span></div>
        <div className="run-metrics">
          <span><Users size={17} /><strong>{game.players.length}</strong> fishers</span>
          {waitingForPlayers && <span><Users size={17} /><strong>{readyCount}/{readinessTotal}</strong> ready</span>}
          <span><Fish size={17} /><strong>{fishRemaining}</strong> fish remaining</span>
          <span><Gauge size={17} /><strong>{ratio}%</strong> capacity</span>
          {game.settings.seasonLimitMode === "time" ? (
            <span><Clock3 size={17} /><strong>{formatSeasonTime(secondsRemaining)}</strong> {game.status === "running" ? "left" : "per season"}</span>
          ) : (
            <span><Fuel size={17} /><strong>{fuelRemaining}</strong> fuel remaining</span>
          )}
        </div>
        <div className="run-controls">
          {game.status === "running" ? (
            <button className="secondary-button" onClick={() => command("pause")}><Pause size={17} /> End season now</button>
          ) : game.status === "ended" ? hasNextRound ? (
            <button className="primary-button" onClick={() => command("next-round")}><Play size={17} /> Prepare next round</button>
          ) : (
            <button className="primary-button" disabled><CircleStop size={17} /> Session finished</button>
          ) : game.status === "setup" ? (
            <button className="primary-button" onClick={() => command("start")} disabled={!setupCanStart}><Play size={17} /> Start game</button>
          ) : waitingForPlayers ? (
            <button className="secondary-button" onClick={() => command("start")}><Play size={17} /> Start without waiting</button>
          ) : (
            <button className="primary-button" onClick={() => command("start")}><Play size={17} /> Start Season {nextSeason}</button>
          )}
          <button className="icon-button" title="End game" aria-label="End game" onClick={() => command("end")} disabled={game.status === "ended"}><CircleStop size={18} /></button>
          <button className="icon-button" title="Reset game" aria-label="Reset game" onClick={() => command("reset")}><RefreshCw size={17} /></button>
        </div>
      </section>

      {waitingForPlayers && (
        <section className="host-ready-status">
          <Users size={20} />
          <div><strong>{game.status === "setup" ? `${game.players.length} of ${game.settings.expectedPlayerCount} joined · ${readyCount} ready` : `${readyCount} of ${eligiblePlayers.length} fishers ready`}</strong><span>{game.status === "setup" ? setupCanStart ? "Everyone is ready. Start the game when the room is settled." : "Season 1 starts only when the facilitator launches it." : `Season ${nextSeason} starts automatically when everyone presses Ready.`}</span></div>
          <div className="host-ready-dots" aria-label={`${readyCount} of ${readinessTotal} ready`}>
            {eligiblePlayers.map((player) => <i className={player.readyForNextSeason ? "ready" : ""} title={`${player.name}: ${player.readyForNextSeason ? "ready" : "not ready"}`} key={player.id} />)}
          </div>
        </section>
      )}

      {game.status === "paused" && <GrowthPreview stations={game.stations} settings={game.settings} villages={game.villages} />}

      {game.status === "ended" && result && (
        <section className="panel host-final-results">
          <div className="group-result-hero"><span>Round result</span><strong className="group-result-status">{fisheryResultLabel(game, result.collapsedAtSeason)}</strong><div className="extraction-total"><strong>{result.totalExtracted}</strong><small>fish extracted</small></div></div>
          <div className="player-results result-summary-grid result-summary-grid-one"><span><small>People sustained</small><strong>{result.sustainedPlayers} / {result.players.length}</strong></span></div>
          <div className="table-wrap result-table"><table><thead><tr><th>Fisher</th><th>Caught</th><th>Purchases</th><th>Final balance</th><th>Outcome</th></tr></thead><tbody>{result.players.map((resultPlayer) => <tr key={resultPlayer.playerId}><td data-label="Fisher"><strong>{resultPlayer.name}</strong></td><td data-label="Caught">{resultPlayer.totalCaught}</td><td data-label="Purchases">{resultPlayer.purchases}</td><td data-label="Balance">{resultPlayer.finalBalance}</td><td data-label="Outcome"><span className={`table-status ${resultPlayer.sustained ? "active" : "inactive"}`}>{resultPlayer.sustained ? "sustained" : "food shortfall"}</span></td></tr>)}</tbody></table></div>
        </section>
      )}

      <div className="host-two-column live-layout">
        <section className={`host-villages host-villages-${game.villages.length}`}>
          {game.villages.map((village, villageIndex) => {
            const stats = villageStats(game, village.id);
            const competition = villageCompetitionResult(game, village.id);
            return (
              <article className={`village-board village-board-${villageIndex} ${stats.collapsed ? "village-collapsed" : ""}`} key={village.id}>
                <header>
                  <div><span>Village</span><strong>{village.name}</strong></div>
                  <div className="village-metrics"><span><Users size={15} />{stats.players.length}</span><span><Fish size={15} />{stats.population}</span></div>
                  <em>{stats.collapsed ? `Collapsed in Season ${village.collapsedAtSeason ?? game.season}` : competition === "ahead" ? "Last fishery standing" : `${Math.round(stats.ratio * 100)}% viable`}</em>
                </header>
                {stats.collapsed && <div className="host-collapse-settlement"><strong>No fish remain</strong><span>{game.settings.maxSeasons - (village.collapsedAtSeason ?? game.season)} remaining seasons × {game.settings.maintenanceCost} food = {village.futureFoodCostPerPlayer} deducted from every fisher</span></div>}
                <div className="station-grid host-stations">
                  {stats.stations.map((station, index) => <FishTank key={station.id} station={station} index={index + villageIndex * 2} compact={game.villages.length === 2} />)}
                </div>
              </article>
            );
          })}
        </section>
        <aside className="panel event-panel">
          <header className="panel-header"><div><h2>Live activity</h2><p>Most recent events</p></div><Activity size={19} /></header>
          <ol className="event-list">
            {game.events.slice(0, 12).map((item, index) => (
              <li className={index === 0 ? "event-new" : ""} key={item.id}><i className={`event-dot event-${item.type}`} /><span>{item.message}</span><time>{new Date(item.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></li>
            ))}
          </ol>
        </aside>
      </div>

      <section className="panel history-panel">
        <header className="panel-header"><div><h2>Population history</h2><p>Recorded at the beginning of each season</p></div><BarChart3 size={19} /></header>
        <HistoryChart stations={game.stations} />
      </section>
    </div>
  );
}

function PeoplePanel({ game }: { game: GameState }) {
  const usesFuel = game.settings.seasonLimitMode === "fuel";
  return (
    <section className="panel people-panel">
      <header className="panel-header"><div><h2>Fishers</h2><p>{game.players.length} participants connected</p></div><Users size={20} /></header>
      {game.players.length === 0 ? <p className="empty-state">No participants have joined yet.</p> : (
        <div className="table-wrap"><table><thead><tr><th>Name</th><th>Village</th><th>Balance</th><th>Season catch</th><th>Total catch</th>{usesFuel && <th>Fuel</th>}<th>Boat</th><th>Status</th></tr></thead><tbody>
          {[...game.players].sort((a, b) => b.totalCaught - a.totalCaught).map((player) => (
            <tr key={player.id}><td><strong>{player.name}</strong></td><td>{game.villages.find((village) => village.id === player.villageId)?.name}</td><td>{player.balance}</td><td>{player.seasonCaught}</td><td>{player.totalCaught}</td>{usesFuel && <td>{player.fuel}</td>}<td>{game.boats.find((boat) => boat.id === player.boatId)?.name}</td><td><span className={player.readyForNextSeason ? "table-status active" : "table-status inactive"}>{game.villages.find((village) => village.id === player.villageId)?.collapsedAtSeason !== null ? "spectating" : player.readyForNextSeason ? "ready" : player.balance < 0 ? "recovering" : "active"}</span></td></tr>
          ))}
        </tbody></table></div>
      )}
    </section>
  );
}

function StationsPanel({ game }: { game: GameState }) {
  const origin = window.location.origin;
  return (
    <div className="qr-sheet">
      <section className="join-qr panel">
        <QrCode value={`${origin}/play/${game.code}`} label={`Join ${game.code}`} />
        <div><p className="eyebrow">Participant access</p><h2>{game.code}</h2><p>Scan once to join the game. Station QR codes can then be scanned from the participant screen.</p></div>
      </section>
      {game.villages.map((village) => (
        <section className="village-code-group" key={village.id}>
          <header><strong>{village.name}</strong><span>Only members of this village can use these stations.</span></header>
          <div className="station-qr-grid">
            {game.stations.filter((station) => station.villageId === village.id).map((station) => (
              <section className="panel station-qr" key={station.id}>
                <QrCode value={`${origin}/play/${game.code}?station=${station.id}`} label={`${village.name}: ${station.name}`} />
                <strong>{station.name}</strong><span>{village.name}</span>
              </section>
            ))}
          </div>
        </section>
      ))}
      <button className="secondary-button print-button" onClick={() => window.print()}><QrCodeIcon size={17} /> Print station codes</button>
    </div>
  );
}

function HostDashboard({ code }: { code: string }) {
  const navigate = useNavigate();
  const { game, error, loading } = useGame(code);
  const [tab, setTab] = useState<HostTab>("live");
  const [commandError, setCommandError] = useState("");

  const command = async (nextCommand: "start" | "pause" | "end" | "reset" | "next-round") => {
    if ((nextCommand === "reset" || nextCommand === "end") && !window.confirm(`${nextCommand === "reset" ? "Reset" : "End"} this game?`)) return;
    const result = await emitWithAck<ActionResult>("host:command", { code, command: nextCommand });
    setCommandError(result.ok ? "" : result.error ?? "Command failed.");
  };

  if (loading) return <Loading message="Opening facilitator dashboard" />;
  if (error || !game) return <ErrorScreen message={error || "Game not found."} />;

  const tabs: { id: HostTab; label: string; icon: React.ReactNode }[] = [
    { id: "live", label: "Game", icon: <Activity size={17} /> },
    { id: "rules", label: "Rules", icon: <Settings2 size={17} /> },
    { id: "people", label: "Players", icon: <Users size={17} /> },
    { id: "stations", label: "Codes", icon: <QrCodeIcon size={17} /> },
  ];

  return (
    <main className="app-shell host-shell">
      <CountdownOverlay endsAt={game.countdownEndsAt} />
      <GameHeader game={game} role="Facilitator" />
      <nav className="app-tabs" aria-label="Facilitator views">
        <button className="all-games-tab" onClick={() => navigate("/host")}><LayoutList size={17} />All games</button>
        {tabs.map((item) => <button key={item.id} aria-pressed={tab === item.id} onClick={() => setTab(item.id)}>{item.icon}{item.label}{item.id === "people" && <span>{game.players.length}</span>}</button>)}
        {game.settings.workshopName && <a href={`/leaderboard/${encodeURIComponent(game.settings.workshopName)}`} target="_blank" rel="noreferrer"><BarChart3 size={17} /> Ranking</a>}
      </nav>
      {commandError && <p className="inline-error" role="alert">{commandError}</p>}
      <div className="app-content">
        {tab === "live" && <LivePanel game={game} command={command} />}
        {tab === "rules" && <RulesPanel game={game} />}
        {tab === "people" && <PeoplePanel game={game} />}
        {tab === "stations" && <StationsPanel game={game} />}
      </div>
    </main>
  );
}

export function HostPage() {
  const { code } = useParams();
  return (
    <FacilitatorAccess>
      {code ? <HostDashboard code={code.toUpperCase()} /> : <HostSetup />}
    </FacilitatorAccess>
  );
}
