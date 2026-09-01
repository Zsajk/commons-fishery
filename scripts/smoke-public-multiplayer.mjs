import WebSocket from "ws";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:5180";
const webSocketUrl = new URL("/api/ws", baseUrl);
webSocketUrl.protocol = webSocketUrl.protocol === "https:" ? "wss:" : "ws:";
const code = `SMOKE${String(Date.now()).slice(-5)}`;
const facilitatorPin = process.env.SMOKE_FACILITATOR_PIN ?? "workshop";

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

async function waitForCountdown(game) {
  const delay = Math.max(0, Number(game.countdownEndsAt ?? 0) - Date.now());
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay + 100));
}

async function joinParticipant(name, villageId) {
  const joined = await post(`/api/games/${code}/join`, { name, villageId });
  if (!joined.result.ok) throw new Error(joined.result.error ?? `${name} could not join`);
  return { ...joined.result, cookie: responseCookie(joined.response) };
}

class Client {
  constructor(name, cookie) {
    this.name = name;
    this.cookie = cookie;
    this.pending = new Map();
    this.states = [];
  }

  async connect() {
    this.socket = new WebSocket(
      webSocketUrl,
      this.cookie ? { headers: { Cookie: this.cookie } } : undefined,
    );
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`${this.name} connection timed out`)), 15000);
      this.socket.once("open", () => {
        clearTimeout(timeout);
        resolve();
      });
      this.socket.once("error", reject);
    });
    this.socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === "ack") {
        const request = this.pending.get(message.id);
        if (!request) return;
        clearTimeout(request.timeout);
        this.pending.delete(message.id);
        request.resolve(message.result);
      } else if (message.type === "event" && message.event === "game:state") {
        this.states.push(message.payload);
      }
    });
  }

  action(event, payload) {
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${this.name} ${event} timed out`));
      }, 15000);
      this.pending.set(id, { resolve, timeout });
      this.socket.send(JSON.stringify({ id, event, payload }));
    });
  }

  close() {
    this.socket?.close();
  }
}

let host;
let playerA;
let playerB;
let playerC;
let anonymous;

try {
  const login = await post("/api/facilitator/login", { pin: facilitatorPin });
  if (!login.result.ok) throw new Error(login.result.error ?? "Facilitator login failed");
  host = new Client("host", responseCookie(login.response));
  await host.connect();
  const created = await host.action("host:create", {
    code,
    title: "Public multiplayer smoke test",
    settings: {
      villageCount: 2,
      startingBalance: 100,
      scaleResourcesToPlayers: false,
      showPopulationToPlayers: true,
    },
    stations: [{ name: "Test Bay", startingPopulation: 20, carryingCapacity: 40 }],
  });
  if (!created.ok) throw new Error(created.error);

  const gameList = await host.action("host:list", {});
  if (!gameList.ok || !gameList.data.some((game) => game.code === code)) {
    throw new Error("Created game did not appear in the facilitator game list");
  }

  const [villageA, villageB] = created.data.villages;
  const [joinedA, joinedB, joinedC] = await Promise.all([
    joinParticipant("Ada", villageA.id),
    joinParticipant("Ben", villageB.id),
    joinParticipant("Cleo", villageA.id),
  ]);
  playerA = new Client("player-a", joinedA.cookie);
  playerB = new Client("player-b", joinedB.cookie);
  playerC = new Client("player-c", joinedC.cookie);
  anonymous = new Client("anonymous");
  await Promise.all([playerA.connect(), playerB.connect(), playerC.connect(), anonymous.connect()]);

  const unauthorizedStart = await anonymous.action("host:command", { code, command: "start" });
  if (unauthorizedStart.ok || unauthorizedStart.error !== "Facilitator access is required.") {
    throw new Error("An unauthenticated client could send a host command");
  }

  const started = await host.action("host:command", { code, command: "start" });
  if (!started.ok) throw new Error(started.error);

  const current = await host.action("game:subscribe", code);
  await waitForCountdown(current.data);
  const stationA = current.data.stations.find((station) => station.villageId === villageA.id);
  const stationB = current.data.stations.find((station) => station.villageId === villageB.id);
  const [caughtA, caughtB] = await Promise.all([
    playerA.action("player:fish", {
      code,
      playerId: joinedA.data.playerId,
      stationId: stationA.id,
    }),
    playerB.action("player:fish", {
      code,
      playerId: joinedB.data.playerId,
      stationId: stationB.id,
    }),
  ]);
  if (!caughtA.ok || !caughtB.ok) {
    throw new Error(caughtA.error ?? caughtB.error ?? "Concurrent fishing failed");
  }

  const afterCatches = await host.action("game:subscribe", code);
  const stocks = afterCatches.data.villages.map((village) =>
    afterCatches.data.stations
      .filter((station) => station.villageId === village.id)
      .reduce((sum, station) => sum + station.population, 0),
  );
  if (stocks[0] !== 15 || stocks[1] !== 15) {
    throw new Error(`Unexpected stocks after concurrent catches: ${stocks.join(", ")}`);
  }

  const paused = await host.action("host:command", { code, command: "pause" });
  if (!paused.ok) throw new Error(paused.error);

  const researched = await playerA.action("player:research", {
    code,
    playerId: joinedA.data.playerId,
    stationId: stationA.id,
  });
  const traded = await playerA.action("player:trade", {
    code,
    playerId: joinedA.data.playerId,
    recipientId: joinedC.data.playerId,
    amount: 5,
  });
  const upgraded = await playerA.action("player:purchase", {
    code,
    playerId: joinedA.data.playerId,
    boatId: "skiff",
  });
  if (!researched.ok || !traded.ok || !upgraded.ok) {
    throw new Error(researched.error ?? traded.error ?? upgraded.error ?? "Between-season action failed");
  }

  const restarted = await host.action("host:command", { code, command: "start" });
  if (!restarted.ok) throw new Error(restarted.error);
  const upgradedCatch = await playerA.action("player:fish", {
    code,
    playerId: joinedA.data.playerId,
    stationId: stationA.id,
  });
  if (!upgradedCatch.ok || upgradedCatch.data.caught !== 8) {
    throw new Error(upgradedCatch.error ?? `Expected upgraded catch of 8, got ${upgradedCatch.data?.caught}`);
  }

  const playerAClosed = new Promise((resolve) => playerA.socket.once("close", resolve));
  playerA.close();
  await playerAClosed;
  const reconnectedA = new Client("player-a-reconnected", joinedA.cookie);
  await reconnectedA.connect();
  const resumed = await reconnectedA.action("game:subscribe", code);
  if (!resumed.ok || resumed.data.players.length !== 3 || resumed.data.season !== 2) {
    throw new Error("Reconnected player did not recover the game state");
  }
  reconnectedA.close();

  const ended = await host.action("host:command", { code, command: "end" });
  if (!ended.ok) throw new Error(ended.error ?? "Smoke game could not be ended");
  const removed = await host.action("host:delete", { code });
  if (!removed.ok) throw new Error(removed.error ?? "Smoke game could not be removed");

  console.log(JSON.stringify({
    ok: true,
    code,
    players: afterCatches.data.players.map((player) => player.name),
    stocks,
    catches: [caughtA.data.caught, caughtB.data.caught],
    researchedPopulation: researched.data.population,
    transfer: 5,
    upgradedCatch: upgradedCatch.data.caught,
    season: resumed.data.season,
    reconnectRecovered: true,
    unauthorizedHostRejected: true,
    listedAndRemoved: true,
  }, null, 2));
} finally {
  host?.close();
  playerA?.close();
  playerB?.close();
  playerC?.close();
  anonymous?.close();
}
