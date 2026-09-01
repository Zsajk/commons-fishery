import { useEffect, useState } from "react";
import type { GroupStanding, WorkshopGroupSummary } from "../shared/game";
import { getLeaderboard, getWorkshopGroups } from "./api";

export function useLeaderboard(workshopName: string) {
  const [standings, setStandings] = useState<GroupStanding[]>([]);
  const [groups, setGroups] = useState<WorkshopGroupSummary[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!workshopName.trim()) return;
    let active = true;
    const load = () => void Promise.all([
      getLeaderboard(workshopName),
      getWorkshopGroups(workshopName),
    ])
      .then(([nextStandings, nextGroups]) => {
        if (!active) return;
        setStandings(nextStandings);
        setGroups(nextGroups);
        setError("");
      })
      .catch(() => active && setError("Unable to load the group ranking."));
    load();
    const interval = window.setInterval(load, 3000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [workshopName]);

  return { standings, groups, error };
}
