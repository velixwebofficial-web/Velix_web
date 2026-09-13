// lib/tools.js
// Registry of typed, deterministic backend functions Claude can call
// mid-conversation (§11). Claude decides WHEN to call these based on
// conversation state (guardrail enforced in conversationState.js); the
// functions themselves are plain deterministic code with no room to
// improvise — this is the single biggest lever against both hallucination
// and "sounded helpful but nothing actually happened."
//
// MVP note: create_lead and generate_quote are the two that matter most.
// save_project_summary and escalate_to_human are included too since
// they're cheap and close real gaps (dashboard summaries, human handoff).
// schedule_meeting / check_availability are deferred — see roadmap notes
// at the bottom of this file.

const { computeQuote } = require('./pricingEngine');
const store = require('./store');

const TOOL_SCHEMAS = {
  create_lead: {
    name: 'create_lead',
    description: 'Save this visitor as a lead for the VELIX team to follow up with. Call this once you have at least a name and one way to reach them (phone or email).',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        phone: { type: 'string' },
        email: { type: 'string' },
        company: { type: 'string' },
        projectDetails: { type: 'string', description: 'Brief summary of what the visitor wants built.' },
        budget: { type: 'string' },
        timeline: { type: 'string' }
      },
      required: ['name']
    }
  },
  generate_quote: {
    name: 'generate_quote',
    description: 'Compute a real, accurate price quote from the pricing engine. Only call this once you know which package fits (starter, business, professional, or ecommerce) and any relevant add-ons. Never state a price yourself before calling this.',
    input_schema: {
      type: 'object',
      properties: {
        packageId: { type: 'string', enum: ['starter', 'business', 'professional', 'ecommerce'] },
        addonIds: { type: 'array', items: { type: 'string' } }
      },
      required: ['packageId']
    }
  },
  save_project_summary: {
    name: 'save_project_summary',
    description: 'Save a short structured summary of what has been learned about this visitor\'s project so far, for the admin dashboard. Call this once real scope details emerge in Discovery.',
    input_schema: {
      type: 'object',
      properties: {
        projectType: { type: 'string' },
        summary: { type: 'string' }
      },
      required: ['summary']
    }
  },
  escalate_to_human: {
    name: 'escalate_to_human',
    description: 'Flag this conversation for direct founder/team follow-up — use when the visitor explicitly asks for a human, seems frustrated, asks for a discount, or asks something outside the knowledge base.',
    input_schema: {
      type: 'object',
      properties: {
        reason: { type: 'string' }
      },
      required: ['reason']
    }
  }
};

async function executeTool(name, input, context) {
  switch (name) {
    case 'create_lead': {
      // Idempotency per §11's implementation recommendation: keyed by
      // sessionId so a retried/double tool-call in the same session
      // updates rather than duplicates.
      const lead = Object.assign({
        id: `lead_${context.sessionId}_${Date.now().toString(36)}`,
        sessionId: context.sessionId,
        source: 'AI Chat',
        status: 'New',
        createdAt: new Date().toISOString()
      }, input);
      await store.saveLead(lead);
      await store.logEvent({ type: 'lead_created', sessionId: context.sessionId, payload: { name: input.name } });
      return { success: true, lead };
    }
    case 'generate_quote': {
      const result = computeQuote(input);
      if (!result.ok) return { success: false, error: result.error };
      await store.logEvent({ type: 'quote_generated', sessionId: context.sessionId, payload: result.breakdown });
      return { success: true, quote: result.breakdown };
    }
    case 'save_project_summary': {
      await store.logEvent({ type: 'project_summary', sessionId: context.sessionId, payload: input });
      return { success: true };
    }
    case 'escalate_to_human': {
      await store.logEvent({ type: 'escalation', sessionId: context.sessionId, payload: input });
      return {
        success: true,
        contact: { phone: '+962 79 969 1748', email: 'velixweb.official@gmail.com' }
      };
    }
    default:
      return { success: false, error: `Unknown tool: ${name}` };
  }
}

module.exports = { TOOL_SCHEMAS, executeTool };

// Roadmap (not built — see §60): schedule_meeting (needs a calendar
// integration), check_availability (needs a project-queue data source).
// Both are real future tools once there's an actual calendar/queue system
// to back them with; stubbing them now would let Claude "confirm" a
// meeting time that isn't real, which is exactly the failure mode §11
// exists to prevent.
