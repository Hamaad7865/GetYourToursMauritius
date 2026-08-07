/**
 * International dialling codes for the checkout phone field.
 *
 * Why this exists: the phone on a booking is how the DRIVER reaches the guest on the morning of the
 * trip. Visitors typed their home number the way they dial it at home — "07700 900123", "06 12 34 56
 * 78" — which is unreachable from Mauritius, and the placeholder ("+230 5xxx xxxx") was the only
 * thing telling them otherwise. A code picker makes the country an explicit choice and keeps the
 * stored value in international form.
 *
 * ONE ENTRY PER CODE, not per country. A `<select>` keyed by dial code cannot carry two options with
 * the same value, and the code is all that matters here — so the shared ones (+1, +262, +7) name
 * both territories in a single row rather than appearing twice.
 *
 * Dependency-free by design: imported by a client component and by its unit test, nothing else.
 */

export interface DialCode {
  /** E.164 country calling code, including the leading '+'. Unique across the list — it is the
   *  `<option value>` and the key the stored number is parsed back to. */
  code: string;
  /** Display name. Real-world country names are proper nouns and are not translated (same rule the
   *  checkout Country select follows). */
  name: string;
  /** Regional-indicator flag, purely decorative — the name and code carry the meaning. */
  flag: string;
}

/** Mauritius first (the home market and the only local number a driver dials), then the source
 *  markets in the order the checkout Country list uses, then the rest alphabetically. */
