// lib/conversationState.js
// Owns the SHAPE of a conversation (separate from memory, which owns its
// content). Implemented as an explicit small state machine, not inferred
// implicitly from prompt text — per architecture §5, implicit state is the
// #1 cause of an AI "forgetting" where a conversation is.
//
// MVP note: three states (Discovery, Recommendation, Closing) per the
// architecture's own MVP note for §5. Expand to the full six-state model
// (+ Greeting, Objection handling, Follow-up) once real conversations
// reveal a stall the coarse model can't explain — see §60 roadmap.

const STATES = Object.freeze({
  DISCOVERY: 'discovery',
  RECOMMENDATION: 'recommendation',
  CLOSING: 'closing'
});

// Which function-calling tools are exposed to Claude at each state — this
// is a guardrail, not bookkeeping: it stops the AI from generating a formal
// quote before Discovery has established real scope (§5).
const STATE_TOOLS = {
  [STATES.DISCOVERY]: ['save_project_summary', 'escalate_to_human'],
  [STATES.RECOMMENDATION]: ['save_project_summary', 'generate_quote', 'escalate_to_human'],
  [STATES.CLOSING]: ['generate_quote', 'create_lead', 'escalate_to_human']
};

// One or two sentences of tone guidance per state (§37) — kept short
// deliberately per the architecture's own recommendation.
const STATE_TONE = {
  [STATES.DISCOVERY]: 'Warmer and exploratory. Ask one question at a time, never interrogate. Cap discovery at 3-4 questions before offering a recommendation.',
  [STATES.RECOMMENDATION]: 'Confident and specific. Explain the reasoning behind the recommendation, not just the answer. Surface the free live design session.',
  [STATES.CLOSING]: 'Calm and concrete. Always propose one specific next step (send a quote, book the design session) — never leave the conversation on an open-ended question.'
};

function nextState(currentState, signal) {
  // signal: 'has_scope' | 'recommended' | 'wants_quote' | 'reset'
  switch (currentState) {
    case STATES.DISCOVERY:
      if (signal === 'has_scope') return STATES.RECOMMENDATION;
      return STATES.DISCOVERY;
    case STATES.RECOMMENDATION:
      if (signal === 'wants_quote' || signal === 'ready_to_close') return STATES.CLOSING;
      return STATES.RECOMMENDATION;
    case STATES.CLOSING:
      return STATES.CLOSING;
    default:
      return STATES.DISCOVERY;
  }
}

function toolsForState(state) {
  return STATE_TOOLS[state] || STATE_TOOLS[STATES.DISCOVERY];
}

function toneForState(state) {
  return STATE_TONE[state] || STATE_TONE[STATES.DISCOVERY];
}

module.exports = { STATES, nextState, toolsForState, toneForState };
