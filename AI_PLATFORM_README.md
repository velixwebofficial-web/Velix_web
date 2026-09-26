# VELIX AI Platform — What changed & how to run it

## What this is
Your existing static site, unchanged in design/branding/animations, has a
real backend (`/api`, `/lib`, `/knowledge`) implementing the MVP layer of
`velix-ai-architecture-v2.md`, running as a single persistent Node.js
process (`server.js`) with a local SQLite database (`data/velix.db`) and
local file storage (`uploads/`). The chat widget talks to Claude through a
server you control instead of matching keywords in the browser. There is no
external database, cloud storage, or account of any kind involved — see
`README.md` for how to install and run it.

## Setup
1. Copy `.env.example` to `.env.local` and set `ANTHROPIC_API_KEY` (required
   for the AI chat widget to come alive), `ADMIN_EMAIL`,
   `ADMIN_PASSWORD_HASH`, and `ADMIN_SESSION_SECRET` (required for the admin
   dashboard — see `README.md`).
2. `npm install` — installs `@anthropic-ai/sdk` and `bcryptjs`.
3. `npm start` (or `npm run dev` — identical). The database and
   `uploads/` folders are created automatically on first run.

## What's implemented (MVP layer of each subsystem)
AI Gateway · Backend structure · Claude API integration (streaming) ·
Prompt Orchestrator · Conversation Manager (3-state: Discovery →
Recommendation → Closing) · Session Manager · Short-term Memory · Context
Builder (full-KB injection, correct at this KB size per §8's own MVP note) ·
Knowledge Base (7 structured JSON files) · Function Calling
(`create_lead`, `generate_quote`, `save_project_summary`,
`escalate_to_human`) · Business Logic Layer (discount cap enforced in code)
· Pricing Engine · Quote Generator (rendered card with reference number) ·
Lead Collection (dual path: AI tool call + existing form, same store) ·
Admin Integration (leads read live from SQLite, through the authenticated
`/api/admin/data` gateway, in the admin Kanban) ·
Analytics (structured event log in `activity_log`) · Security (API key
server-only, rate limiting, input caps, injection-pattern logging,
parameterized SQLite queries, server-side session-cookie admin auth — see
`README.md`'s "Admin authentication" section) · Performance
(streaming replies, in-memory KB caching).

## Deliberately deferred (per the architecture doc's own MVP notes)
- **Retrieval/RAG (§10)** — skip until the KB outgrows direct injection.
- **Long-term memory / customer profiles (§7, §52)** — build once there's
  real returning-visitor volume to justify it.
- **Lead scoring (§22), Proposal generator (§20)** — build once lead volume
  or deal size justifies the extra machinery.
- **schedule_meeting / check_availability tools** — deliberately not stubbed;
  a fake calendar tool would let the AI "confirm" a meeting that isn't real,
  which is the exact failure mode function-calling exists to prevent. Wire
  these once there's a real calendar/queue system behind them.
- **Output-matching hallucination check (§29 step 3)** — the prompt-level and
  function-calling defenses are live; the extra deterministic
  price-in-text-vs-price-from-engine cross-check is worth adding once real
  quotes are going out to paying customers.
- **Dashboard analytics charts** — the event log is being captured now (the
  `activity_log` table, read through the authenticated `/api/admin/data`
  gateway by admin.html — there is no separate `/api/admin/events`
  endpoint); a visualized chart is worth building once there's enough data
  for one to say something a raw list can't.

## One deviation from the doc, and why
The architecture describes the AI gateway and prompt orchestrator as two
sections (§3, §4). I implemented them as one file (`api/chat.js`) — this
matches the doc's *own* §2 MVP note ("three functions is enough to start;
split further only when responsibilities actually diverge") more literally
than splitting into two files with a manual call between them would have,
with no loss of the layering discipline (gateway checks still run in a
strict, first-to-last order before anything touches Claude).

## Real-time updates on public pages
Public pages (portfolio, news, etc.) used to update live across browser
tabs via a Postgres Realtime subscription, then via polling this server's
`/api/public/*` routes. As of the static/serverless architecture change
(see README.md section 10, "Publishing & static hosting"), public pages no
longer talk to this server for reads at all: `assets/js/store.js` polls the
generated static files `public-data/projects.json` and
`public-data/news.json` every 45 seconds (cache-busted so no CDN/browser
cache can serve a stale copy) and only re-renders when the data actually
changed. Publishing a change in Admin regenerates those files and pushes
them to the static host (`lib/publish.js`) — an already-open public page
picks it up within one poll interval (≤45s) of that push landing, exactly
as before, but now with no dependency on this server being reachable at
all.
