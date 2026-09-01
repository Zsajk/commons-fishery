import { CircleCheckBig, Fish, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { WorkshopGroupSummary } from "../../shared/game";
import { getWorkshopGroups } from "../api";
import { QrCode } from "../components/QrCode";
import { participantSeasonLabel } from "../seasonLabel";

export function WorkshopLobbyPage() {
  const { workshopName = "" } = useParams();
  const name = decodeURIComponent(workshopName);
  const [groups, setGroups] = useState<WorkshopGroupSummary[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const load = () => void getWorkshopGroups(name)
      .then((next) => {
        if (!active) return;
        setGroups(next);
        setError("");
      })
      .catch(() => active && setError("Unable to load the session groups."));
    load();
    const interval = window.setInterval(load, 2000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [name]);

  const totalPlayers = groups.reduce((sum, group) => sum + group.playerCount, 0);
  const totalExpected = groups.reduce((sum, group) => sum + group.expectedPlayerCount, 0);
  const ready = groups.reduce((sum, group) => sum + group.readyCount, 0);

  return (
    <main className="workshop-lobby-shell">
      <header className="workshop-lobby-header">
        <div><span className="display-mark"><Fish size={27} /></span><div><span>Commons Fishery</span><strong>{name}</strong></div></div>
        <section><span><Users size={19} /> {totalPlayers} / {totalExpected} joined</span><span><CircleCheckBig size={19} /> {ready} ready</span></section>
      </header>
      {error && <p className="form-error">{error}</p>}
      <section className="workshop-lobby-grid" aria-label="Session groups">
        {groups.map((group) => (
          <article className={`workshop-group-card status-${group.status}`} key={group.code}>
            <QrCode value={`${window.location.origin}/play/${group.code}`} label={`Join ${group.groupName}`} />
            <div className="workshop-group-copy">
              <span>{group.roundName}</span>
              <strong>{group.groupName}</strong>
              <b>{group.code}</b>
            </div>
            <div className="workshop-group-progress">
              <span><Users size={16} /> {group.playerCount} / {group.expectedPlayerCount}</span>
              <span><CircleCheckBig size={16} /> {group.readyCount} ready</span>
              <small>{group.status === "setup" ? "Waiting for facilitator" : group.status === "running" ? `${participantSeasonLabel(group.season, group.maxSeasons, group.showSeasonCountToPlayers)} running` : group.status === "paused" ? `${participantSeasonLabel(group.season, group.maxSeasons, group.showSeasonCountToPlayers)} complete` : "Round complete"}</small>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
