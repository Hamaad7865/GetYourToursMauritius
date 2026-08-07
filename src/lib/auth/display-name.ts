/**
 * Which name to greet a signed-in person by.
 *
 * There are two names on a Supabase account and they drift apart the moment anyone edits theirs:
 *
 *  - `auth.users.user_metadata.full_name` — captured at REGISTRATION and never written again. The
 *    sign-up form seeds it and nothing in the app updates it afterwards.
 *  - `profiles.full_name` — the editable one. /account writes it, and the header and account rail
 *    already render it.
 *
 * The welcome toast used to read the first, and truncate it to its first word, so a returning
 * customer was greeted by whatever they typed when they registered — wrong the moment they
 * corrected a spelling or added a surname, and never showing the surname at all.
 *
 * Kept as a dependency-free leaf so it can be unit-tested without pulling the provider (and the
 * Supabase browser client behind it) into the test graph.
 */

/** The subset of the auth user this module reads — avoids importing @supabase/supabase-js here. */
export interface NameCarryingUser {
  user_metadata?: Record<string, unknown> | null;
}

/** Collapse runs of whitespace and reject an all-blank name, so " " never renders as a greeting. */
export function cleanName(name: string | null | undefined): string | null {
  const trimmed = (name ?? '').trim().replace(/\s+/g, ' ');
  return trimmed || null;
}

/** The frozen signup-time name. Only ever a fallback — see the module header. */
export function metadataName(user: NameCarryingUser | null | undefined): string | null {
  const meta = user?.user_metadata ?? {};
  const raw = meta.full_name ?? meta.name;
  return cleanName(typeof raw === 'string' ? raw : null);
}

/**
 * The name for the welcome toast: the current profile name in full (first AND last), falling back
 * to the signup name only when the profile has none — a profile read that failed, or an account
 * whose row carries no name at all.
 */
export function welcomeName(
  profileFullName: string | null | undefined,
  user: NameCarryingUser | null | undefined,
): string | null {
  return cleanName(profileFullName) ?? metadataName(user);
}
