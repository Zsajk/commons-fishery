import { describe, expect, it } from "vitest";
import { AuthService } from "../server/auth.js";

const secret = "a-secure-test-session-secret-with-32-characters";

function cookieHeader(setCookie: string): string {
  return setCookie.split(";", 1)[0];
}

describe("browser authorization", () => {
  it("uses constant-time PIN verification and an HTTP-only facilitator cookie", async () => {
    const auth = new AuthService("482731", secret, true);
    expect(auth.verifyFacilitatorPin("482731")).toBe(true);
    expect(auth.verifyFacilitatorPin("482730")).toBe(false);

    const cookie = await auth.createFacilitatorCookie();
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    expect((await auth.readAuthorization(cookieHeader(cookie))).facilitator).toBe(true);
  });

  it("binds a player cookie to one player in one room", async () => {
    const auth = new AuthService("482731", secret, false);
    const cookie = await auth.createPlayerCookie("WATER123", "player-1");
    const authorization = await auth.readAuthorization(cookieHeader(cookie));
    expect(authorization).toEqual({
      facilitator: false,
      player: { code: "WATER123", playerId: "player-1" },
    });
  });

  it("rejects a cookie signed with another secret", async () => {
    const issuer = new AuthService("482731", secret, false);
    const verifier = new AuthService("482731", "another-secure-session-secret-with-32-characters", false);
    const cookie = await issuer.createFacilitatorCookie();
    expect((await verifier.readAuthorization(cookieHeader(cookie))).facilitator).toBe(false);
  });
});
