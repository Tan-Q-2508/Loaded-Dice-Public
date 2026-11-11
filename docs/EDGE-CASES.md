# Edge Cases — Loaded Dice (v2)

> **Note:** This is the design spec from the private build. References to `fragments/`, `HANDOFF.md` and `DECISIONS.md` point to internal planning files that are not part of this public repo.

Supersedes `14-edge-cases.md` and the v1 `EDGE-CASES.md`. Every row here must have a
corresponding test before the tagged fragment is marked DONE (see `00-MASTER-SPEC.md` Section
10, `HANDOFF.md` definition of done).

**Provenance note:** this file merges an original pass with a second, independently-produced
edge-case pass (110 items, "EC-001"–"EC-110" style, external to this repo's numbering). Where the
two passes covered the same scenario, they're merged into one row under this file's numbering.
Where the external pass proposed a resolution that conflicts with `00-MASTER-SPEC.md`'s actual
game rules, the conflict is called out explicitly rather than silently adopted (see "Rejected /
modified external resolutions" at the end). Nothing here should be treated as re-deriving the
external source's authority — `00-MASTER-SPEC.md` remains the single rules source of truth.

Format: `ID | Scenario | Required behavior | Fragment`

---

## 0. Illegal-state & room-failure policy (read first — referenced throughout)

The external pass used "terminate room" or "freeze room" as the resolution for ~35 distinct
scenarios without ever defining what that means for connected players, or distinguishing
recoverable corruption from unrecoverable corruption. That's a real gap. This section fixes it;
every row below that says "terminate" or "freeze" means exactly this unless the row overrides it.

- **FREEZE**: the room stops accepting new game actions (votes, nominations, decree choices,
  power use). Existing connections stay open. All connected players are pushed an explicit
  `ROOM_FROZEN` event with a human-readable reason category (not raw internal error text) and a
  server-side incident is logged with full internal detail (state snapshot, last N events,
  invariant that failed). A frozen room is NOT automatically deleted — it's held for manual/
  automated postmortem per `fragments/06-backend-orchestration.md`, then either recovered (if a
  fix/replay resolves it) or explicitly archived as FAILED.
- **TERMINATE**: stronger than freeze — used only for invariant violations that mean the
  authoritative state itself cannot be trusted (e.g. two Maharajs, negative deck size). Same
  player-facing behavior as FREEZE (`ROOM_FROZEN` event, connections stay open so players aren't
  silently kicked), but the room is marked `CORRUPTED` rather than recoverable-frozen, and is
  never resumed — only archived after incident capture. The distinction from FREEZE is about
  whether resumption is ever attempted, not about what the player sees in the moment.
  Players see the same message either way: **the game cannot continue, here's why, thanks for
  playing** — never a raw stack trace or internal state dump.
- **What players are never shown**: internal invariant names, stack traces, DB error text, or any
  hidden-role information as a side effect of an error message. An error path is not an exemption
  from Section 11's hidden-information rules.
- **Escalation**: every FREEZE/TERMINATE increments a room-failure counter surfaced to
  whatever lightweight ops visibility exists (see EC-R01 below) — silent failures with no
  operator ever finding out are themselves a failure mode.

| ID | Scenario | Required behavior | Fragment |
|----|----------|---------------------|----------|
| EC-R01 | A room is FROZEN or TERMINATEd | No operator/dev-facing visibility exists to notice this happened | Emit a structured log/metric on every FREEZE/TERMINATE (room id, invariant violated, timestamp, last-known-good snapshot version); a minimal `/admin` or log-based view of currently-frozen rooms is in scope for `fragments/06-backend-orchestration.md`, not a "someday" nice-to-have | 06-backend-orchestration |
| EC-R02 | A FROZEN room's underlying bug gets fixed mid-incident | Whether/how a frozen (not corrupted) room can be resumed from its last good snapshot must be an explicit, deliberately-built recovery path, not a manual DB edit improvised under pressure | 06-backend-orchestration |

---

## 1. Room lifecycle

| ID | Scenario | Required behavior | Fragment |
|----|----------|---------------------|----------|
| EC-01 | Generated room code collides with an existing one | Retry generation until unique; abort with a clear server error after a small configurable retry limit (don't loop forever) | 05-lobby |
| EC-02 | Host disconnects before anyone else joins | Room held for a bounded grace period (exact duration: `DECISIONS.md` open question); if host doesn't reconnect in that window, room is deleted, not left orphaned forever | 05-lobby |
| EC-03 | Host explicitly leaves (or times out per EC-02/EC-33) the lobby | Oldest-connected remaining player becomes host automatically; this is the adopted resolution — see "Rejected/modified" note at the end | 05-lobby |
| EC-04 | All players leave/disconnect from a room | LOBBY-phase room: delete after short idle timeout. IN_PROGRESS room: preserve for the reconnect window rather than deleting — a mid-game room with zero current sockets is not the same as an abandoned lobby. GAME_OVER room: archive, then clean up on the normal retention schedule | 05-lobby / 04-reconnect |
| EC-05 | Scheduled cleanup job runs while a room is ACTIVE, PAUSED, mid-reconnect-window, or FROZEN | Cleanup must explicitly exclude these statuses; only ARCHIVED or explicitly EXPIRED (per EC-04's lobby-idle case) rooms are eligible for deletion — this must be a positive allowlist in the cleanup query, not a denylist that's easy to under-specify | 02-database-schema |

---

## 2. Joining / lobby membership

| ID | Scenario | Required behavior | Fragment |
|----|----------|---------------------|----------|
| EC-06 | Duplicate display name, differing only by case (`Alice` vs `alice`) | Case-insensitive uniqueness check at join time | 05-lobby |
| EC-07 | Unicode confusable / lookalike display names (e.g. Cyrillic homoglyphs visually matching Latin letters) intended to impersonate another player | Normalize (NFKC or similar) before the uniqueness check; reject a new join whose normalized form collides with an existing normalized name, even if raw bytes differ | 05-lobby |
| EC-08 | Player refreshes the browser tab while mid-join (before game start) | Reconnect to the same Player row via session token; never create a duplicate Player for the same session | 04-reconnect / 05-lobby |
| EC-09 | Room already at 10 players, join attempted | Reject at the join layer with a clear error, never silently drop or truncate | 05-lobby |
| EC-10 | Join attempted on a room already IN_PROGRESS | Reject with a clear error; spectator-join, if ever supported, is a separate explicit feature, not a fallback for a rejected player join | 05-lobby |
| EC-11 | Invalid/expired invite or room code entered | Reject immediately with a clear, non-revealing error (don't distinguish "wrong code" vs "expired" vs "wrong game" in ways that let someone enumerate valid codes) | 05-lobby |
| EC-12 | Player leaves lobby explicitly (not disconnect) before game start | Seat freed; whether `seat_order` is compacted or left sparse is an explicit decision for `fragments/05-lobby.md` (affects rotation-order assumptions downstream) | 05-lobby |

---

## 3. Authentication / session tokens

| ID | Scenario | Required behavior | Fragment |
|----|----------|---------------------|----------|
| EC-13 | Reconnect token is guessed, leaked, or stolen | Token must be high-entropy (256-bit class) and unguessable; rotate the token on every successful reconnect and invalidate the previous value immediately, so a leaked-but-already-used old token stops working | 07-auth |
| EC-14 | Reconnect attempted with an expired token | Reject the reconnect attempt with a clear "session expired" error distinct from "wrong token" only insofar as it doesn't leak whether *a* valid session ever existed for that code | 07-auth |
| EC-15 | Client holds stale cached game state from a previous session/tab | Server state always wins on reconnect/resync; client-cached state is a rendering optimization only, never a source of truth the server defers to | 03-socket-api |
| EC-16 | Player opens the game in two tabs/devices with the same session token | Newest successful connection becomes the writable one for that Player; older sockets for the same Player are demoted to read-only (they keep receiving broadcast state but any action they submit is rejected) rather than being hard-disconnected — this is friendlier than silently kicking a tab the person may come back to | 07-auth |
| EC-17 | Reconnect token used after the game has already reached GAME_OVER | Token still resolves identity for viewing the final reveal/results screen, but cannot be used to submit any game action (there are none left to submit, but this should be enforced structurally, not by there simply being no UI for it) | 07-auth |
| EC-18 | Host's session specifically reconnects after a host-migration event (EC-03/EC-33 already promoted someone else) | Returning original host rejoins as a normal player — host status is **not** automatically reclaimed; a room has exactly one host at a time and reclaiming would require an explicit, visible transfer action, not an implicit side effect of reconnecting | 07-auth / 05-lobby |

---

## 4. Socket / transport / packet integrity

| ID | Scenario | Required behavior | Fragment |
|----|----------|---------------------|----------|
| EC-19 | Player double-clicks an action button, submitting the same action twice | Client-generated action UUID; server deduplicates on that UUID, second submission is a silent no-op (not an error) if the first already succeeded | 03-socket-api |
| EC-20 | A packet is genuinely duplicated at the transport layer (retry, reconnect race, etc.) | Same UUID-based dedup as EC-19 handles this uniformly — don't build a second, separate dedup mechanism for "network duplicate" vs "user double-click"; they should collapse to the same check | 03-socket-api |
| EC-21 | Replay attack: a captured valid action packet is resent later by a malicious actor | Per-connection monotonic sequence number required alongside the action UUID; server rejects any packet whose sequence number isn't the expected next value for that connection | 03-socket-api / 13-security-hardening |
| EC-22 | Packets arrive out of order | Reject (don't attempt to reorder-and-apply) any packet whose sequence number is behind the expected value; client is responsible for resending in order or the UI surfaces a resync | 03-socket-api |
| EC-23 | A packet arrives very late, after the room's authoritative StateVersion has already moved past what the packet was generated against | Reject if the packet's claimed StateVersion doesn't match current; this is the general form of the stale-action rule in Section 6 — same mechanism, don't implement twice | 03-socket-api |
| EC-24 | Client's protocol/schema version doesn't match server's | Server forces a `STATE_SYNC` (full state re-push) rather than attempting partial compatibility; version mismatch is detected explicitly (a version field on connect), not inferred from a parse failure | 03-socket-api |
| EC-25 | Browser refresh mid-game | Auto-reconnect using the stored session token; private per-player state (own role, own hand of drawn-but-undiscarded tiles if mid-legislative-session) is restored, not just public board state | 04-reconnect |
| EC-26 | Client goes offline then back online (network blip, not explicit disconnect) | Same reconnect path as any other disconnect/reconnect — no special-cased "offline" handling distinct from EC-25 | 04-reconnect |

---

## 5. Time / timers

| ID | Scenario | Required behavior | Fragment |
|----|----------|---------------------|----------|
| EC-27 | A player's action arrives at (approximately) the same server-instant their action timer expires | Server timestamp is authoritative; define a strict inequality (action must be received strictly before the deadline instant) so exactly one outcome occurs, never both an auto-timeout action and a manual action applied for the same decision | 06-backend-orchestration |
| EC-28 | Something tries to run two gameplay timers concurrently for the same room | Structurally prevented — exactly one active gameplay timer per room per required-action window; this is an invariant, not a runtime race to guard against after the fact (see Section 0 — two active timers is a TERMINATE-class invariant violation if it's ever observed, meaning the code path that could cause it is a bug, not an expected race) | 06-backend-orchestration |
| EC-29 | Server process pauses (GC pause, host-level suspend, etc.) mid-timer | Timers must be computed from an absolute deadline timestamp stored in state, never a decrementing counter in memory — a paused-then-resumed process re-derives "how long is left" correctly from the stored deadline | 06-backend-orchestration |
| EC-30 | Client-side clock drift makes a player's local timer display disagree with actual remaining time | Client-side countdown is a display convenience only; server is the sole authority on whether a deadline has passed | 11-frontend-gameplay |
| EC-31 | Server host machine's clock is affected by an NTP correction or DST transition during a long-running game | Use a monotonic clock source for timer/deadline math, not wall-clock time, so a wall-clock adjustment can't shift an in-flight deadline; wall-clock timestamps are still fine for GameEvents logging/display, just not for deadline arithmetic | 06-backend-orchestration |

---

## 6. FSM / phase transitions

| ID | Scenario | Required behavior | Fragment |
|----|----------|---------------------|----------|
| EC-32 | An action requests a transition the current phase doesn't allow | Reject, log, no state mutation occurs — the engine's reducer must be a pure function that returns the *same* state (plus perhaps a rejection event) rather than partially applying an invalid transition | 01-game-engine-core |
| EC-33 | An action arrives that was valid when sent but the phase has already moved on by the time it's processed | Reject as stale (same mechanism as EC-23) | 03-socket-api |
| EC-34 | Engine somehow reaches a phase with no valid transition defined for the current inputs | This should be unreachable by construction (exhaustive switch/match over phase types, compiler-enforced) — if reachable in practice due to a bug, FREEZE the room per Section 0 rather than crashing the process or guessing a fallback transition | 01-game-engine-core |
| EC-35 | State is observed with two simultaneously "active" phases (e.g. both ELECTION_VOTING and LEGISLATION_MAHARAJ flags set) | Structurally impossible if phase is a single enum field, not a set of independent booleans — this is a data-modeling choice in the engine's state shape: make phase a single discriminant, not composable flags, precisely to make this class of bug unrepresentable | 01-game-engine-core |

---

## 7. Elections (see also `00-MASTER-SPEC.md` Section 5.3–5.4 for full rule detail)

| ID | Scenario | Required behavior | Fragment |
|----|----------|---------------------|----------|
| EC-36 | Duplicate vote submission from same player in same election | Second submission overwrites first (not rejected) until votes are revealed; once all votes are in and revealed, no further changes accepted | 01-game-engine-core |
| EC-37 | Vote tally exactly ties | Tie counts as rejection — explicit majority (strictly more than half) required, no tiebreaker mechanic exists | 01-game-engine-core |
| EC-38 | Exiled/dead player's client attempts to submit a vote | Reject server-side; dead players are structurally excluded from the eligible-voter set the engine computes, not filtered only in the UI | 01-game-engine-core |
| EC-39 | Maharaj Candidate disconnects during their own nomination window | AFK timeout (exact default: `DECISIONS.md` open question, still unresolved — see note below on why "abstain" isn't the right default here) applies the same as any other required-action timeout | 04-reconnect |
| EC-40 | Vote-collection window times out with some votes missing | **Do not treat missing votes as "abstain."** Secret Hitler's real ruleset has no abstain — every living player votes yes/no. A missing vote at timeout needs an explicit default *cast* vote (most naturally "no," mirroring a real table where a non-responsive player's silence reads as non-support) — this must be decided and logged in `DECISIONS.md` before `01-game-engine-core` is DONE; do not implement "abstain" since it introduces a vote-tallying concept the actual game rules don't have | 01-game-engine-core |
| EC-41 | Only 5 living players remain and the previous government's pair would both be term-limited under normal rules | Apply the 5-player exception: only the most recently elected Senapati is term-limited; the most recent Maharaj is eligible again | 01-game-engine-core |
| EC-131 | Fewer than 5 living players remain and every living player other than the current Maharaj Candidate is term-limited (e.g. 3 alive, last elected pair still alive) | Ignore Rajya Maryada for that nomination — otherwise `ELECTION_NOMINATION` has zero legal actions and the room deadlocks (Secret Hitler parity; discovered by QA stress seed `20291381`) | 01-game-engine-core |
| EC-42 | Rajya Sabha Summons nominates a term-limited player as the next Maharaj Candidate | Explicitly allowed — Summons overrides term limits for the Maharaj seat only | 01-game-engine-core |
| EC-43 | Election Tracker at 3 (Kurukshetra Anarchy) but Decree Deck has 0 tiles remaining | Reshuffle Ash Pile into Decree Deck before drawing the anarchy tile | 01-game-engine-core |
| EC-44 | Kurukshetra Anarchy's auto-enacted tile would normally grant a Rajaagna power | Power is skipped entirely, never granted | 01-game-engine-core |
| EC-45 | A rejection happens as the very next election after any decree enactment (normal or anarchy) | Tracker resets to 0 on *any* enactment; confirm off-by-one isn't introduced — "3 consecutive" means since the last reset, not lifetime count | 01-game-engine-core |

---

## 8. Legislative session

| ID | Scenario | Required behavior | Fragment |
|----|----------|---------------------|----------|
| EC-46 | Decree Deck has exactly 3+ tiles when Maharaj needs to draw | Draw directly, no reshuffle needed | 01-game-engine-core |
| EC-47 | Decree Deck has fewer than 3 tiles remaining | Shuffle the Ash Pile and place it *under* the remaining facedown Decree Deck tiles (leftover top cards keep their order), then draw; discarded tiles are never revealed even across a reshuffle | 01-game-engine-core |
| EC-47b | Akashvani (peek 3) when the Decree Deck has fewer than 3 tiles (e.g. exactly 2) | Same refill as EC-47 before the peek — Maharaj sees three tiles; the leftover draw tiles stay on top | 01-game-engine-core |
| EC-48 | Decree Deck AND Ash Pile combined can't satisfy a required draw (should be structurally impossible given fixed 17-tile composition, but treat as an invariant) | If ever observed, TERMINATE per Section 0 — this indicates deck-composition corruption elsewhere (see EC-54/EC-57 below), not a legitimate game state to design gameplay handling for | 01-game-engine-core |
| EC-49 | Senapati proposes Shakuni's Dice veto before the 5th Adharma Decree has been enacted | Structurally disallowed — the veto option must not even be a valid action until the unlock condition is met, not merely rejected after the fact | 01-game-engine-core |
| EC-50 | Both Maharaj and Senapati agree to veto | Both tiles discarded, no decree enacted, Election Tracker +1 (see EC-52 for the counter-conflation question), Maharaj placard advances normally | 01-game-engine-core |
| EC-51 | Veto proposed, only one party agrees | Veto fails; Senapati must proceed to normal discard/enact using the same 2 held tiles, no re-draw | 01-game-engine-core |
| EC-52 | Whether a veto's Election-Tracker increment should be the *same* counter that triggers Kurukshetra Anarchy at 3, or a separate counter | Per official Secret Hitler rules, veto uses the *same* Election Tracker as rejected governments (both are "failed government" events) — this resolves the open question left in v1 of this doc; record this resolution in `DECISIONS.md` before `01-game-engine-core` is marked DONE, since the master spec explicitly flagged it as needing confirmation rather than asserting it | 01-game-engine-core |
| EC-53 | Maharaj/Senapati try to use general chat during LEGISLATION_MAHARAJ/LEGISLATION_SENAPATI | Server rejects/drops chat-send events from *anyone* (not just the two of them) during these phases | 03-socket-api |

---

## 9. Deck / decree tile integrity

| ID | Scenario | Required behavior | Fragment |
|----|----------|---------------------|----------|
| EC-54 | Total deck+discard tile count doesn't match the expected 17 (minus rebalance adjustment) at any checkpoint | TERMINATE per Section 0 — this is an invariant violation indicating a bug in draw/discard/reshuffle logic, not a recoverable in-game event; capture full state for postmortem | 01-game-engine-core |
| EC-55 | A duplicate tile identity appears in the deck (if tiles are tracked by unique id rather than just a type+count) | TERMINATE — same class as EC-54 | 01-game-engine-core |
| EC-56 | A drawn tile can't be matched to any known tile type/id | TERMINATE — same class as EC-54 | 01-game-engine-core |
| EC-57 | Deck size is computed as negative at any point | TERMINATE — same class as EC-54; this is the kind of thing that should be an assertion in the engine, checked after every deck-mutating transition in dev/test builds at minimum | 01-game-engine-core |
| EC-121 | Tiles drawn into `LEGISLATION_MAHARAJ.drawnTiles` / `LEGISLATION_SENAPATI.heldTiles` are omitted from deck+ash+enacted totals | Count in-hand legislation tiles in `totalTiles` / `assertDeckIntegrity` — otherwise every successful election freezes/corrupts the room (discovered by `15-simulation-harness`) | 01-game-engine-core |
| EC-123 | 6-player rebalance sets `enactedAdharma=1` but still builds an 11-Adharma deck | Pre-enacted Adharma is one of the 11 tiles: build deck with 10 Adharma so deck+enacted totals 17 (discovered by `15-simulation-harness`) | 01-game-engine-core |

*(Note: EC-54–57 are deliberately blunt — "terminate on any deck-count anomaly" — because a
silent miscount in a hidden-information game is worse than an occasional false-positive
termination. If false positives from this become a real problem after testing, loosen the check;
don't loosen it preemptively.)*

---

## 10. Executive action / Rajaagna powers

| ID | Scenario | Required behavior | Fragment |
|----|----------|---------------------|----------|
| EC-58 | Vanvas (Execution) target is already dead/exiled | Reject — target-eligibility check must exclude already-exiled players | 01-game-engine-core |
| EC-59 | Vanvas target is the acting Maharaj themself | Reject — self-targeting isn't a valid choice for this power | 01-game-engine-core |
| EC-60 | Any power's target selection references a player not in the current room/game at all | Reject as an invalid target — target must be validated against the current living-player set server-side, never trust a client-supplied player id blindly | 01-game-engine-core |
| EC-61 | Power's target disconnects between being selected and the power resolving | Power still resolves normally against that player (their disconnected status doesn't block being investigated or exiled) | 01-game-engine-core |
| EC-62 | Multiple Rajaagna powers appear "pending" simultaneously | Structurally impossible if Executive Action is phase-gated to exactly one power resolution before returning to ELECTION_NOMINATION — if ever observed, TERMINATE per Section 0 as an invariant violation | 01-game-engine-core |
| EC-122 | `enactDecree` clears `currentGovernment` before entering `EXECUTIVE_ACTION` | Keep the seated government through EXECUTIVE_ACTION (Maharaj must still be identifiable as the acting power holder); clear only when returning to nomination or ending the game (discovered by `15-simulation-harness`) | 01-game-engine-core |
| EC-63 | Divya Drishti used on a player already investigated earlier in the game | Structurally disallowed — track the investigated-players set, exclude them as a valid target | 01-game-engine-core |
| EC-64 | Divya Drishti used on Duryodhana | Result shows team affiliation `KAURAVA` only, never the Duryodhana-specific role | 01-game-engine-core |
| EC-65 | Rajya Sabha Summons government is later rejected | Placard returns to the player after the *original* Maharaj who called the summons, then normal rotation resumes — not after the special-election candidate | 01-game-engine-core |
| EC-66 | Rajya Sabha Summons target happens to be the next player in normal rotation anyway | That player legitimately gets two Maharaj-Candidate turns in a row — correct per official rules, not a bug | 01-game-engine-core |
| EC-67 | Vanvas targets Duryodhana | Pandava victory triggers immediately, before any further sequencing | 01-game-engine-core |
| EC-68 | Vanvas targets a non-Duryodhana player | Player marked not-alive, excluded from voting/nomination/chat-send, team never system-revealed | 01-game-engine-core |
| EC-124 | Adharma-slot → Rajaagna mapping queried for any start player count 5–10 | Must match the official Secret Hitler Fascist tracks (themed): 5–6 = [—, —, AKASHVANI, VANVAS, VANVAS]; 7–8 = [—, DIVYA_DRISHTI, RAJYA_SABHA_SUMMONS, VANVAS, VANVAS]; 9–10 = [DIVYA_DRISHTI, DIVYA_DRISHTI, RAJYA_SABHA_SUMMONS, VANVAS, VANVAS] for slots 1–5 | 04-power-table |
| EC-125 | Living player count drops mid-game (e.g. after Vanvas) while more Adharma decrees remain to enact | Power lookup must still use `startPlayerCount` from game setup — never reband onto a different track based on current living count | 04-power-table |
| EC-126 | Power lookup called with `adharmaSlot` outside 1–5 | Returns no power (`null`); never invents a sixth-slot power or wraps | 04-power-table |
| EC-127 | An Adharma decree fills a track slot whose cell is empty (e.g. 5-player slot 1 or 2, 7-player slot 1) | No Rajaagna power is granted — engine must not enter `EXECUTIVE_ACTION` for that enactment | 04-power-table |

---

## 11. Hidden information / privacy

| ID | Scenario | Required behavior | Fragment |
|----|----------|---------------------|----------|
| EC-69 | Player opens browser devtools and inspects network traffic / local state | Server must never have sent the hidden information in the first place — per-player view filtering happens server-side before emit (see `00-MASTER-SPEC.md` Section 9); devtools inspection of a client that was never sent the secret is a non-issue by construction | 01-game-engine-core / 03-socket-api |
| EC-70 | Browser caches a role-reveal screen (back button, disk cache) and shows it to someone else using the same physical device later | Set explicit no-store cache headers on any response/route containing per-player secret data; this is a real risk specifically because this game is often played in-person with shared devices | 10-frontend-lobby / 11-frontend-gameplay |
| EC-71 | A spectator (exiled player, or post-game viewer) receives a payload containing others' still-secret information | Never send private payloads to spectator connections — spectator view is its own filtered view, not "normal view with a read-only flag," since a spectator during an *ongoing* game (an exiled living player) still must not see undiscarded tiles or other players' roles | 01-game-engine-core |
| EC-72 | Undiscarded/discarded decree tiles are visible in any broadcast payload | Never transmitted to any client beyond the Maharaj/Senapati actively holding them for the current legislative decision | 01-game-engine-core |
| EC-73 | Investigation (Divya Drishti) result is broadcast rather than sent only to the investigating Maharaj | Result must be a private payload to that one player; whether they later choose to say it aloud in chat is a social action outside the engine's concern | 01-game-engine-core |

---

## 12. Persistence

| ID | Scenario | Required behavior | Fragment |
|----|----------|---------------------|----------|
| EC-74 | Snapshot save fails (DB hiccup) | Retry with backoff; gameplay continues from in-memory authoritative state in the meantime — a snapshot-save failure is not itself grounds to block players from acting | 02-database-schema |
| EC-75 | GameEvent persistence fails for an action that already mutated in-memory state | The action must be rolled back / not considered applied if its event can't be durably recorded — don't let in-memory and persisted state diverge; treat "event write succeeded" as a precondition for "action is committed," not an afterthought | 06-backend-orchestration |
| EC-76 | Broadcast to clients fails/is delayed after persistence succeeds | Fine — persistence is the source of truth; a client that missed a broadcast catches up via reconnect/resync (EC-25) or a periodic re-push, not via retried broadcast-at-all-costs logic | 06-backend-orchestration |
| EC-77 | A Snapshot's version is somehow older than events that have already been recorded on top of it (clock skew, retry race writing snapshots out of order) | Ignore the stale snapshot; replay authoritative GameEvents from the last *valid* snapshot forward — snapshot writes must be versioned/ordered so this is detectable, not just assumed monotonic | 02-database-schema |
| EC-78 | Database is unreachable | Continue serving the room from in-memory state if the room is already loaded; queue/retry persistence; a *new* room/game cannot start if the DB is unreachable (no durable place to record it), and this should surface a clear "service temporarily unavailable" rather than silently accepting an unrecoverable game | 02-database-schema / 06-backend-orchestration |

---

## 13. Crash recovery / event ledger integrity

| ID | Scenario | Required behavior | Fragment |
|----|----------|---------------------|----------|
| EC-79 | Server process restarts mid-game | Recovery sequence: load latest Snapshot → replay GameEvents since that snapshot → validate resulting state against invariants (Section 23) → resume. This must be an explicit, tested code path, not something that happens to work because the DB has the data | 02-database-schema / 06-backend-orchestration |
| EC-80 | Event replay produces a state that fails invariant validation | FREEZE the room (recoverable-pending-investigation, not immediate TERMINATE, since the bug might be in replay logic rather than the original game) | 06-backend-orchestration |
| EC-81 | A Snapshot is corrupted (fails to parse/deserialize) | Ignore the corrupted snapshot, fall back to the next-most-recent valid snapshot (or full replay from game start if none exists) rather than crashing the recovery process | 02-database-schema |
| EC-82 | GameEvents log has a detectable integrity break (hash-chain mismatch, checksum mismatch, or a gap in sequence numbers), if such integrity mechanisms are implemented | FREEZE and flag for investigation — whether to implement hash-chaining/checksums at all (vs. relying on the DB's own durability guarantees) is itself an open design decision for `fragments/02-database-schema.md`, not assumed required; if implemented, a break in it is a FREEZE-class event, not silently ignored | 02-database-schema |
| EC-83 | A duplicate action UUID appears in the persisted GameEvents log itself (not just at the socket-dedup layer) | This indicates the socket-layer dedup (EC-19/EC-20) has a bug and let a duplicate through to persistence — treat as a FREEZE-worthy invariant violation if detected, and it should inform tightening the dedup layer, not just be swallowed at the persistence layer | 02-database-schema / 03-socket-api |

---

## 14. Browser / client environment

| ID | Scenario | Required behavior | Fragment |
|----|----------|---------------------|----------|
| EC-84 | React (or equivalent) double-invokes an effect in dev mode, risking a duplicate socket connection | Socket connection must be initialized exactly once per mount via a ref-guard or equivalent pattern, not naively in an effect body that could double-fire | 10-frontend-lobby / 11-frontend-gameplay |
| EC-85 | Player accidentally triggers browser back/forward navigation mid-game | Intercept/prevent accidental navigation away from an active game view (e.g. `beforeunload` confirmation, or routing that treats the game view as a trap state) — this is a UX safety net, not a security boundary | 11-frontend-gameplay |
| EC-86 | Mobile device rotates during gameplay | No state loss; layout must be responsive to orientation change without triggering a reconnect or losing any in-progress client-side input (an unsent chat draft is acceptable to lose, in-progress vote selection before submit should not be) | 11-frontend-gameplay |

---

## 15. Animation / rendering

| ID | Scenario | Required behavior | Fragment |
|----|----------|---------------------|----------|
| EC-87 | A UI animation (e.g. card-flip, vote reveal) is still playing when a new authoritative state arrives | Cancel/skip the in-progress animation and render the latest true state — never let stale animation visually contradict current game state, since this game depends on players trusting what they see | 11-frontend-gameplay |
| EC-88 | An animation's duration could be mistaken for or interfere with actual gameplay timing | Animations are purely cosmetic and must never gate or delay the actual availability of the next action — the server's authoritative timing (`00-MASTER-SPEC.md` Section 5) is what matters; the UI must not create a false impression that an animation "using up" time is itself the timer | 11-frontend-gameplay |

---

## 16. Abuse / moderation

| ID | Scenario | Required behavior | Fragment |
|----|----------|---------------------|----------|
| EC-89 | Player chooses an offensive/abusive display name | Decide explicitly whether any profanity filtering is in scope at all for a personal/portfolio project — minimum acceptable bar: document the decision either way rather than silent non-handling | 05-lobby |
| EC-90 | Players use in-game chat to coordinate outside official channels (e.g. sharing role info via a side voice call) | Explicitly out of scope for the system to prevent — this is inherent to any social deduction game played among people who can also talk in person or over a call; do not attempt technical countermeasures for this, design as if in-game chat is not the only channel that exists | (design note, not a fragment) |
| EC-91 | Host abuses host-only powers (e.g. force-ending a game they're losing) | Host force-end should be logged as a distinct GameEvent type distinguishable from a normal win-condition game-over, so this is at least visible/auditable after the fact, even if not technically prevented | 02-database-schema / 06-backend-orchestration |
| EC-128 | A single socket floods `game:action` submissions faster than the configured limit | Reject with `RATE_LIMITED`; do not apply the action; do not advance sequence / action-UUID dedup for the rejected flood | 08-rate-limiting |
| EC-129 | A single socket floods `chat:send` faster than the configured limit | Reject with `RATE_LIMITED`; do not fan out the chat message | 08-rate-limiting |
| EC-130 | A rate-limited event is submitted while the room writer queue is busy | Rate check runs **before** `queue.run` so the limited event never occupies the per-room writer | 08-rate-limiting |

---

## 17. Randomness / determinism

| ID | Scenario | Required behavior | Fragment |
|----|----------|---------------------|----------|
| EC-92 | Engine code calls `Math.random()` directly anywhere | Forbidden by `00-MASTER-SPEC.md` Section 8 — all randomness goes through the injected RNG interface; a lint rule or code-review check should catch this, not just spec prose | 01-game-engine-core |
| EC-93 | Replaying the same seed produces a different shuffle/role-assignment than the original run | Invariant failure of the RNG injection itself; if ever observed outside tests, treat as a FREEZE-worthy signal that the RNG implementation has hidden non-determinism (e.g. relying on object key iteration order, floating point non-associativity in a reduce, etc.) | 01-game-engine-core |

---

## 18. Concurrency

| ID | Scenario | Required behavior | Fragment |
|----|----------|---------------------|----------|
| EC-94 | Two actions for the same room are processed at genuinely the same instant (two backend workers, or two async handlers on one instance) | A per-room mutex/single-writer queue is required, per `00-MASTER-SPEC.md` Section 7/9 — no two engine transitions for the same room ever execute concurrently, full stop | 06-backend-orchestration |
| EC-95 | Two snapshot-writes for the same room race | Version-check before writing snapshot — later write must not silently overwrite a newer snapshot with stale data if ordering got scrambled at the network/DB layer | 02-database-schema |
| EC-96 | A broadcast is prepared mid-mutation (state half-updated) | Broadcasts must only be constructed and sent *after* a mutation fully commits, never from a partially-applied intermediate state | 06-backend-orchestration |

---

## 19. Replay / audit

| ID | Scenario | Required behavior | Fragment |
|----|----------|---------------------|----------|
| EC-97 | Replaying the full GameEvents log for a finished game produces a different final state than what was actually persisted as the final state | FREEZE-worthy if detected on a live room; for a finished/archived game, this is a correctness bug to fix in the engine/replay logic, ideally caught by tests before ever reaching production | 01-game-engine-core / 02-database-schema |
| EC-98 | Replay encounters a gap — an expected event is missing from the log | Treat as critical — this breaks the core guarantee that GameEvents is sufficient to reconstruct state; FREEZE and investigate, don't attempt to "fill in" a plausible missing event | 02-database-schema |

---

## 20. Development-time safety

| ID | Scenario | Required behavior | Fragment |
|----|----------|---------------------|----------|
| EC-99 | A developer (future session) accidentally mutates engine state in place instead of returning new state | In development/test builds, deep-freeze state objects (e.g. `Object.freeze` recursively, or an equivalent immutability-enforcing test helper) so an accidental mutation throws immediately rather than silently corrupting behavior in a way that's hard to trace later | 01-game-engine-core |
| EC-100 | Engine package accidentally imports a socket/transport library | Forbidden per `00-MASTER-SPEC.md` Section 7 — enforce via package boundaries (engine as its own workspace package with no such dependency listed) so this is a build-time failure, not a code-review-only rule | 01-game-engine-core |
| EC-101 | Engine package accidentally imports a database/ORM library | Same enforcement as EC-100 | 01-game-engine-core |
| EC-102 | Engine code calls `Date.now()` or `new Date()` directly | Forbidden — inject a clock/time source the same way RNG is injected, for the same replayability/testability reason | 01-game-engine-core |

---

## 21. Game end / win conditions

| ID | Scenario | Required behavior | Fragment |
|----|----------|---------------------|----------|
| EC-103 | Two win conditions could theoretically both be satisfied by the same state transition | Per `00-MASTER-SPEC.md` Section 4, decree-count wins and Duryodhana-specific wins (Vanvas, Senapati-election) occur in structurally distinct phases that can't overlap in a single transition — as a defensive backstop, define and test an explicit precedence order anyway (e.g. execution-based win checked before decree-count win) rather than relying solely on "it can't happen" | 01-game-engine-core |
| EC-104 | Win condition triggers mid-Executive-Action (e.g. Vanvas targets Duryodhana) | Transition to GAME_OVER immediately; no further action of any kind (including any queued/pending power resolution) is processed afterward | 01-game-engine-core |
| EC-105 | Win condition triggers mid-Legislative-Session (e.g. 5th Dharma Decree enacted by Senapati) | Immediate GAME_OVER, checked before any Rajaagna power resolution for that same enactment | 01-game-engine-core |
| EC-106 | 5th Adharma Decree (unlocking Shakuni's Dice) enacted in a way that also affects a win-condition counter in some miscount scenario | Not actually reachable in correct play; included only to confirm the veto-unlock check and the win-condition check both key off the same authoritative decree counter, not two independently-tracked counts that could drift apart | 01-game-engine-core |

---

## 22. Reconnect (game-phase-specific)

| ID | Scenario | Required behavior | Fragment |
|----|----------|---------------------|----------|
| EC-107 | Exiled (dead) player reconnects | Allowed, but strictly as a spectator — no vote/nominate/chat-send capability, and no ability to see currently-hidden info per Section 11 | 04-reconnect |
| EC-108 | Player reconnects after GAME_OVER | Allowed, read-only, full reveal is fine at this point since the game has ended (`00-MASTER-SPEC.md` Section 5.8) | 04-reconnect |
| EC-109 | A reconnect attempt's token resolves to a *different* player than the one the connecting client's UI believes it is (e.g. stale local storage from a different session) | Reject/re-derive identity strictly from the server-validated token, never from any client-asserted player id | 07-auth |

---

## 23. Invariant checklist (cross-cutting — validate after every state transition in dev/test)

These are properties that should never be false. Treat violations as TERMINATE-class per Section
0. Implementing at least a debug-mode assertion pass over these (even if not enforced at full
production perf cost on every transition) is expected as part of `01-game-engine-core`.
`fragments/15-simulation-harness.md` reuses this same assertion pass to check every transition
across many simulated games, not just the specific scenarios covered by hand-written unit tests
— that's the primary mechanism for finding rows that should exist in this file but don't yet.

| ID | Invariant |
|----|-----------|
| EC-110 | Exactly one Maharaj (or Maharaj Candidate) is ever active at a time. |
| EC-111 | There is never a state with zero valid Maharaj when one is required by the current phase. |
| EC-112 | No role is assigned to more players than the setup table (`00-MASTER-SPEC.md` Section 3) allows for the current player count. |
| EC-113 | `alive_count + dead_count == total_player_count`, always. |
| EC-114 | No timer value is ever negative; a computed negative remaining-time is a bug in deadline math (EC-29/EC-31), not a value to clamp-and-ignore silently — clamp to zero for display purposes but log the anomaly. |
| EC-115 | Exactly one government (Maharaj+Senapati pair) can be "current" during LEGISLATION_* phases — never zero, never two. |
| EC-116 | Deck size is never negative (see EC-57). |
| EC-117 | Total votes recorded for a single election never exceeds the living-player count at the time that election opened. |
| EC-118 | The current Maharaj and current Senapati (if a government is seated) are both marked alive — a dead player can never be the currently-seated Maharaj or Senapati. |
| EC-119 | StateVersion (or equivalent monotonic counter) never skips a value between consecutive persisted events for a room. |
| EC-120 | The room's phase is always exactly one value from the defined enum (`00-MASTER-SPEC.md` Section 5, state machine; see also this file's Section 6, FSM — never composable flags, never undefined/null once a game has started). |
| EC-121 | (see Section 9) In-hand legislation tiles are included in tile-total integrity checks. |
| EC-122 | (see Section 10) `currentGovernment` remains set for the entire `EXECUTIVE_ACTION` phase. |
| EC-123 | (see Section 9) 6-player rebalance: deck+enacted tile total remains 17. |
| EC-124 | (see Section 10) Adharma power tracks match official Secret Hitler boards for start counts 5–10. |
| EC-125 | (see Section 10) Power lookup uses `startPlayerCount`, not living count. |
| EC-126 | (see Section 10) Adharma slot outside 1–5 yields no power. |
| EC-127 | (see Section 10) Empty track cells grant no `EXECUTIVE_ACTION`. |

---

## Rejected / modified external resolutions

For transparency, since this file merges in an externally-produced pass: the following proposed
resolutions from that pass were **not** adopted as written, with the reason:

- **"Missing votes counted as abstain"** — rejected. Secret Hitler's actual ruleset has no
  abstain concept; every living player's vote is binary yes/no. Adopting "abstain" would
  introduce a tallying rule `00-MASTER-SPEC.md` doesn't define and that contradicts the source
  game. See EC-40 above for the correct open-question framing (a missing vote needs an explicit
  default *yes-or-no* cast, not a third bucket).
- **Blanket "terminate room" as the default resolution for most illegal states** — narrowed.
  Adopted the underlying detection logic where it's genuinely useful (deck-count invariants,
  duplicate-Maharaj, etc.) but replaced the vague "terminate" with the explicit FREEZE vs.
  TERMINATE policy in Section 0 above, since the original pass never specified what a terminated
  room looks like to a connected player — an important gap for an actual product, even a
  personal one.
- **Host reconnect after migration "rejoins as normal player, not automatically reclaimed"** —
  adopted as-is; this closes what was previously an open question in v1 of this file, now
  reflected as EC-18 above.
- **Newest-tab-writable / older-tabs-read-only for multi-tab same-session** — adopted as-is; see
  EC-16 above. Closes what was an open question in v1 of this file.
