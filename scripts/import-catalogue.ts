import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { extractHeadings } from '@/lib/seed/parse';

/**
 * Best-effort catalogue scraper for visitemaurice.com (Belle Mare Tours' WordPress
 * site). The pages are Elementor with NO structured product data and mostly no
 * published prices, so this extracts candidate activity titles per category (EN +
 * FR) into seed/scraped.json for REVIEW. The reviewed result is curated by hand
 * into seed/catalogue.json (the committed, reproducible source of truth).
 *
 * Run: npm run import:catalogue
 */
const PAGES: { category: string; en: string; fr: string }[] = [
  {
    category: 'Catamaran cruises',
    en: 'https://www.visitemaurice.com/en/catamaran-cruises/',
    fr: 'https://www.visitemaurice.com/croisieres-en-catamaran/',
  },
  {
    category: 'Île aux Cerfs',
    en: 'https://www.visitemaurice.com/en/ile-aux-cerfs-tours/',
    fr: 'https://www.visitemaurice.com/tour-ile-aux-cerfs/',
  },
  {
    category: 'Dolphin swims',
    en: 'https://www.visitemaurice.com/en/dolphin-encounter/',
    fr: 'https://www.visitemaurice.com/rencontre-avec-les-dauphins/',
  },
  {
    category: 'Sea walks & diving',
    en: 'https://www.visitemaurice.com/en/sea-water-activities/',
    fr: 'https://www.visitemaurice.com/activites-en-mer/',
  },
  {
    category: 'Sightseeing tours',
    en: 'https://www.visitemaurice.com/en/sightseeing/',
    fr: 'https://www.visitemaurice.com/visites-guidees/',
  },
  {
    category: 'Hiking',
    en: 'https://www.visitemaurice.com/en/hiking-activities/',
    fr: 'https://www.visitemaurice.com/randonees-activites/',
  },
  {
    category: 'Air activities',
    en: 'https://www.visitemaurice.com/en/air-activities/',
    fr: 'https://www.visitemaurice.com/activites-aeriennes/',
  },
  {
    category: 'Airport transfers',
    en: 'https://www.visitemaurice.com/en/airport-transfer/',
    fr: 'https://www.visitemaurice.com/transfert-aeroport/',
  },
  {
    category: 'Car rental',
    en: 'https://www.visitemaurice.com/en/car-rental-mauritius/',
    fr: 'https://www.visitemaurice.com/location-voiture-ile-maurice/',
  },
  {
    category: 'Scooter rental',
    en: 'https://www.visitemaurice.com/en/rent-scooter/',
    fr: 'https://www.visitemaurice.com/location-scooter/',
  },
  {
    category: 'Taxi',
    en: 'https://www.visitemaurice.com/en/taxi/',
    fr: 'https://www.visitemaurice.com/taxi-ile-maurice/',
  },
];

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'user-agent': 'BelleMareTours-importer/1.0' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.text();
}

async function scrape(url: string): Promise<string[]> {
  try {
    return extractHeadings(await fetchText(url));
  } catch (error) {
    console.warn(`  ! failed ${url}: ${String(error)}`);
    return [];
  }
}

async function main(): Promise<void> {
  const result: { category: string; en: string[]; fr: string[] }[] = [];
  for (const page of PAGES) {
    console.log(`Scraping ${page.category} …`);
    result.push({ category: page.category, en: await scrape(page.en), fr: await scrape(page.fr) });
  }
  const path = join(process.cwd(), 'seed', 'scraped.json');
  await writeFile(path, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${path} — review, then curate into seed/catalogue.json.`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
