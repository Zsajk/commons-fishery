# Facilitator Guide

This guide covers the normal multi-group session flow. See the project README for installation and deployment.

## Before a session

1. Open `/host` and enter the facilitator PIN.
2. Choose a session name, number of groups, fishers per group, and one or two villages.
3. Add, remove, and reorder rounds as needed.
4. Choose a preset for each round, then fine-tune its timer or fuel, food, fish capacity, reproduction, information, research, trading, and ranking settings.
5. Create the session. Every group receives one stable join code.
6. Open **Lobby** on the projector. Keep the facilitator dashboard open in another tab.

The generated group codes are intended to be shared only with participants. Use first names, initials, or pseudonyms rather than sensitive personal information.

## Starting a round

1. Participants open the site, enter their group code, choose a display name, and select a village when applicable.
2. The lobby shows joined and ready counts for every group.
3. Ask every participant to press **Ready**.
4. When every configured place is filled and ready, press **Start all groups** once.
5. Every group receives the same three-second countdown.

The facilitator starts only the first season of a round. After that, each group advances independently when all active players in that group press **Ready**.

## During play

The facilitator dashboard shows exact stocks, catches, player balances, readiness, and recent activity regardless of the feedback shown to participants.

- Timer-limited seasons pause automatically when time reaches zero.
- Fuel-limited seasons pause when no active player can afford another trip.
- A collapsed village stops playing for that round.
- **End game** is an override for a room that must be stopped early.

Players may continue with a negative balance. Do not remove them; their final outcome records whether they recovered.

## Between seasons

Players can use any enabled research, trade, and boat actions, then press **Ready**. An action that changes a player's situation clears that player's ready state.

When everyone eligible is ready, the server automatically:

1. reproduces fish;
2. deducts food;
3. resets fuel and research observations;
4. advances the season; and
5. starts after a three-second countdown.

## Finishing and ranking

At the end of a round, open **Ranking** on the projector. The main group score is total fish extracted. Each group also shows whether its fishery survived, when it collapsed, and how many people finished with a non-negative balance.

When all groups have ended and another round is prepared, press **Prepare next round**. Players keep the same codes and devices. They press **Ready** again before the facilitator launches the new round.

## Testing without a group

Create one group with one expected player. Keep the facilitator dashboard in one browser window and open the participant link in a private window or another browser. You can then test the complete ready, start, fish, research, season, collapse, and result flow yourself.

For a larger automated check, keep the local server running in another terminal and run:

```bash
npm run smoke:workshop
```

This creates six temporary groups, joins thirty simulated players, performs simultaneous catches, checks the resulting stocks, and removes the temporary games.

## Suggested rehearsal

Before using new parameters with participants:

1. Run one short round with one or two testers.
2. Confirm that the fishery can collapse but is not predetermined to do so.
3. Check that food and research costs are visible on participant devices.
4. Verify the projector at the actual room resolution.
5. Run the thirty-player smoke test against the deployment.

Presets are starting points, not guarantees. Player speed, communication, and group size can substantially change the outcome.

## Operational notes

- The AWS Docker setup keeps active state in a persistent `game_data` volume.
- Keep one application replica when using file storage.
- Back up the Docker volume before a high-stakes event or use PostgreSQL for managed persistence.
- The facilitator PIN is shared administrative access. Change it between public events if it has been widely distributed.
- Projector and session-lobby tabs must be opened from a browser with an active facilitator session.
- If a player changes browser or clears cookies after a game starts, the server cannot reconnect that browser to the existing player identity automatically.
