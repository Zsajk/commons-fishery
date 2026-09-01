import type {
  ActionResult,
  BrowserSession,
  GroupStanding,
  PlayerJoinResult,
  WorkshopGroupSummary,
} from "../shared/game";

async function readJson<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

export async function getLeaderboard(
  workshopName: string,
  signal?: AbortSignal,
): Promise<GroupStanding[]> {
  const response = await fetch(`/api/leaderboard?workshop=${encodeURIComponent(workshopName)}`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error("Unable to load the group ranking.");
  return readJson<GroupStanding[]>(response);
}

export async function getWorkshopGroups(
  workshopName: string,
  signal?: AbortSignal,
): Promise<WorkshopGroupSummary[]> {
  const response = await fetch(`/api/workshop?workshop=${encodeURIComponent(workshopName)}`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error("Unable to load the session lobby.");
  return readJson<WorkshopGroupSummary[]>(response);
}

export async function getBrowserSession(signal?: AbortSignal): Promise<BrowserSession> {
  const response = await fetch("/api/auth", {
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error("Unable to check access.");
  return readJson<BrowserSession>(response);
}

export async function loginFacilitator(pin: string): Promise<ActionResult> {
  const response = await fetch("/api/facilitator/login", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin }),
  });
  return readJson<ActionResult>(response);
}

export async function joinGame(
  code: string,
  name: string,
  villageId: string,
): Promise<ActionResult<PlayerJoinResult>> {
  const response = await fetch(`/api/games/${encodeURIComponent(code)}/join`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, villageId }),
  });
  return readJson<ActionResult<PlayerJoinResult>>(response);
}