export const DIAL_CODES: readonly DialCode[] = [
  { code: '+230', name: 'Mauritius', flag: '🇲🇺' },
  { code: '+44', name: 'United Kingdom', flag: '🇬🇧' },
  { code: '+33', name: 'France', flag: '🇫🇷' },
  { code: '+49', name: 'Germany', flag: '🇩🇪' },
  { code: '+91', name: 'India', flag: '🇮🇳' },
  { code: '+27', name: 'South Africa', flag: '🇿🇦' },
  { code: '+262', name: 'Réunion / Mayotte', flag: '🇷🇪' },
  { code: '+39', name: 'Italy', flag: '🇮🇹' },
  { code: '+34', name: 'Spain', flag: '🇪🇸' },
  { code: '+41', name: 'Switzerland', flag: '🇨🇭' },
  { code: '+32', name: 'Belgium', flag: '🇧🇪' },
  { code: '+31', name: 'Netherlands', flag: '🇳🇱' },
  { code: '+43', name: 'Austria', flag: '🇦🇹' },
  { code: '+353', name: 'Ireland', flag: '🇮🇪' },
  { code: '+351', name: 'Portugal', flag: '🇵🇹' },
  { code: '+46', name: 'Sweden', flag: '🇸🇪' },
  { code: '+47', name: 'Norway', flag: '🇳🇴' },
  { code: '+45', name: 'Denmark', flag: '🇩🇰' },
  { code: '+48', name: 'Poland', flag: '🇵🇱' },
  { code: '+7', name: 'Russia / Kazakhstan', flag: '🇷🇺' },
  { code: '+86', name: 'China', flag: '🇨🇳' },
  { code: '+61', name: 'Australia', flag: '🇦🇺' },
  { code: '+1', name: 'United States / Canada', flag: '🇺🇸' },
  { code: '+971', name: 'United Arab Emirates', flag: '🇦🇪' },
  { code: '+966', name: 'Saudi Arabia', flag: '🇸🇦' },
  { code: '+261', name: 'Madagascar', flag: '🇲🇬' },
  { code: '+248', name: 'Seychelles', flag: '🇸🇨' },
  { code: '+254', name: 'Kenya', flag: '🇰🇪' },
  // Beyond the checkout Country list, so a traveller who picked "Other" still has their code.
  { code: '+20', name: 'Egypt', flag: '🇪🇬' },
  { code: '+30', name: 'Greece', flag: '🇬🇷' },
  { code: '+36', name: 'Hungary', flag: '🇭🇺' },
  { code: '+40', name: 'Romania', flag: '🇷🇴' },
  { code: '+52', name: 'Mexico', flag: '🇲🇽' },
  { code: '+54', name: 'Argentina', flag: '🇦🇷' },
  { code: '+55', name: 'Brazil', flag: '🇧🇷' },
  { code: '+60', name: 'Malaysia', flag: '🇲🇾' },
  { code: '+62', name: 'Indonesia', flag: '🇮🇩' },
  { code: '+64', name: 'New Zealand', flag: '🇳🇿' },
  { code: '+65', name: 'Singapore', flag: '🇸🇬' },
  { code: '+66', name: 'Thailand', flag: '🇹🇭' },
  { code: '+81', name: 'Japan', flag: '🇯🇵' },
  { code: '+82', name: 'South Korea', flag: '🇰🇷' },
  { code: '+90', name: 'Türkiye', flag: '🇹🇷' },
  { code: '+212', name: 'Morocco', flag: '🇲🇦' },
  { code: '+216', name: 'Tunisia', flag: '🇹🇳' },
  { code: '+234', name: 'Nigeria', flag: '🇳🇬' },
  { code: '+250', name: 'Rwanda', flag: '🇷🇼' },
  { code: '+255', name: 'Tanzania', flag: '🇹🇿' },
  { code: '+256', name: 'Uganda', flag: '🇺🇬' },
  { code: '+258', name: 'Mozambique', flag: '🇲🇿' },
  { code: '+260', name: 'Zambia', flag: '🇿🇲' },
  { code: '+263', name: 'Zimbabwe', flag: '🇿🇼' },
  { code: '+264', name: 'Namibia', flag: '🇳🇦' },
  { code: '+267', name: 'Botswana', flag: '🇧🇼' },
  { code: '+269', name: 'Comoros', flag: '🇰🇲' },
  { code: '+352', name: 'Luxembourg', flag: '🇱🇺' },
  { code: '+354', name: 'Iceland', flag: '🇮🇸' },
  { code: '+358', name: 'Finland', flag: '🇫🇮' },
  { code: '+370', name: 'Lithuania', flag: '🇱🇹' },
  { code: '+371', name: 'Latvia', flag: '🇱🇻' },
  { code: '+372', name: 'Estonia', flag: '🇪🇪' },
  { code: '+380', name: 'Ukraine', flag: '🇺🇦' },
  { code: '+385', name: 'Croatia', flag: '🇭🇷' },
  { code: '+386', name: 'Slovenia', flag: '🇸🇮' },
  { code: '+420', name: 'Czech Republic', flag: '🇨🇿' },
  { code: '+421', name: 'Slovakia', flag: '🇸🇰' },
  { code: '+886', name: 'Taiwan', flag: '🇹🇼' },
  { code: '+960', name: 'Maldives', flag: '🇲🇻' },
  { code: '+961', name: 'Lebanon', flag: '🇱🇧' },
  { code: '+962', name: 'Jordan', flag: '🇯🇴' },
  { code: '+965', name: 'Kuwait', flag: '🇰🇼' },
  { code: '+968', name: 'Oman', flag: '🇴🇲' },
  { code: '+972', name: 'Israel', flag: '🇮🇱' },
  { code: '+974', name: 'Qatar', flag: '🇶🇦' },
  { code: '+973', name: 'Bahrain', flag: '🇧🇭' },
  { code: '+92', name: 'Pakistan', flag: '🇵🇰' },
  { code: '+94', name: 'Sri Lanka', flag: '🇱🇰' },
  { code: '+98', name: 'Iran', flag: '🇮🇷' },
];

/** The home market — the default before the customer has told us anything. */
export const DEFAULT_DIAL_CODE = '+230';

