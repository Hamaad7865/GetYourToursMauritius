/**
 * Tool names the Phase 5 agent loop exposes. Each maps to a service-layer call so
 * prices, availability and payment URLs come only from the DB/Peach — never the
 * model. The concrete tool definitions (Zod params + handlers) are added in Phase 5.
 */
export const AGENT_TOOL_NAMES = [
  'search_tours',
  'get_tour_details',
  'check_availability',
  'create_booking',
  'create_payment_link',
  'get_booking_status',
  'capture_lead',
  'handoff_to_human',
] as const;

export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];
