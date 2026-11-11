# Loaded Dice

**Live demo: https://loaded-dice-web.vercel.app/**

A realtime multiplayer social-deduction game for 5–10 players, themed around the Mahabharata:
Pandavas vs. Kauravas, with Duryodhana as the hidden traitor and Shakuni's rigged dice as the
central metaphor. It is a mechanical reskin of the party game *Secret Hitler* (by Mike Boxleiter,
Tommy Maranges and Max Temkin), built as a personal portfolio project with original theming and art.
Not for commercial use.

## What it demonstrates

- **Deterministic game engine**: a pure, framework-free TypeScript state machine (`packages/engine`) with
  seeded RNG, immutable state, legal-action generation, win-condition checks and runtime invariants.
- **Realtime server**: Express + Socket.IO with per-player filtered state (hidden roles and hands are
  never sent to clients that must not see them), per-socket rate limiting, strict CORS, an admin
  API, and a per-room action queue.
- **Reconnect and recovery**: token-based session auth with rotation on reconnect, AFK handling,
  and server-side state recovery after crashes.
- **Persistence**: Postgres via Drizzle ORM, with an in-memory adapter for local dev and tests.
- **Frontend**: React 19, Vite, Tailwind, Zustand; responsive and installable as a PWA, with
  custom board art.
- **Testing at scale**: about 60 test files across packages, a seeded simulation harness
  that plays thousands of full games to flush out rule bugs, and bot-driven Playwright QA tours.
- **Ship-ready**: Docker image for the API (Railway), Vercel config for the web app, and
  GitHub Actions CI that builds, tests and builds the image.

## Architecture

npm-workspaces monorepo under `packages/`:

| Package | Role |
|---|---|
| `engine` | Pure game rules, state machine, power table, win conditions |
| `socket-api` | Shared Zod event contracts between client and server |
| `lobby` | Room creation, joining, host handover, rematch, rebalancing |
| `auth` | Session tokens, writable-socket gating |
| `reconnect` | Disconnect/AFK timeouts and resync |
| `db` | Drizzle schema and migrations |
| `server` | Socket.IO/Express orchestration, persistence, rate limits, admin |
| `sim` | Seeded full-game simulation and invariant checking |
| `bot` | Bot players and browser QA tooling |
| `web` | React front end |

Design docs: [`docs/GAME-SPEC.md`](docs/GAME-SPEC.md) (rules and architecture) and
[`docs/EDGE-CASES.md`](docs/EDGE-CASES.md) (the catalogue of failure modes the game is hardened against).

## Run locally

Requires Node 22+.

```bash
npm install
npm run build
npm test

# in two terminals
npm run start:server   # API on :3001 (in-memory persistence if DATABASE_URL is unset)
npm run dev:web        # web on :5173
```

Copy `.env.example` to `.env` to configure. Use a local Postgres or your own Supabase project for
`DATABASE_URL` if you want persistence, then run `npm run migrate`.

## Deployment

Web on Vercel ([`vercel.json`](vercel.json)), API on Railway ([`Dockerfile`](Dockerfile),
[`railway.toml`](railway.toml)), Postgres on Supabase. CI is in
[`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Credits

Game design of the original: Mike Boxleiter, Tommy Maranges, Max Temkin (*Secret Hitler*).
This project reimplements the ruleset with new theming and code.
