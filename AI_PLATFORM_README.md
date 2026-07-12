# VELIX AI Platform — What changed & how to deploy

## What this is
Your existing static site, unchanged in design/branding/animations, now has a
real backend (`/api`, `/lib`, `/knowledge`) implementing the MVP layer of
`velix-ai-architecture-v2.md`. The chat widget talks to Claude through a
server you control instead of matching keywords in the browser.

## Deploy steps (Vercel)
1. `vercel env add ANTHROPIC_API_KEY` — paste your real Anthropic key. This
   is the only required step for the AI to come alive.
2. (Recommended once you're getting real traffic) Add a **Vercel KV** store
   from the Storage tab of your Vercel project — it auto-injects
   `KV_REST_API_URL` / `KV_REST_API_TOKEN`. Without this, leads/events
   captured by the AI live only in that serverless instance's memory and
   can disappear on redeploy/cold start — fine for testing, not for real
   leads.
3. (Optional) `vercel env add ADMIN_API_SECRET` — a random string, if you
   want `/api/admin/*` to require a header instead of being open reads.
4. `git push` / `vercel --prod` as normal — `package.json` now declares the
   two new dependencies (`@anthropic-ai/sdk`, `@vercel/kv`), Vercel installs
   them automatically during build.

Nothing else changes: `vercel.json`'s existing rewrite is untouched, every
HTML page loads `chat-widget.js`/`store.js` exactly as before.

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
Admin Integration (server leads merged into the existing Kanban) ·
Analytics (structured event log + `/api/admin/events`) · Security (API key
server-only, rate limiting, input caps, injection-pattern logging) ·
Performance (streaming replies, in-memory KB caching).

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
- **Dashboard analytics charts** — the event log is being captured now
  (`/api/admin/events`); a visualized chart is worth building once there's
  enough data for one to say something a raw list can't.

## One deviation from the doc, and why
The architecture describes the AI gateway and prompt orchestrator as two
sections (§3, §4). I implemented them as one file (`api/chat.js`) — this
matches the doc's *own* §2 MVP note ("three functions is enough to start;
split further only when responsibilities actually diverge") more literally
than splitting into two files with a manual call between them would have,
with no loss of the layering discipline (gateway checks still run in a
strict, first-to-last order before anything touches Claude).
