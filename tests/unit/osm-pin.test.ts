import { describe, expect, it, vi } from 'vitest';
import { findPins, nominatimPin, NOMINATIM_GAP_MS, NOMINATIM_UA } from '@/lib/maps/osm-pin';

const reply = (rows: unknown) => new Response(JSON.stringify(rows), { status: 200 });
const asFetch = (fn: unknown) => fn as typeof fetch;

describe('nominatimPin', () => {
  it('asks Nominatim in Mauritius with an identifying User-Agent', async () => {
    const fetchImpl = vi.fn(async () => reply([{ lat: '-20.29163', lon: '57.77963' }]));
    const pin = await nominatimPin('Deux Frères', asFetch(fetchImpl));
    expect(pin).toEqual({ lat: -20.29163, lng: 57.77963 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('countrycodes=mu');
    expect((init.headers as Record<string, string>)['User-Agent']).toBe(NOMINATIM_UA);
  });

  it('never returns an off-island match (OSM once put "Grand Bay Beach" on Rodrigues)', async () => {
    const fetchImpl = vi.fn(async () => reply([{ lat: '-19.72', lon: '63.42' }]));
    expect(await nominatimPin('Grand Bay Beach', asFetch(fetchImpl))).toBeNull();
  });

  it('throws on an HTTP failure, so it is not mistaken for "not found"', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 429 }));
    await expect(nominatimPin('x', asFetch(fetchImpl))).rejects.toThrow('429');
  });
});

describe('findPins', () => {
  it('answers stored names from the table without any network call', async () => {
    const fetchImpl = vi.fn();
    const generic = 'Pick up and drop off at all parts of the island';
    const pins = await findPins(['Port Louis', generic], { fetchImpl: asFetch(fetchImpl) });
    expect(pins['Port Louis']).toEqual({ lat: -20.16245, lng: 57.5028 });
    expect(pins[generic]).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('asks once per normalised name, spaced to the one-per-second limit', async () => {
    const fetchImpl = vi.fn(async () => reply([{ lat: '-20.3', lon: '57.6' }]));
    const sleep = vi.fn(async () => {});
    const pins = await findPins(['Somewhere New', 'somewhere  new', 'Another New Place'], {
      fetchImpl: asFetch(fetchImpl),
      sleep,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(NOMINATIM_GAP_MS);
    expect(pins['somewhere  new']).toEqual({ lat: -20.3, lng: 57.6 });
  });

  it('leaves a name OUT when its lookup failed in transit (the next save retries it)', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network');
    });
    const pins = await findPins(['Unreachable Place'], {
      fetchImpl: asFetch(fetchImpl),
      sleep: async () => {},
    });
    expect('Unreachable Place' in pins).toBe(false);
  });
});
