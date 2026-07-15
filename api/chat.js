// api/chat.js
// The AI gateway (§3) AND the prompt orchestrator (§4) in one file, per the
// architecture's own MVP note for §2 ("three functions — chat, leads,
// admin — is enough to start; split further only when responsibilities
// actually diverge"). Everything downstream (Claude, the knowledge base,
// function execution) is only reachable through this one entry point.
//
// Request shape (POST, application/json):
//   {
//     sessionId: string,           // from the client's persisted session token
//     message: string,             // the new visitor message
//     history: [{role, content}],  // short-term memory (§7 MVP: client-held)
//     state: 'discovery'|'recommendation'|'closing' (optional, defaults to discovery),
//     lang: 'en' | 'ar'
//   }
//
// Response: newline-delimited JSON events, streamed as they happen:
//   {"type":"text","delta":"..."}          — incremental reply text
//   {"type":"tool_result","tool":"...", "result": {...}} — a function call resolved
//   {"type":"done","state":"...","quote":{...}|null}      — end of turn
//   {"type":"error","error":"..."}

const Anthropic = require('@anthropic-ai/sdk');
const { checkRateLimit, validateMessageLength, flagSuspiciousInput, MAX_MESSAGE_LENGTH } = require('../lib/rateLimit');
const { buildSystemPrompt } = require('../lib/systemPrompt');
const { TOOL_SCHEMAS, executeTool } = require('../lib/tools');
const { STATES, nextState, toolsForState } = require('../lib/conversationState');
const store = require('../lib/store');

const MODEL = 'claude-sonnet-4-5-20250929';
const MAX_HISTORY_MESSAGES = 20; // crude token-budget discipline (§8) until real summarization is built

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // ---- Gateway step 1: authentication -----------------------------------
  // MVP note: no login is expected for an anonymous visitor — "authenticated"
  // here means "carries a session token issued by the client" (§6). A
  // missing token is tolerated (first-ever message) but everything after is
  // keyed off it for rate limiting and lead/event association.
  const body = req.body || {};
  const sessionId = typeof body.sessionId === 'string' && body.sessionId ? body.sessionId : `anon_${Date.now()}`;

  // ---- Gateway step 2: rate limiting -------------------------------------
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
  const rateKeySession = `session:${sessionId}`;
  const rateKeyIp = `ip:${ip}`;
  const sessionLimit = checkRateLimit(rateKeySession);
  const ipLimit = checkRateLimit(rateKeyIp);

  if (!sessionLimit.allowed || !ipLimit.allowed) {
    await store.logEvent({ type: 'rate_limited', sessionId, payload: { ip } });
    res.status(429).json({ error: 'Too many messages. Please try again in a bit.' });
    return;
  }

  // ---- Gateway step 3: input sanitation ----------------------------------
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const lengthCheck = validateMessageLength(message);
  if (!lengthCheck.ok) {
    res.status(400).json({ error: lengthCheck.error });
    return;
  }
  if (flagSuspiciousInput(message)) {
    // Logged, not blocked: the real defense is that pricing/actions can only
    // happen through validated function calls (§30) — see lib/pricingEngine.js.
    await store.logEvent({ type: 'suspicious_input_flagged', sessionId, payload: { message: message.slice(0, 200) } });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: 'AI is not configured on the server yet (missing ANTHROPIC_API_KEY).' });
    return;
  }

  // ---- Gateway step 4: routing → orchestrator ----------------------------
  const lang = body.lang === 'ar' ? 'ar' : 'en';
  const state = Object.values(STATES).includes(body.state) ? body.state : STATES.DISCOVERY;
  const history = Array.isArray(body.history) ? body.history.slice(-MAX_HISTORY_MESSAGES) : [];

  const allowedTools = toolsForState(state);
  const toolSchemas = allowedTools.map((name) => TOOL_SCHEMAS[name]).filter(Boolean);
  const systemPrompt = buildSystemPrompt({ lang, state, functionToolNames: allowedTools });

  const messages = [
    ...history.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string'),
    { role: 'user', content: message }
  ];

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no'
  });

  let nextConvState = state;
  let lastQuote = null;

  try {
    // Up to two turns: one initial call, and if Claude calls a tool, one
    // follow-up call with the tool result so it can narrate the outcome.
    // (§29 hallucination prevention: numbers are only ever narrated from
    // function-call results, never generated directly.)
    let currentMessages = messages;
    let safetyLoops = 0;

    while (safetyLoops < 3) {
      safetyLoops += 1;
      const stream = anthropic.messages.stream({
        model: MODEL,
        max_tokens: 700,
        system: systemPrompt,
        messages: currentMessages,
        tools: toolSchemas.length ? toolSchemas : undefined
      });

      stream.on('text', (delta) => {
        res.write(JSON.stringify({ type: 'text', delta }) + '\n');
      });

      const finalMessage = await stream.finalMessage();

      const toolUses = finalMessage.content.filter((block) => block.type === 'tool_use');

      if (toolUses.length === 0) {
        break; // done — no function calls this turn
      }

      // Execute each requested tool (deterministic code, §11/§12) and feed
      // results back so Claude can narrate them in its next chunk of text.
      const toolResultBlocks = [];
      for (const toolUse of toolUses) {
        const result = await executeTool(toolUse.name, toolUse.input, { sessionId });
        res.write(JSON.stringify({ type: 'tool_result', tool: toolUse.name, result }) + '\n');

        if (toolUse.name === 'generate_quote' && result.success) {
          lastQuote = result.quote;
          nextConvState = nextState(state, 'wants_quote');
        }
        if (toolUse.name === 'create_lead' && result.success) {
          nextConvState = STATES.CLOSING;
        }

        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify(result)
        });
      }

      currentMessages = [
        ...currentMessages,
        { role: 'assistant', content: finalMessage.content },
        { role: 'user', content: toolResultBlocks }
      ];
    }

    // Simple state-transition heuristic for the MVP conversation manager:
    // once the visitor has said enough for a recommendation to make sense,
    // nudge the state forward. A cheap proxy (message count in this
    // session) stands in for a real scope-detection classifier — see §60
    // roadmap for a more principled version.
    if (nextConvState === STATES.DISCOVERY && history.length >= 4) {
      nextConvState = nextState(state, 'has_scope');
    }

    await store.logEvent({ type: 'conversation_turn', sessionId, payload: { fromState: state, toState: nextConvState } });

    res.write(JSON.stringify({ type: 'done', state: nextConvState, quote: lastQuote }) + '\n');
    res.end();
  } catch (err) {
    console.error('[api/chat] error:', err);
    try {
      res.write(JSON.stringify({ type: 'error', error: 'The assistant hit a snag. Please try again.' }) + '\n');
    } finally {
      res.end();
    }
  }
};
