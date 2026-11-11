# Loaded Dice — Master Specification

> **Note:** This is the design spec from the private build. References to `fragments/`, `HANDOFF.md` and `DECISIONS.md` point to internal planning files that are not part of this public repo.

**Status:** Source of truth. Supersedes all prior numbered docs (00–12) from the original doc set.
If any other file in this repo contradicts this one, this one wins. If this file needs to change,
edit it directly and log the change in `DECISIONS.md` — don't let a fragment silently diverge.

Any session working on this project reads this file in full before writing code, every time.
Never invent rules, powers, thresholds, or win conditions not listed here. If something is
ambiguous and not covered here, stop and add a question to `DECISIONS.md` under "Open Questions"
rather than guessing.

---

## 1. What this game is

Loaded Dice is a realtime multiplayer social deduction game for 5–10 players. It is a direct
mechanical reskin of the party game *Secret Hitler* (design by Mike Boxleiter, Tommy Maranges,
and Max Temkin), rethemed around the Mahabharata, specifically the Kaurava court and Shakuni's
manipulation of the dice game that triggers the epic's central war. The rules, thresholds, role
counts, and win conditions below are mechanically identical to Secret Hitler's official ruleset.
Only names, flavor text, and visual theme differ. This is built for personal/portfolio use, not
commercial release — see `DECISIONS.md` for the licensing note on why that distinction matters.

---

## 2. Theme mapping

Every mechanical concept below has a canonical themed name. Use these names consistently in code
(enum values, event names, UI strings) — do not mix "Fascist" and "Kaurava" in the same layer.

| Mechanical concept (Secret Hitler)      | Themed name (Loaded Dice)            | Short code |
|------------------------------------------|----------------------------------------|------------|
| Liberal (team/role)                      | Pandava                                | `PANDAVA`  |
| Fascist (team/role)                      | Kaurava                                | `KAURAVA`  |
| Hitler (role)                            | Duryodhana                             | `DURYODHANA` |
| Liberal Policy                           | Dharma Decree                          | `DHARMA`   |
| Fascist Policy                           | Adharma Decree                         | `ADHARMA`  |
| President                                | Maharaj                                | —          |
| Chancellor                               | Senapati                               | —          |
| Presidential Candidate                   | Maharaj Candidate                      | —          |
| Chancellor Candidate                     | Senapati Candidate                     | —          |
| Election                                 | Rajya Sabha (Council)                  | —          |
| Legislative Session                      | Shastra Sabha (Decree Session)         | —          |
| Executive Action                         | Rajaagna (Royal Command)               | —          |
| Investigate Loyalty (power)              | Divya Drishti (Divine Sight)           | —          |
| Special Election (power)                 | Rajya Sabha Summons                    | —          |
| Policy Peek (power)                      | Akashvani (Celestial Foresight)        | —          |
| Execution (power)                        | Vanvas (Exile)                         | —          |
| Veto Power                               | Shakuni's Dice                         | —          |
| Election Tracker chaos (3 rejections)    | Kurukshetra Anarchy                    | —          |
| Policy deck                              | Decree Deck                            | —          |
| Discard pile                             | Ash Pile                               | —          |
| Term limit                               | Rajya Maryada (Court Restriction)      | —          |