/**
 * Dial code for a name from the checkout Country list.
 *
 * Matched on the display name rather than an ISO code because that list stores names. Returns null
 * for "Other" and for anything not in DIAL_CODES, which the caller reads as "leave the code alone".
 */
export function dialCodeForCountry(country: string | null | undefined): string | null {
  const wanted = (country ?? '').trim().toLowerCase();
  if (!wanted) return null;
  const hit = DIAL_CODES.find((d) =>
    // "Réunion / Mayotte" and "United States / Canada" answer to either half.
    d.name
      .toLowerCase()
      .split('/')
      .map((part) => part.trim())
      .includes(wanted),
  );
  return hit?.code ?? null;
}

/**
 * Split a stored number into its dial code and the national part the customer edits.
 *
 * LONGEST MATCH WINS: '+2' is not a code but '+230' and '+27' both start with it, and '+1' is a
 * prefix of nothing else here — matching shortest-first would read '+230…' as '+2' + '30…'.
 *
 * A number with no recognisable code (a bare '07700 900123', or a code we don't list) comes back
 * with `dialCode: null` and the whole string as the national part, so the caller can keep showing
 * exactly what the customer typed instead of silently mangling it.
 */
export function splitPhone(value: string | null | undefined): {
  dialCode: string | null;
  national: string;
} {
  const raw = (value ?? '').trim();
  if (!raw.startsWith('+')) return { dialCode: null, national: raw };
  const afterPlus = raw.slice(1);
  // Compare against the digits alone so '+230 5xxx' and '+2305xxx' parse identically.
  const digits = afterPlus.replace(/\D/g, '');

  let bare = '';
  for (const { code } of DIAL_CODES) {
    const candidate = code.slice(1);
    if (digits.startsWith(candidate) && candidate.length > bare.length) bare = candidate;
  }
  if (!bare) return { dialCode: null, national: raw };

  // Cut the code off the ORIGINAL string (not the digits) so the customer's own spacing and
  // punctuation after it survive a round-trip through the field.
  let seen = 0;
  let cut = 0;
  for (let i = 0; i < afterPlus.length && seen < bare.length; i += 1) {
    if (/\d/.test(afterPlus[i]!)) seen += 1;
    cut = i + 1;
  }
  return { dialCode: `+${bare}`, national: afterPlus.slice(cut).trim() };
}

/**
 * Recombine a code and a national part into the value stored on the booking.
 *
 * Returns '' when there are no national digits: a lone '+230' is not a phone number, and letting it
 * through would satisfy the "a pickup booking needs a phone" gate with something no driver can ring.
 */
/**
 * The country codes whose numbers KEEP a leading zero when dialled internationally.
 *
 * Almost everywhere the leading '0' is a trunk prefix — a domestic-dialling artefact that is dropped
 * the moment a country code goes in front of it (UK 020… → +44 20…). Italy is the standard exception:
 * its 1998 numbering reform made the leading zero part of the LANDLINE number itself, so +39 06 …
 * is correct and '+39 6 …' does not connect. Stripping it there would hand the driver a number that
 * cannot be rung — the exact failure the two-field picker exists to prevent.
 *
 * (Italian MOBILES start '3' and carry no zero, so they are unaffected either way.)
 */
const KEEPS_LEADING_ZERO = new Set(['+39']);

export function composePhone(dialCode: string | null | undefined, national: string): string {
  const rest = national.trim();
  if (!/\d/.test(rest)) return '';
  if (!dialCode) return rest;
  // A national part that already carries its own '+' code is trusted as-is — the customer pasted a
  // full international number into the field.
  if (rest.startsWith('+')) return rest;
  // Strip a national trunk prefix ('0' in the UK, France, South Africa …) — it is never dialled
  // together with the country code. Except where the zero IS the number: see KEEPS_LEADING_ZERO.
  const trimmed = KEEPS_LEADING_ZERO.has(dialCode) ? rest : rest.replace(/^0+(?=\d)/, '');
  return `${dialCode} ${trimmed}`;
}
