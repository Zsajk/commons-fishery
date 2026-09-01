import "dotenv/config";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { WebSocketServer } from "ws";
import type { ActionResult, PlayerJoinResult } from "../shared/game.js";
import { normalizeCode } from "../shared/engine.js";
import { AuthService } from "./auth.js";
import { buildGroupStandings, buildWorkshopGroups, handleGameAction } from "./game-actions.js";
import { LocalGameRepository } from "./game-repository.js";
import { gameViewFor } from "./game-view.js";
import { GameRealtimeHub } from "./realtime.js";
import { createGameStorage } from "./storage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || 5180);
const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "8kb" }));
const httpServer = createServer(app);
const webSocketServer = new WebSocketServer({
  server: httpServer,
  path: "/api/ws",
  maxPayload: 256 * 1024,
});
const repository = new LocalGameRepository(createGameStorage(root));
await repository.init();
const hub = new GameRealtimeHub(repository);
const auth = AuthService.fromEnvironment();

for (const game of await repository.list()) hub.receiveGame(game);

const facilitatorLoginLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { ok: false, error: "Too many incorrect attempts. Wait 15 minutes and try again." },
});

const joinDiscoveryLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { ok: false, error: "Too many join attempts. Wait a few minutes and try again." },
});

const joinRoomLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 25,
  keyGenerator: (request) => {
    const address = ipKeyGenerator(request.ip ?? "unknown");
    const code = normalizeCode(String(request.params.code ?? ""));
    return `${address}:${code}`;
  },
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { ok: false, error: "Too many attempts to join this group. Ask the facilitator to check the code." },
});

app.get("/health", async (_request, response) => {
  response.json({ status: "ok", storage: repository.kind, games: await repository.count() });
});

app.get("/api/auth", async (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.json(await auth.publicSession(request.headers.cookie));
});

app.get("/api/leaderboard", async (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  const workshop = typeof request.query.workshop === "string" ? request.query.workshop : "";
  if (!await canReadWorkshop(request.headers.cookie, workshop)) {
    response.status(403).json({ error: "A participant or facilitator session is required." });
    return;
  }
  response.json(buildGroupStandings(await repository.list(), workshop));
});

app.get("/api/workshop", async (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  const workshop = typeof request.query.workshop === "string" ? request.query.workshop : "";
  if (!await canReadWorkshop(request.headers.cookie, workshop)) {
    response.status(403).json({ error: "A participant or facilitator session is required." });
    return;
  }
  response.json(buildWorkshopGroups(await repository.list(), workshop));
});

app.post("/api/facilitator/login", facilitatorLoginLimit, async (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  if (!auth.verifyFacilitatorPin(String(request.body?.pin ?? ""))) {
    response.status(401).json({ ok: false, error: "Incorrect facilitator PIN." });
    return;
  }
  response.setHeader("Set-Cookie", await auth.createFacilitatorCookie());
  response.json({ ok: true });
});

app.post("/api/facilitator/logout", (_request, response) => {
  response.setHeader("Set-Cookie", auth.clearFacilitatorCookie());
  response.json({ ok: true });
});

app.post("/api/games/:code/join", joinDiscoveryLimit, joinRoomLimit, async (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  const code = normalizeCode(String(request.params.code ?? ""));
  const handled = await handleGameAction(
    repository,
    "player:join",
    {
      code,
      name: request.body?.name,
      villageId: request.body?.villageId,
    },
    { facilitator: false, allowPlayerJoin: true },
  );
  const result = handled.result as ActionResult<PlayerJoinResult>;
  if (!result.ok || !result.data) {
    response.status(400).json(result);
    return;
  }
  const playerAuthorization = {
    facilitator: false,
    player: { code, playerId: result.data.playerId },
  };
  response.setHeader("Set-Cookie", await auth.createPlayerCookie(code, result.data.playerId));
  response.json({
    ...result,
    data: {
      ...result.data,
      game: gameViewFor(result.data.game, playerAuthorization),
    },
  });
  if (handled.game) hub.receiveGame(handled.game);
});

webSocketServer.on("connection", (socket, request) => {
  void auth.readAuthorization(request.headers.cookie)
    .then((authorization) => hub.register(socket, authorization))
    .catch(() => socket.close(1011, "Unable to establish a session."));
});

if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(root, "dist")));
  app.use((_request, response) => response.sendFile(path.join(root, "dist", "index.html")));
} else {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({ root, server: { middlewareMode: true }, appType: "spa" });
  app.use(vite.middlewares);
}

httpServer.listen(port, "0.0.0.0", async () => {
  console.log(
    `Commons Fishery running at http://localhost:${port} with ${repository.kind} storage (${await repository.count()} saved games)`,
  );
});

async function canReadWorkshop(cookieHeader: string | undefined, requestedWorkshop: string): Promise<boolean> {
  const authorization = await auth.readAuthorization(cookieHeader);
  if (authorization.facilitator) return true;
  const player = authorization.player;
  if (!player || !requestedWorkshop.trim()) return false;
  const game = await repository.get(player.code);
  return Boolean(game
    && game.players.some((candidate) => candidate.id === player.playerId)
    && game.settings.workshopName.trim().toLowerCase() === requestedWorkshop.trim().toLowerCase());
}

async function shutdown() {
  hub.close();
  webSocketServer.close();
  httpServer.close();
  await repository.close();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
