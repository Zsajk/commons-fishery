# Contributing to Commons Fishery

Thanks for helping improve Commons Fishery. Changes should keep the game understandable for non-experts, reliable on participant phones, and faithful to the documented game rules.

## Before you begin

- Search existing issues before opening a new one.
- Open an issue before making a substantial mechanics or session-flow change.
- Do not include participant data, facilitator PINs, session secrets, or production game files.
- Keep interface changes usable on both mobile and projector-sized screens.

## Local setup

```bash
git clone https://github.com/Zsajk/commons-fishery.git
cd commons-fishery
npm ci
npm run dev
```

The local facilitator PIN defaults to `workshop`. Use `.env.example` when testing production-style configuration.

## Required checks

Run the checks relevant to your change before opening a pull request:

```bash
npm run check
npm test
npm run build
```

For participant, facilitator, timing, or WebSocket changes, also run:

```bash
npx playwright install chromium
npm run test:e2e
```

For changes that affect multi-group scale or real-time actions, run `npm run smoke:workshop` as well.

## Mechanics changes

The current behavior is specified in [docs/GAME_RULES.md](docs/GAME_RULES.md). A mechanics change should include focused engine or action tests and an update to that document. Facilitator workflow changes should also update [docs/FACILITATOR_GUIDE.md](docs/FACILITATOR_GUIDE.md).

Avoid silently changing preset meaning, scoring, collapse behavior, food timing, or reproduction formulas. Those choices affect the lesson participants experience.

## Pull requests

Keep pull requests focused. Describe the participant-visible effect, the facilitator-visible effect, and how the change was tested. Screenshots are useful for layout changes; do not include real session names or participant identities.

By contributing, you agree that your contribution may be distributed under the repository's MIT License.
