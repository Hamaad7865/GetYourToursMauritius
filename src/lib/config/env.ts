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

  AI_PROVIDER: z.enum(['google', 'workersai', 'anthropic', 'openai']).default('google'),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  CLOUDFLARE_ACCOUNT_ID: z.string().min(1).optional(),
  CLOUDFLARE_API_TOKEN: z.string().min(1).optional(),

  PEACH_ENTITY_ID: z.string().min(1).optional(),
  PEACH_ACCESS_TOKEN: z.string().min(1).optional(),
  PEACH_WEBHOOK_SECRET: z.string().min(1).optional(),
  PEACH_ENVIRONMENT: z.enum(['test', 'live']).default('test'),

  // Transactional email (Resend). Without both, notifications fall back to the no-op stub.
  RESEND_API_KEY: z.string().min(1).optional(),
  RESEND_FROM: z.string().min(1).optional(),
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
