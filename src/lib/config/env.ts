import { z } from 'zod';

/**
 * Server-side environment access. Validated once with Zod.
 *
 * Most values are optional so the app can build and the test suite can run with
 * no real accounts (external services sit behind stubbable interfaces). Code that
 * genuinely requires a value should read it and fail loudly via the relevant
 * factory (e.g. `createUserClient` throwing a ConfigError when Supabase is unset).
 *
 * NOTE (Cloudflare Pages): on the deployed edge runtime, secrets configured in the
 * Pages dashboard are exposed via `process.env` by the next-on-pages runtime shim.
 * If a future binding is only reachable via `getRequestContext().env`, extend
 * `readRawEnv()` to merge it — kept out of here for now so this module imports
 * cleanly in the Node test runtime.
 */
const ServerEnvSchema = z.object({
  NEXT_PUBLIC_SITE_URL: z.string().url().default('http://localhost:3000'),

  // Optional. Enables the interactive Google Maps (Maps JavaScript API + Geocoding +
  // Places) used for the itinerary route map, activity location pin and checkout pickup
  // picker. Without it (or if those APIs aren't enabled), a keyless "View on Google Maps"
  // link is shown instead, so the pages never break.
  NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: z.string().min(1).optional(),

  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  SUPABASE_JWT_SECRET: z.string().min(1).optional(),

  // Legacy HS256 (symmetric) access tokens are REJECTED by default. The project now signs
  // ES256 via JWKS, so HS256 should never appear in production; accepting it means anyone
  // holding the (previously leaked) shared secret could forge a token for any user/role.
  // Set to 'true' only during a key-rotation transition while old HS256 tokens are still live.
  ACCEPT_LEGACY_HS256: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),

  // Server-only Google Maps key for the AI Road Trip Planner's server calls: Routes API (real drive
  // times) + Places API (New) (live place discovery). Falls back to NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  // when unset, but that public key is usually referrer-restricted and 403s server-side, so prefer a
  // dedicated server key. Without a working key the planner uses the haversine estimate / can't list
  // places, but never breaks.
  GOOGLE_MAPS_API_KEY: z.string().min(1).optional(),

  // Google **Route Optimization API** service account (the planner auto-orders the day's stops via
  // `optimizeTours`). This Cloud API needs an OAuth2 service-account token (scope cloud-platform +
  // IAM `routeoptimization.locations.use`), NOT an API key. Set this to the FULL service-account JSON
  // (one line) and grant the SA the "Route Optimization Editor" role. Without it the planner keeps
  // the chosen stop order (no auto-optimization), never breaks. The GCP project is read from the
  // JSON's `project_id`; override with GOOGLE_CLOUD_PROJECT if the SA lives in another project.
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().min(1).optional(),
  GOOGLE_CLOUD_PROJECT: z.string().min(1).optional(),

  AI_PROVIDER: z.enum(['google', 'workersai', 'anthropic', 'openai']).default('google'),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(1).optional(),
  // Gemini model id for the AI Road Trip Planner co-pilot. Override when Google retires a model
  // (e.g. gemini-1.5-flash was removed); defaults to a current Flash model.
  GOOGLE_GENERATIVE_AI_MODEL: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  CLOUDFLARE_ACCOUNT_ID: z.string().min(1).optional(),
  CLOUDFLARE_API_TOKEN: z.string().min(1).optional(),

  // Peach Payments — Checkout (embedded widget). The Checkout API authenticates via OAuth:
  // POST {PEACH_AUTH_BASE_URL}/api/oauth/token with clientId+clientSecret+merchantId returns a
  // short-lived Bearer token, used to POST {PEACH_CHECKOUT_BASE_URL}/v2/checkout (→ checkoutId).
  // PEACH_ENTITY_ID keys both the create-checkout body and the browser widget. PEACH_WEBHOOK_SECRET
  // verifies the HMAC-SHA256 signature on settlement notifications (the only path that confirms a
  // booking). PEACH_WEBHOOK_URL is the publicly-reachable webhook URL Peach signs over (set it to the
  // local tunnel URL during sandbox testing). All optional so dev/CI/build run on the stub; the
  // factory (getPaymentProvider) fails closed on a production-like runtime when they're missing.
  PEACH_CLIENT_ID: z.string().min(1).optional(),
  PEACH_CLIENT_SECRET: z.string().min(1).optional(),
  PEACH_MERCHANT_ID: z.string().min(1).optional(),
  PEACH_ENTITY_ID: z.string().min(1).optional(),
  PEACH_WEBHOOK_SECRET: z.string().min(1).optional(),
  PEACH_AUTH_BASE_URL: z.string().url().optional(),
  PEACH_CHECKOUT_BASE_URL: z.string().url().optional(),
  PEACH_WEBHOOK_URL: z.string().url().optional(),
  PEACH_ENVIRONMENT: z.enum(['test', 'live']).default('test'),

  // Transactional email (Resend). Without both, notifications fall back to the no-op stub.
  RESEND_API_KEY: z.string().min(1).optional(),
  RESEND_FROM: z.string().min(1).optional(),
  // Owner alerts: where the "new booking" notifications land. Email defaults to SITE.email when unset.
  OWNER_NOTIFY_EMAIL: z.string().min(1).optional(),
  // WhatsApp owner alerts via the Meta WhatsApp Cloud API. All three are required for delivery:
  // a permanent access token, the business phone-number id, and the owner's number in E.164 digits
  // (e.g. 23057729919). Optional template name for out-of-session delivery (one {{1}} body param).
  WHATSAPP_ACCESS_TOKEN: z.string().min(1).optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1).optional(),
  OWNER_WHATSAPP_TO: z.string().min(1).optional(),
  WHATSAPP_TEMPLATE_NAME: z.string().min(1).optional(),
  // The template's approved locale code (defaults to 'en'; use 'en_US' if approved as such).
  WHATSAPP_TEMPLATE_LANG: z.string().min(1).optional(),
  // Telegram owner alerts (used instead of WhatsApp — no Meta onboarding, template or per-message
  // payment). BOTH are required for delivery: a Bot API token (from @BotFather) and the destination
  // chat id — a GROUP chat id (add the owner + staff to one group) or a comma-separated list of chat
  // ids to fan out to several people.
  TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
  TELEGRAM_OWNER_CHAT_ID: z.string().min(1).optional(),
  // Shared secret guarding the internal worker endpoints (notification drain, hold sweep). Use a
  // long random value; the endpoints are 503 until it is set.
  INTERNAL_TASK_SECRET: z.string().min(1).optional(),
});

export type ServerEnv = z.infer<typeof ServerEnvSchema>;

function readRawEnv(): Record<string, string | undefined> {
  return { ...process.env };
}

let cached: ServerEnv | null = null;

/** Returns the validated server environment. Throws if a present value is malformed. */
export function getServerEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = ServerEnvSchema.safeParse(readRawEnv());
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid server environment: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test helper: clears the memoised env so stubbed values take effect. */
export function resetServerEnvCache(): void {
  cached = null;
}
