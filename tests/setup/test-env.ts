// Default, non-secret environment for the test runtime. External services sit
// behind stubs, so placeholder Supabase values are enough — no network occurs.
process.env.NEXT_PUBLIC_SITE_URL ??= 'http://localhost:3000';
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://placeholder.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'placeholder-anon-key';
process.env.SUPABASE_JWT_SECRET ??= 'test-jwt-secret-must-be-long-enough-1234567890';
// The route/auth tests mint HS256 tokens against the shared secret, so opt the suite into the
// legacy path. Production leaves this unset → HS256 tokens are rejected.
process.env.ACCEPT_LEGACY_HS256 ??= 'true';
process.env.AI_PROVIDER ??= 'google';
process.env.PEACH_ENVIRONMENT ??= 'test';
