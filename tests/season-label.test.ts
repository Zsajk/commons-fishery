import { describe, expect, it } from "vitest";
import { participantSeasonLabel } from "../src/seasonLabel.js";

describe("participant season labels", () => {
  it("shows or hides the remaining season horizon", () => {
    expect(participantSeasonLabel(2, 5, false)).toBe("Season 2");
    expect(participantSeasonLabel(2, 5, true)).toBe("Season 2 of 5 · 3 remaining");
    expect(participantSeasonLabel(5, 5, true)).toBe("Season 5 of 5 · final season");
  });
});
