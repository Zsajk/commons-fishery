# Commons Fishery Game Rules

This document describes the rules enforced by the current server. Facilitators can change most numerical values, so a particular session may use different settings.

## Purpose

Commons Fishery is a participatory common-pool resource game. Each player is a fisher who gains privately by catching fish from a renewable population shared with their group. The exercise makes individual incentives, coordination, depletion, recovery, and competition between groups visible through play.

The game does not calculate or impose a cultural multilevel selection mechanism. Those dynamics can emerge from the combination of individual choices within groups and comparisons between groups.

## Roles and structure

- A facilitator creates games, configures rounds, starts the first season, and monitors progress.
- Players join a group with its code and remain in that group across prepared rounds.
- A game can contain one village or two villages. Each village has its own fishery and players can fish, research, and trade only within their village.
- A session can contain up to 30 simultaneous groups. Their results appear in a shared ranking.
- The projector lobby shows join codes and readiness. A game projector shows the current season and the feedback allowed by the facilitator.

## Starting and seasons

1. Players join during setup and press **Ready**.
2. The facilitator starts the first season. A three-second countdown appears.
3. The configured food cost is deducted from every player when Season 1 begins.
4. Players fish until the season timer expires, all active players run out of usable fuel, or the fishery collapses.
5. Between seasons, players may research, trade, and upgrade boats when those actions are enabled.
6. Players press **Ready** for the next season. When every eligible player is ready, fish reproduce, food is deducted, fuel resets, and the next season starts automatically after a three-second countdown.
7. The game ends after the configured final season or when every fishery has collapsed.

The facilitator starts only the first season. Later seasons advance automatically when all eligible players are ready.

## Fishing

Each catch:

- removes fish immediately from the selected station;
- adds the same number to the fisher's private balance;
- adds to the fisher's and station's extraction totals; and
- uses boat fuel when the game is fuel-limited.

There is no artificial delay between catches. Deciding whether to continue fishing is part of the exercise.

Players can fish only in their own village. A catch is limited by the boat's catch size and the fish actually remaining. A station at zero cannot be fished and never recovers.

### Season limits

- **Timer:** everyone can fish until the shared timer ends.
- **Fuel:** each trip uses the selected boat's fuel cost. The season ends when no active player has enough fuel for another trip.

## Food and balances

Food represents the fish each person needs to survive one season. It is deducted at the start of Season 1 and while preparing every later season.

A food payment may push a player's balance below zero. That player can continue fishing and recover during the season. A negative final balance is recorded as a food shortfall; a non-negative final balance is recorded as sustained.

Players cannot buy a boat, pay for research, or give away fish they cannot afford.

## Fish reproduction

Reproduction occurs once between seasons and is calculated separately for every station.

### No growth

```text
next = current
```

### Multiplier

```text
next = min(capacity, current * reproduction rate)
```

### Density-limited

```text
next = current + r * current * (1 - current / capacity)
```

The result is rounded and constrained between zero and capacity. In every model, zero remains zero.

When resource scaling is enabled, total capacity is:

```text
players in the village * capacity per player
```

This capacity is divided across the configured stations. Starting stock is the configured percentage of that capacity.

## Information and research

The facilitator chooses one feedback mode:

- **Hidden:** players are told only whether a station is depleted.
- **Qualitative:** players see Healthy, Strained, or Critical.
- **Exact:** current fish counts are visible, so research is unnecessary.

Research is available only when enabled and only during setup or between seasons. It reveals one exact snapshot of one station to that player. Each station can be researched once per player per season. The reading does not update while other people fish and is cleared when the next season is prepared.

Research can be free or cost a configured number of fish. With player-scaled resources, opening research during setup waits until the expected number of players has joined.

## Trading and boats

When trading is enabled, players may give a whole number of fish to another player in the same village between seasons. Trading does not create fish and both players must press **Ready** again after a transfer.

Boat upgrades are also available between seasons. A larger boat costs private fish and permanently increases catch size for the current round. Upgrades reset when the next prepared round begins.

## Collapse

A village collapses when the combined stock of all its stations reaches zero.

- Its fish cannot reproduce.
- Its players cannot fish, research, trade, or buy boats again in that round.
- Every player in that village immediately pays the food required for all remaining scheduled seasons.
- In a one-village game, collapse ends the round immediately.
- In a two-village game, the collapsed village observes while the other village continues. The round ends when the other village also collapses or completes the final season.

The immediate future-food charge makes the cost of losing the fishery visible even when someone extracted many fish shortly before collapse.

## Results and group ranking

Individual results show:

- total fish caught;
- boat purchases;
- final balance; and
- sustained or food shortfall.

The displayed group score is **total fish extracted**. Remaining fish are not added to the score.

The facilitator chooses how collapsed groups enter the ranking:

- **Include collapsed groups:** all groups are ordered by total extraction.
- **Exclude collapsed groups from winning:** surviving groups are ranked above collapsed groups, then ordered by total extraction. Collapsed groups remain visible and marked as collapsed.

If extraction totals are equal, a group that collapsed later ranks above one that collapsed earlier. A round marked unscored does not appear in the group ranking.

## Prepared rounds

A session can contain any number of editable rounds. Group membership and join codes remain stable. Preparing the next round resets balances, boats, stations, seasons, and current actions while preserving completed results.

Future round settings are not sent to player devices before the round begins.
