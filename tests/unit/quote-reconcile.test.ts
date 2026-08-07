/**
 * Reconciling a drafted quote against the figures the CORRESPONDENCE already stated (Phase 2).
 *
 * The Christophe thread is the case this exists for: staff wrote "Montant total du devis : 536 EUR"
 * while the lines actually sum to 616 EUR, and nobody caught the 80-EUR gap until the customer did.
 * `extractStatedAmounts` reads the amounts a human typed in the pasted thread — NOT from the AI, which
 * has no price field by design (quote-extraction.test.ts guards that) — so the editor can show them
 * beside the computed total and the operator sees the discrepancy before the quote goes out.
 *
 * It is deliberately a text scan, not a model call: the figures are already in the email, and a
 * deterministic reader can neither invent one nor charge one. Nothing here prices a line.
 */

import { describe, expect, it } from 'vitest';
import { extractStatedAmounts, totalsMismatch } from '@/lib/quotes/reconcile';

/** A representative slice of the real Christophe thread (the maths error and its correction). */
const THREAD = `Programme proposé
  - 2 septembre : Circuit privé dans le sud — Tarif : 90 EUR
  - 4 septembre : dauphins 60 EUR par personne x 2 = 120 EUR
      - Transfert aller/retour : 60 EUR
Récapitulatif financier
  - Total Excursions & Transferts : 500 EUR
  - Total Location de voiture : 36 EUR
  - Montant total du devis : 536 EUR
Pour valider, un lien de paiement de 10 % de la totalité vous sera envoyé.

Après calcul j'ai un montant total de 616 EUR alors que le montant total indiqué est de 536 EUR.`;

function minors(text: string): number[] {
  return extractStatedAmounts(text).map((a) => a.amountMinor);
}

describe('extractStatedAmounts', () => {
  it('finds the EUR figures a human stated in the thread', () => {
    const found = minors(THREAD);
    // The grand totals the customer and staff argued over, in minor units.
    expect(found).toContain(53600); // 536 EUR
    expect(found).toContain(61600); // 616 EUR
    // …and the line/subtotal figures.
    expect(found).toContain(9000); // 90 EUR
    expect(found).toContain(12000); // 120 EUR
    expect(found).toContain(50000); // 500 EUR
    expect(found).toContain(3600); // 36 EUR
  });

  it('never reads a percentage as an amount', () => {
    // "10 %" is a deposit fraction, not a EUR figure — it must not surface as €10.
    expect(minors('un lien de paiement de 10 % de la totalité')).toEqual([]);
    expect(minors(THREAD)).not.toContain(1000);
  });

  it('flags the figures a human called a total, and only those', () => {
    const found = extractStatedAmounts(THREAD);
    const total536 = found.find((a) => a.amountMinor === 53600);
    const total616 = found.find((a) => a.amountMinor === 61600);
    const line90 = found.find((a) => a.amountMinor === 9000);
    expect(total536?.isTotal).toBe(true); // "Montant total du devis : 536 EUR"
    expect(total616?.isTotal).toBe(true); // "un montant total de 616 EUR"
    expect(line90?.isTotal).toBe(false); // a per-excursion tariff, not a total
  });

  it('lists each distinct amount once, however many times the thread repeats it', () => {
    // 536 appears twice and 60 appears twice (per-person tariff + transfer); each is one entry.
    const found = extractStatedAmounts(THREAD);
    expect(found.filter((a) => a.amountMinor === 53600)).toHaveLength(1);
    expect(found.filter((a) => a.amountMinor === 6000)).toHaveLength(1);
  });

  it('reads €-prefixed, EUR-suffixed and decimal/grouped forms', () => {
    expect(minors('€536')).toEqual([53600]);
    expect(minors('EUR 536')).toEqual([53600]);
    expect(minors('536,00 €')).toEqual([53600]);
    expect(minors('Total: 1 234,56 EUR')).toEqual([123456]);
    expect(minors('1,234.56 EUR')).toEqual([123456]);
  });

  it('returns nothing for a thread that states no figures', () => {
    expect(extractStatedAmounts('Bonjour, merci pour votre retour rapide.')).toEqual([]);
  });
});

describe('totalsMismatch — does the quote total match a figure the thread called a total', () => {
  const stated = extractStatedAmounts(THREAD); // stated totals: €536 and €616

  it('is false once the quote matches one of the stated totals (the corrected €616)', () => {
    expect(totalsMismatch(61600, stated)).toBe(false);
  });

  it('is true when the quote total matches NEITHER figure discussed', () => {
    // A fat-fingered €600 matches neither the €536 staff wrote nor the €616 it should be — surface it.
    expect(totalsMismatch(60000, stated)).toBe(true);
  });

  it('does not nag while the quote is still being priced (zero / no total yet)', () => {
    expect(totalsMismatch(0, stated)).toBe(false);
  });

  it('is false when the thread named no totals to check against', () => {
    expect(totalsMismatch(61600, extractStatedAmounts('just 90 EUR for the tour'))).toBe(false);
  });
});