Player-facing copy uses the themed names. Internal enums/types should use the short codes above
(`PANDAVA` / `KAURAVA` / `DURYODHANA`) for team/role to avoid ambiguity in code review — see
`12-coding-standards.md` (superseded content folded into this spec's Section 8).

---

## 3. Roles, setup, and team knowledge

| Players | Pandavas | Kauravas (excl. Duryodhana) | Duryodhana knows Kauravas? |
|---------|----------|------------------------------|------------------------------|
| 5       | 3        | 1                             | Yes                           |
| 6       | 4        | 1                             | Yes                           |
| 7       | 4        | 2                              | No                            |
| 8       | 5        | 2                              | No                             |
| 9       | 5        | 3                              | No                             |
| 10      | 6        | 3                              | No                             |

Rules:
- Duryodhana is on the Kaurava team but does **not** automatically know the other Kauravas when
  players ≥ 7. Kauravas always know each other and know who Duryodhana is, regardless of player count.
- Pandavas know nothing about anyone else's role at game start.
- **Optional rebalance** (host-configurable toggle, default OFF unless host enables):
  - 6 players: game starts with 1 Adharma Decree pre-enacted.
  - 7 players: Decree Deck starts with 10 Adharma tiles instead of 11.
  - 9 players: Decree Deck starts with 9 Adharma tiles instead of 11.
  - This must be a room-creation setting stored per-Room, not a global constant, since hosts may
    want either mode.

Deck composition (fixed, not player-count-dependent): **11 Adharma Decree tiles, 6 Dharma Decree
tiles** = 17 total, shuffled into the Decree Deck at game start (before any rebalance adjustment
is applied per the table above).

---

## 4. Win conditions

**Pandava victory** (check immediately when triggered, ends game synchronously):
- 5 Dharma Decrees enacted, OR
- Duryodhana is exiled (Vanvas) via the Execution power, regardless of decree counts.

**Kaurava victory** (check immediately when triggered, ends game synchronously):
- 6 Adharma Decrees enacted, OR
- Duryodhana is elected Senapati (Chancellor) at any point **after** the 3rd Adharma Decree has
  already been enacted (not counting the decree that triggers this election — the 3rd Adharma
  Decree must already be on the board before this election's vote resolves).

Important precision points (explicit, because these are easy to get wrong in implementation):
- The Duryodhana-as-Senapati win check happens at the moment a government is confirmed by
  majority-yes vote, not at nomination. A rejected vote never triggers it.
- If Duryodhana is elected Maharaj (President) at any point, the game continues normally —
  only election *as Senapati* matters for this win path, and only post-3rd-Adharma-Decree.
- The Vanvas (execution)-of-Duryodhana win check happens the instant the Maharaj selects
  Duryodhana as the execution target — the game ends before any further action, and no other
  player's role is revealed as a result.
- If a non-Duryodhana Kaurava is exiled, the game continues; no team affiliation is revealed to
  the table (see Section 5.7, Executive Actions → Vanvas).

---

## 5. Game flow / state machine

Canonical states (supersedes `03-state-machine.md`):

```
LOBBY
  -> ROLE_REVEAL
  -> ELECTION_NOMINATION
  -> ELECTION_VOTING
  -> (on reject) -> ELECTION_NOMINATION  [next Maharaj Candidate, tracker +1]
  -> (on reject, tracker hits 3) -> KURUKSHETRA_ANARCHY -> ELECTION_NOMINATION [tracker resets]
  -> (on accept) -> LEGISLATION_MAHARAJ
  -> LEGISLATION_SENAPATI
  -> (if decree grants a Rajaagna power) -> EXECUTIVE_ACTION -> ELECTION_NOMINATION
  -> (if decree grants no power) -> ELECTION_NOMINATION
  -> GAME_OVER (reachable from: decree count win, Duryodhana Vanvas, Duryodhana elected Senapati
     post-3rd-Adharma, or host force-end)
```

### 5.1 LOBBY
- Host creates room, gets room code. Players join with display name.
- Host can toggle rebalance setting (Section 3) while in LOBBY only.
- Minimum 5, maximum 10 players to start. Host-only "Start Game" action, disabled outside 5–10.
- On start: shuffle roles per Section 3 table, shuffle Decree Deck per Section 3 composition,
  assign first Maharaj Candidate uniformly at random.

### 5.2 ROLE_REVEAL
- Each player privately sees: their own role, their team (Pandava/Kaurava), and — if applicable —
  the other Kauravas' identities (per the knowledge table in Section 3).
- Duryodhana, when not shown other Kauravas (7+ players), sees only their own role.
- This is a per-player private state push, never broadcast. Advance to ELECTION_NOMINATION once
  all players have acknowledged (client sends "seen" event) or after a fixed timeout (default 15s;
  see Section 7, Architecture → Socket API, and `fragments/03-socket-api.md` for the exact event).

### 5.3 ELECTION_NOMINATION
- Current Maharaj Candidate selects any eligible player as Senapati Candidate.
- **Eligibility** (Rajya Maryada / term limits):
  - The most recently *elected* Maharaj and Senapati (i.e., the pair from the last successful
    vote, not the last nominated pair) are ineligible to be nominated as Senapati Candidate.
  - Exception: if exactly 5 players remain alive in the game, only the most recently elected
    Senapati is ineligible — the most recent Maharaj may be nominated again.
  - Term limits restrict Senapati nomination only. Anyone, including a just-served Senapati, may
    become Maharaj Candidate through normal rotation or a Rajya Sabha Summons.
  - A Rajya Sabha Summons (Special Election) can nominate a term-limited player as the next
    Maharaj Candidate — that power explicitly overrides term limits for the Maharaj seat only.

### 5.4 ELECTION_VOTING
- All living players vote Ha (yes) / Nahi (no) simultaneously; votes are hidden until all are in,
  then revealed together.
- Majority yes (strictly more than half of living players) → government confirmed, proceed to
  LEGISLATION_MAHARAJ. Tie or majority-no → rejected.
- On rejection: Election Tracker +1. Maharaj placard moves to next living player in rotation
  (never skips players, including ones marked term-limited — term limits only block Senapati
  nomination, not Maharaj rotation).
- **Kurukshetra Anarchy**: if the Election Tracker reaches 3 (three consecutive rejected
  governments), immediately:
  1. Top tile of Decree Deck is auto-enacted (reshuffle Ash Pile into deck first if fewer than 1
     tile remains, per Section 5.6).
  2. Any Rajaagna power that decree would normally grant is skipped entirely — no Executive
     Action phase occurs for an anarchy-enacted decree.
  3. Election Tracker resets to 0.
  4. All existing Rajya Maryada (term limit) restrictions are cleared.
  5. Maharaj placard advances to the next living player normally, proceed to
     ELECTION_NOMINATION.
- **Any** decree enactment, for any reason (normal legislative session or anarchy), resets the
  Election Tracker to 0.
- On accept: Duryodhana-as-Senapati win check runs here (Section 4) before proceeding to
  legislative session. If it doesn't trigger, proceed normally.

### 5.5 LEGISLATION_MAHARAJ
- Maharaj privately draws top 3 tiles from Decree Deck, discards 1 face-down to Ash Pile, passes
  remaining 2 to Senapati.
- Maharaj and Senapati's chat/communication channel is restricted during this phase — see
  Section 9 (Security) for exact enforcement; other players are not shown the tiles at any point.

### 5.6 LEGISLATION_SENAPATI
- Senapati privately receives 2 tiles, discards 1 face-down to Ash Pile, enacts the remaining
  tile (places it face-up on the corresponding track).
- **Deck reshuffle rule**: if, at the start of *either* draw step (Maharaj's draw-3 or a
  Kurukshetra Anarchy top-tile draw), the Decree Deck has fewer tiles remaining than required,
  shuffle the Ash Pile back into the Decree Deck to replenish before drawing. Discarded tiles are
  never revealed to the table, including after reshuffle.
- **Shakuni's Dice (Veto Power)**: unlocked permanently once the 5th Adharma Decree has been
  enacted. From that point on, during every subsequent Legislative Session: after the Senapati
  receives their 2 tiles, the Senapati may propose a veto instead of discarding/enacting. If
  proposed, both Maharaj and Senapati vote privately to agree/disagree. If both agree, both tiles
  are discarded face-down with no decree enacted, and this counts as an inactive government for
  Election Tracker purposes (tracker +1, same as a rejected vote — but this does NOT count toward
  Kurukshetra Anarchy's "3 rejected governments," which counts only failed elections; keep these
  as two separate named counters — see `DECISIONS.md` entry on this if ambiguity arises during
  implementation). If either disagrees, the Senapati must proceed with a normal discard/enact.
- After enactment (by any path), check decree-count win conditions (Section 4) immediately. If
  none triggered, check whether the enacted decree grants a Rajaagna power (Section 5.7) — if
  yes, go to EXECUTIVE_ACTION; if no, return to ELECTION_NOMINATION with Maharaj placard
  advancing to the next living player in rotation.

### 5.7 EXECUTIVE_ACTION (Rajaagna)
Power granted depends on which Adharma Decree track position was just filled and player count —
this mapping must come from the standard Secret Hitler power table for the given player count,
which the implementing session must pull from `fragments/` power-table data, not improvise. Do
not hardcode a single fixed mapping in this spec file; player-count-dependent power tracks are
data, not narrative rules, and belong in a config fragment (see `fragments/04-power-table.md`).

The four Rajaagna powers (mechanically identical to Secret Hitler, themed names apply):
- **Divya Drishti (Investigate Loyalty)**: Maharaj picks a player, privately sees their team
  affiliation only (Pandava/Kaurava — never "Duryodhana" specifically, even if investigating
  Duryodhana; Duryodhana's team shows as Kaurava). Maharaj may share or lie about the result to
  the table; the game does not enforce truthful disclosure. Each player may be investigated at
  most once per game, ever — track this per-player, not per-Maharaj.
- **Rajya Sabha Summons (Special Election)**: Maharaj picks any other living player (including
  term-limited players) to become the next Maharaj Candidate immediately, bypassing normal
  rotation. This does not skip anyone in the rotation order — after this special-election round
  resolves (accept or reject), the Maharaj placard returns to the player immediately after the
  Maharaj who called the summons (not after the special-election Maharaj), and normal rotation
  resumes from there.
- **Akashvani (Policy Peek)**: Maharaj privately views the top 3 tiles of the Decree Deck in
  current order, without altering order, then proceeds to ELECTION_NOMINATION (no other effect).
- **Vanvas (Execution)**: Maharaj selects a living player to exile. That player is immediately
  removed from active play: can no longer vote, be nominated, or send in-game chat, but may
  remain connected as a spectator. If the exiled player is Duryodhana, Pandava victory triggers
  immediately (Section 4). Otherwise, the exiled player's team is never revealed to the table by
  the system — only what other players choose to say aloud/in chat reveals anything.
- Each power is single-use per trigger; it does not persist or roll over. After resolving the
  power, always return to ELECTION_NOMINATION with Maharaj placard advancing normally (Rajya
  Sabha Summons is the only power with the special placard-return rule above).

### 5.8 GAME_OVER
- Triggered per Section 4 win conditions, or by host force-end (see Section 9, Security, for who
  is authorized to force-end).
- On game over: reveal all roles to all players (including spectators/exiled players), display
  win condition that triggered, freeze all further actions, persist final GameEvents log and a
  Snapshot (Section 6 data model) for post-game review.

---

## 6. Data model

Supersedes `05-database.md`. Core entities:

- **Room**: id, room_code (short human-shareable), host_player_id, status (LOBBY/IN_PROGRESS/
  GAME_OVER/ABANDONED), rebalance_enabled (bool), created_at, settings (player count bounds,
  timeouts).
- **Player**: id, room_id, session_id (see Session below), display_name, connection_status
  (CONNECTED/DISCONNECTED/RECONNECTING), seat_order (int, fixed at game start for rotation),
  is_alive (bool, false once exiled), joined_at.
- **Session**: id, player_id, socket_id (nullable — null when disconnected), auth_token (opaque,
  see Section 9), last_seen_at. A Session outlives socket disconnects; reconnect logic re-attaches
  a new socket_id to the existing Session/Player rather than creating a new Player. This is the
  primary mechanism for the reconnect edge cases in `EDGE-CASES.md` (see its "Connection /
  reconnect" and "Socket / transport / packet integrity" sections).
- **GameEvents**: append-only event log, one row per authoritative state transition (vote cast,
  decree drawn/discarded/enacted, power used, phase transition, player exiled, game over). Used
  for: replay/audit, reconnect state resync, anti-cheat verification, and is the only source
  clients should trust over locally-cached state.
- **Snapshot**: periodic (or phase-boundary) serialized full GameState, keyed by room_id + a
  monotonically increasing version number. Used to fast-resync a reconnecting client without
  replaying the full GameEvents log from game start, and as a recovery point if event replay
  logic has a bug — snapshots are the safety net, not the primary sync mechanism.

Full field-level schema (columns, types, indices, Drizzle schema code) is a fragment, not part of
this spec file — see `fragments/02-database-schema.md`.

---

## 7. Architecture

Supersedes `04-architecture.md`, `06-api.md`, `07-frontend.md`, `08-backend.md`.

- **Game Engine**: pure, deterministic TypeScript module with zero I/O (no sockets, no DB, no
  Date.now() without injection, no Math.random() without an injected seeded RNG). Takes
  `(currentState, action) -> newState` and is the only place game rules are evaluated. Fully unit
  testable without any of backend/frontend/DB existing. This is the load-bearing architectural
  decision in the whole project — protect its purity aggressively; see Section 8 (Coding
  standards) and `fragments/01-game-engine-core.md`.
- **Backend**: Express + Socket.IO + Drizzle, thin orchestration layer. Receives Socket.IO
  events, validates with Zod, loads current GameState (from DB or in-memory cache keyed by
  room_id), calls the pure Game Engine, persists resulting GameEvents + updated state, broadcasts
  resulting per-player views back over sockets. The backend must never contain game rule logic
  itself — if a rule check is being written in a Socket.IO handler instead of the engine, that's
  a design violation, stop and move it.
- **Frontend**: React + Vite + Zustand + Tailwind. Zustand store mirrors last-known server-pushed
  state; frontend never computes win conditions, phase transitions, or role information itself —
  it only renders what the server sends and sends player intents (vote, nominate, discard-choice)
  as Socket.IO events.
- **Socket API**: Socket.IO events, every inbound event payload validated with Zod before
  reaching the backend orchestration layer or engine. Reject and log (don't crash) on validation
  failure. Full event contract (event names, payload schemas) is `fragments/03-socket-api.md`.
- **Deployment**: Frontend on Vercel, Backend on Railway, DB on Supabase (Postgres). See
  `fragments/09-deployment.md` for environment/config specifics.

---

## 8. Coding standards (supersedes `12-coding-standards.md`)

- Strict TypeScript everywhere. `strict: true` in tsconfig. No `any` — use `unknown` + narrowing,
  or generics, when the type is genuinely not known ahead of time.
- Game Engine package has zero runtime dependencies beyond pure logic helpers (no lodash-as-crutch,
  no date libraries, no uuid unless deterministically seeded/injected).
- All engine functions are pure: same input always produces same output, no hidden state, no
  mutation of input arguments (return new state objects).
- Randomness (deck shuffle, role assignment, first-Maharaj pick) must go through a single injected
  RNG interface so games are replayable/testable with a fixed seed. Never call `Math.random()`
  directly inside the engine.
- Naming: use the theme's short codes (`PANDAVA`/`KAURAVA`/`DURYODHANA`, `DHARMA`/`ADHARMA`) for
  enum/type-level code. Player-facing strings use full themed names from Section 2's table.
- Every engine state transition must have a corresponding unit test asserting both the happy path
  and at least one relevant edge case from `EDGE-CASES.md`.

---

## 9. Security (supersedes `09-security.md`)

- Server is fully authoritative. No game-relevant decision (whose turn, what cards were drawn,
  who voted what, who's on which team) is ever trusted from the client — client sends *intents*,
  server (via engine) computes truth.
- Per-player view filtering: the server must never broadcast a full GameState containing hidden
  information (other players' roles, undiscarded decree tiles, investigation results not owned
  by the requester) to a socket that isn't authorized to see it. This filtering happens
  server-side before emit, not client-side after receipt — a malicious client reading raw socket
  traffic must not be able to see others' secret info.
- Maharaj/Senapati chat restriction during LEGISLATION_MAHARAJ/LEGISLATION_SENAPATI (Section 5.5)
  is enforced server-side by rejecting/dropping chat-send events from other players' sockets
  during that phase, not merely hidden in the UI.
- Every inbound Socket.IO event validated with Zod before touching engine or DB (Section 7).
- Auth: session token (Section 6, Session entity) issued on join, required on reconnect to
  re-attach to the correct Player. Token should be opaque and unguessable (not sequential/derived
  from player_id). Exact token generation/rotation mechanics: `fragments/07-auth.md`.
- Rate-limit vote/action submission per socket to prevent spam-triggering re-validation cycles;
  exact limits: `fragments/08-rate-limiting.md`.

---

## 10. Testing (supersedes `10-testing.md`)

- Unit-first, engine coverage is the priority: every state transition function in the Game
  Engine needs tests before backend integration work touching that transition is considered
  done.
- Edge cases in `EDGE-CASES.md` are not optional extra-credit tests — each one tagged to a
  fragment must have a corresponding test in that fragment's test suite before the fragment is
  marked DONE in `HANDOFF.md`.
- Simulation/fuzz testing: because the Game Engine is pure and fully RNG-injected (Section 7/8),
  it can be driven end-to-end by virtual players with scripted or randomized decision policies,
  entirely in-process, with invariants (`EDGE-CASES.md` Section 23) checked after every
  transition across many complete games. This is a distinct layer from hand-written unit tests —
  it's how edge cases nobody thought to write a test for in advance get discovered. See
  `fragments/15-simulation-harness.md`. Any edge case this harness discovers must graduate into a
  named row in `EDGE-CASES.md`, the same as a hand-authored one — a bug found by simulation isn't
  informally "known," it's written down.
- Integration tests (Socket.IO handler -> engine -> DB round trip) come after engine unit tests
  are solid for the phase being integrated, not before.
- No fragment is DONE without tests passing; "I'll add tests later" is not an acceptable fragment
  completion state — see `HANDOFF.md` definition of done.

---

## 11. Deployment (supersedes `11-deployment.md`)

Frontend → Vercel, Backend → Railway, DB → Supabase. Environment variable contracts, CI/CD
pipeline specifics, and migration workflow are `fragments/09-deployment.md` — this section only
fixes the *choice* of platforms, not the operational detail.

---

## 12. Roadmap (supersedes `13-roadmap.md`)

Milestones are now expressed as fragment groups in `HANDOFF.md` rather than milestone names.
Rough shape, in dependency order:
1. Game Engine core (state machine skeleton + role/setup + all phase transitions, pure, fully
   unit tested) — nothing else can be meaningfully built before this is solid.
2. Database schema + migrations.
3. Socket API contract + backend orchestration wiring the engine to sockets/DB.
4. Auth/session/reconnect handling.
5. Frontend: lobby → role reveal → core game loop UI.
6. Security hardening pass (server-authoritative filtering audit, rate limiting).
7. Edge-case hardening pass (explicit test-by-test walk through `EDGE-CASES.md`).
8. Deployment pipeline + polish.

This is intentionally not a task list — `HANDOFF.md` + `fragments/` is the actual backlog. This
roadmap exists only to explain *why* the fragments are ordered the way they are.

---

## 13. Relationship to old docs

`00` through `13` (the original numbered doc set from an earlier planning pass) are considered
superseded by this file. `14-edge-cases.md` is superseded/expanded by `EDGE-CASES.md` at the repo
root. `15-tasks.md` is superseded by `HANDOFF.md` + `fragments/`. If those original numbered docs
aren't present in this copy of the repo, that's expected — they were an earlier draft and were
never required reading; everything load-bearing from them has already been folded into this file.
`AGENTS.md` at the repo root is read automatically by Cursor and says, in short: **always start
at `HANDOFF.md`, follow it to the current fragment, treat this master spec as the immovable rules
source, never invent anything not written down here or in the fragment you're building.**
