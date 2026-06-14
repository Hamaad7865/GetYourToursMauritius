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

  // Optional. Enables the route-with-stops Google Map (Maps Embed API) on activity
  // detail pages. Without it, a keyless region map is shown instead.
  NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: z.string().min(1).optional(),

  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  SUPABASE_JWT_SECRET: z.string().min(1).optional(),

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
