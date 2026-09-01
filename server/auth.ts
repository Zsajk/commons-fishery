import { createHash, timingSafeEqual } from "node:crypto";
import { parse, serialize } from "cookie";
import { jwtVerify, SignJWT, type JWTPayload } from "jose";
import type { BrowserSession } from "../shared/game.js";
import type { ActionAuthorization } from "./game-actions.js";

const FACILITATOR_COOKIE = "common_waters_facilitator";
const PLAYER_COOKIE = "common_waters_player";
const ISSUER = "common-waters";
const AUDIENCE = "common-waters-workshop";
const FACILITATOR_TTL_SECONDS = 12 * 60 * 60;
const PLAYER_TTL_SECONDS = 7 * 24 * 60 * 60;

export class AuthService {
  private readonly key: Uint8Array;

  constructor(
    private readonly facilitatorPin: string,
    sessionSecret: string,
    private readonly secureCookies: boolean,
  ) {
    if (!facilitatorPin) throw new Error("FACILITATOR_PIN is required.");
    if (sessionSecret.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters.");
    this.key = new TextEncoder().encode(sessionSecret);
  }

  static fromEnvironment(): AuthService {
    const production = process.env.NODE_ENV === "production";
    const facilitatorPin = process.env.FACILITATOR_PIN ?? (production ? "" : "workshop");
    const sessionSecret = process.env.SESSION_SECRET
      ?? (production ? "" : "common-waters-development-session-secret");
    return new AuthService(facilitatorPin, sessionSecret, production);
  }

  verifyFacilitatorPin(candidate: string): boolean {
    const expected = createHash("sha256").update(this.facilitatorPin).digest();
    const actual = createHash("sha256").update(candidate).digest();
    return timingSafeEqual(expected, actual);
  }

  async createFacilitatorCookie(): Promise<string> {
    const token = await this.sign({ role: "facilitator" }, FACILITATOR_TTL_SECONDS);
    return this.cookie(FACILITATOR_COOKIE, token, FACILITATOR_TTL_SECONDS);
  }

  clearFacilitatorCookie(): string {
    return this.cookie(FACILITATOR_COOKIE, "", 0);
  }

  async createPlayerCookie(code: string, playerId: string): Promise<string> {
    const token = await this.sign({ role: "player", code, playerId }, PLAYER_TTL_SECONDS);
    return this.cookie(PLAYER_COOKIE, token, PLAYER_TTL_SECONDS);
  }

  async readAuthorization(cookieHeader: string | undefined): Promise<ActionAuthorization> {
    const cookies = parse(cookieHeader ?? "");
    const facilitator = await this.isFacilitator(cookies[FACILITATOR_COOKIE]);
    const player = await this.readPlayer(cookies[PLAYER_COOKIE]);
    return { facilitator, player: player ?? undefined };
  }

  async publicSession(cookieHeader: string | undefined): Promise<BrowserSession> {
    const authorization = await this.readAuthorization(cookieHeader);
    return { facilitator: authorization.facilitator, player: authorization.player };
  }

  private async sign(payload: JWTPayload, expiresIn: number): Promise<string> {
    return new SignJWT(payload)
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${expiresIn}s`)
      .sign(this.key);
  }

  private async verify(token: string | undefined): Promise<JWTPayload | null> {
    if (!token) return null;
    try {
      const result = await jwtVerify(token, this.key, {
        algorithms: ["HS256"],
        issuer: ISSUER,
        audience: AUDIENCE,
      });
      return result.payload;
    } catch {
      return null;
    }
  }

  private async isFacilitator(token: string | undefined): Promise<boolean> {
    return (await this.verify(token))?.role === "facilitator";
  }

  private async readPlayer(
    token: string | undefined,
  ): Promise<{ code: string; playerId: string } | null> {
    const payload = await this.verify(token);
    if (
      payload?.role !== "player"
      || typeof payload.code !== "string"
      || typeof payload.playerId !== "string"
    ) return null;
    return { code: payload.code, playerId: payload.playerId };
  }

  private cookie(name: string, value: string, maxAge: number): string {
    return serialize(name, value, {
      httpOnly: true,
      secure: this.secureCookies,
      sameSite: "strict",
      path: "/",
      maxAge,
    });
  }
}
