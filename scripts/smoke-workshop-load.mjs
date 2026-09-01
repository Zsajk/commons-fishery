import WebSocket from "ws";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:5180";
const webSocketUrl = new URL("/api/ws", baseUrl);
webSocketUrl.protocol = webSocketUrl.protocol === "https:" ? "wss:" : "ws:";
const facilitatorPin = process.env.SMOKE_FACILITATOR_PIN ?? "workshop";
const testId = String(Date.now()).slice(-7);
const workshopName = `Load test ${testId}`;
const groupCount = 6;
const playersPerGroup = 5;
const catchesPerPlayer = 3;

function responseCookie(response) {
  const setCookie = response.headers.getSetCookie?.()[0] ?? response.headers.get("set-cookie");
  if (!setCookie) throw new Error("Server did not create a session cookie");
  return setCookie.split(";", 1)[0];
}

async function post(path, body) {
  const response = await fetch(new URL(path, baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  return { response, result };
}

class Client {
  constructor(name, cookie) {
    this.name = name;
    this.cookie = cookie;
    this.pending = new Map();
  }

  async connect() {
    this.socket = new WebSocket(webSocketUrl, { headers: { Cookie: this.cookie } });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`${this.name} connection timed out`)), 30000);
      this.socket.once("open", () => {
        clearTimeout(timeout);
        resolve();
      });
      this.socket.once("error", reject);
    });
    this.socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type !== "ack") return;
      const request = this.pending.get(message.id);
      if (!request) return;
      clearTimeout(request.timeout);
      this.pending.delete(message.id);
      request.resolve(message.result);
    });
  }

  action(event, payload) {
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${this.name} ${event} timed out`));
      }, 60000);
      this.pending.set(id, { resolve, reject, timeout });
      this.socket.send(JSON.stringify({ id, event, payload }));
    });
  }

  close() {
    this.socket?.close();
  }
}

const players = [];
let host;
let createdGames = [];

try {
  const login = await post("/api/facilitator/login", { pin: facilitatorPin });
  if (!login.result.ok) throw new Error(login.result.error ?? "Facilitator login failed");
  host = new Client("host", responseCookie(login.response));
  await host.connect();

  const created = await host.action("host:create-workshop", {
    workshopName,
    groupCount,
    groupPrefix: "Load Group",
    settings: {
      expectedPlayerCount: playersPerGroup,
      villageCount: 1,
      maintenanceCost: 0,
      seasonLimitMode: "time",
      seasonDurationSeconds: 60,
      maxSeasons: 2,
      growthModel: "none",
      initialResearchEnabled: false,
      tradingEnabled: false,
      stationSelectionMode: "buttons",
      scaleResourcesToPlayers: false,
      feedbackMode: "exact",
    },
    stations: [{ name: "Load Bay", startingPopulation: 1000, carryingCapacity: 1000 }],
  });
  if (!created.ok) throw new Error(created.error ?? "Workshop creation failed");
  createdGames = created.data;
  if (createdGames.length !== groupCount) throw new Error(`Expected ${groupCount} groups, got ${createdGames.length}`);

  const joined = await Promise.all(createdGames.flatMap((game, groupIndex) =>
    Array.from({ length: playersPerGroup }, async (_, playerIndex) => {
      const name = `G${groupIndex + 1} Player ${playerIndex + 1}`;
      const response = await post(`/api/games/${game.code}/join`, { name });
      if (!response.result.ok) throw new Error(response.result.error ?? `${name} could not join`);
      return {
        code: game.code,
        playerId: response.result.data.playerId,
        cookie: responseCookie(response.response),
      };
    }),
  ));

  for (const [index, participant] of joined.entries()) {
    const client = new Client(`player-${index + 1}`, participant.cookie);
    players.push({ ...participant, client });
  }
  await Promise.all(players.map(({ client }) => client.connect()));
  await Promise.all(players.map(({ client, code }) => client.action("game:subscribe", code)));

  const readyResults = await Promise.all(players.map(({ client, code, playerId }) =>
    client.action("player:ready", { code, playerId, ready: true })));
  if (readyResults.some((result) => !result.ok)) throw new Error("At least one player could not become ready");

  const started = await host.action("host:workshop-command", { workshopName, command: "start" });
  if (!started.ok) throw new Error(started.error ?? "Workshop could not start");
  const states = await Promise.all(createdGames.map((game) => host.action("game:subscribe", game.code)));
  const countdownEnd = Math.max(...states.map((state) => state.data.countdownEndsAt ?? 0));
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, countdownEnd - Date.now()) + 150));

  const stationByCode = new Map(states.map((state) => [state.data.code, state.data.stations[0].id]));
  const latencies = [];
  const startedFishingAt = performance.now();
  await Promise.all(players.map(async ({ client, code, playerId }) => {
    for (let catchIndex = 0; catchIndex < catchesPerPlayer; catchIndex += 1) {
      const actionStartedAt = performance.now();
      const result = await client.action("player:fish", {
        code,
        playerId,
        stationId: stationByCode.get(code),
      });
      latencies.push(performance.now() - actionStartedAt);
      if (!result.ok || result.data?.caught !== 5) {
        throw new Error(result.error ?? `Unexpected catch in ${code}`);
      }
    }
  }));
  const totalFishingMs = performance.now() - startedFishingAt;

  const finalStates = await Promise.all(createdGames.map((game) => host.action("game:subscribe", game.code)));
  const expectedPopulation = 1000 - playersPerGroup * catchesPerPlayer * 5;
  const populations = finalStates.map((state) => state.data.stations[0].population);
  if (populations.some((population) => population !== expectedPopulation)) {
    throw new Error(`Unexpected populations: ${populations.join(", ")}`);
  }

  latencies.sort((left, right) => left - right);
  const percentile = (fraction) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * fraction))];
  console.log(JSON.stringify({
    ok: true,
    workshop: workshopName,
    groups: groupCount,
    connectedPlayers: players.length,
    simultaneousCatches: players.length * catchesPerPlayer,
    expectedPopulationPerGroup: expectedPopulation,
    totalFishingMs: Math.round(totalFishingMs),
    latencyMs: {
      median: Math.round(percentile(0.5)),
      p95: Math.round(percentile(0.95)),
      maximum: Math.round(latencies.at(-1)),
    },
  }, null, 2));
} finally {
  for (const game of createdGames) {
    try {
      await host?.action("host:command", { code: game.code, command: "end" });
      await host?.action("host:delete", { code: game.code });
    } catch {
      // Preserve the original test result if cleanup cannot reach the server.
    }
  }
  players.forEach(({ client }) => client.close());
  host?.close();
}
