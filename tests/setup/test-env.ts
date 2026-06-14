// Default, non-secret environment for the test runtime. External services sit
// behind stubs, so placeholder Supabase values are enough — no network occurs.
process.env.NEXT_PUBLIC_SITE_URL ??= 'http://localhost:3000';
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://placeholder.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'placeholder-anon-key';
process.env.SUPABASE_JWT_SECRET ??= 'test-jwt-secret-must-be-long-enough-1234567890';
process.env.AI_PROVIDER ??= 'google';
process.env.PEACH_ENVIRONMENT ??= 'test';
