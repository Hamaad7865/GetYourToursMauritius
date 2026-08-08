import type { Locale } from '@/lib/i18n/config';

/**
 * Extra FAQ entries for a destination guide, appended to the generated `AreaContent.faq`.
 *
 * WHY THESE EXACT QUESTIONS. They are lifted from the live "People also ask" box on Google's SERP
 * for the bare query "belle mare" — the questions Google has already decided that query means. The
 * generated guide answers airport distance, what the area is known for, the best beach and the best
 * time to go; it answers NONE of "is it nice", "what side of the island", "which country". Those PAA
 * slots render ABOVE the organic results, so a page can appear above a competitor it does not yet
 * outrank.
 *
 * WHY A SEPARATE MODULE. `_areas.gen.ts` is stamped "AUTO-GENERATED … Do not edit by hand". Nothing
 * in the repo regenerates it today, but writing PAA answers into a file whose header invites
 * overwriting is how work gets silently lost. This module is hand-maintained by construction, and
 * the merge happens at render.
 *
 * Both languages live together so a French visitor gets the same answers — the same translate-once
 * pattern the area guides themselves use.
 */

export interface FaqEntry {
  q: string;
  a: string;
}

const BELLE_MARE_EN: FaqEntry[] = [
  {
    q: 'What side of Mauritius is Belle Mare on?',
    a: 'The east. That matters more than it sounds: the east coast catches the prevailing south-east trade winds, so the lagoon runs cooler and breezier than the north or west, and is at its calmest roughly from November to April. It is also why the east is the island’s kitesurfing and sailing coast.',
  },
  {
    q: 'Is Belle Mare, Mauritius nice?',
    a: 'It is one of the longest white-sand beaches on the island — several kilometres of it — with a wide, shallow turquoise lagoon held back by a distant reef, so the water stays calm and swimmable. Quiet on weekdays, busy with Mauritian families at weekends. The honest trade-off against the north is that there is no nightlife strip: Belle Mare is beach, lagoon and resorts.',
  },
  {
    q: 'Which country is Belle Mare in?',
    a: 'Mauritius, an island nation in the Indian Ocean roughly 2,000 km off the south-east coast of Africa and 900 km east of Madagascar. Belle Mare sits in the district of Flacq on its east coast.',
  },
  {
    q: 'Is Belle Mare beach public?',
    a: 'Yes. Every beach in Mauritius is public up to the high-water mark, the stretches in front of the resorts included. Belle Mare has a large free public beach with casuarina shade, parking and food vans at weekends.',
  },
  {
    q: 'Do you pick up from hotels in Belle Mare?',
    a: 'Yes — Belle Mare is our home coast, so it is the shortest drive of our day. We collect from every hotel on this page and from villas, guesthouses and Airbnbs along the same stretch, at a fixed price per vehicle rather than per person.',
  },
];

const BELLE_MARE_FR: FaqEntry[] = [
  {
    q: 'Sur quelle côte de Maurice se trouve Belle Mare ?',
    a: 'À l’est. Ce détail compte : la côte est reçoit les alizés du sud-est, le lagon y est donc plus frais et plus venteux qu’au nord ou à l’ouest, et il est au plus calme de novembre à avril environ. C’est aussi pourquoi l’est est la côte du kitesurf et de la voile.',
  },
  {
    q: 'Belle Mare vaut-elle le détour ?',
    a: 'C’est l’une des plus longues plages de sable blanc de l’île — plusieurs kilomètres — avec un vaste lagon turquoise peu profond protégé par un récif éloigné, donc une eau calme où l’on nage facilement. Tranquille en semaine, animée par les familles mauriciennes le week-end. La contrepartie honnête par rapport au nord : il n’y a pas de vie nocturne, Belle Mare c’est la plage, le lagon et les hôtels.',
  },
  {
    q: 'Dans quel pays se trouve Belle Mare ?',
    a: 'À Maurice, un État insulaire de l’océan Indien situé à environ 2 000 km au sud-est de l’Afrique et 900 km à l’est de Madagascar. Belle Mare se trouve dans le district de Flacq, sur la côte est.',
  },
  {
    q: 'La plage de Belle Mare est-elle publique ?',
    a: 'Oui. Toutes les plages de Maurice sont publiques jusqu’à la laisse de haute mer, y compris devant les hôtels. Belle Mare dispose d’une grande plage publique gratuite, ombragée par les filaos, avec parking et camions-restaurants le week-end.',
  },
  {
    q: 'Venez-vous chercher les clients dans les hôtels de Belle Mare ?',
    a: 'Oui — Belle Mare est notre côte, c’est donc le trajet le plus court de notre journée. Nous venons vous chercher dans tous les hôtels de cette page, ainsi que dans les villas, chambres d’hôtes et locations du même littoral, à un tarif fixe par véhicule et non par personne.',
  },
];

const EXTRA: Record<string, Record<Locale, FaqEntry[]>> = {
  'belle-mare': { en: BELLE_MARE_EN, fr: BELLE_MARE_FR },
};

/** Extra FAQ entries for a destination in one locale, or [] when the slug has none. */
export function extraFaqFor(slug: string, locale: Locale): FaqEntry[] {
  return EXTRA[slug]?.[locale] ?? [];
}

/**
 * The generated FAQ plus any extras, de-duplicated on the question.
 *
 * De-duplication matters because the extras are the SAME list that feeds the FAQPage JSON-LD: a
 * question repeated in the structured data is a validation warning, and a question repeated on the
 * page is just sloppy. If the generated guide ever grows one of these questions, the generated
 * wording wins and the extra silently drops out.
 */
export function mergedFaq(base: FaqEntry[], slug: string, locale: Locale): FaqEntry[] {
  const seen = new Set(base.map((f) => f.q.trim().toLowerCase()));
  const extras = extraFaqFor(slug, locale).filter((f) => !seen.has(f.q.trim().toLowerCase()));
  return [...base, ...extras];
}
