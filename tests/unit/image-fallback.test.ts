import { describe, expect, it } from 'vitest';
import { IMAGE_FALLBACK_SCRIPT } from '@/lib/images/fallback';

/**
 * A resized photo can fail for reasons the page cannot predict: Cloudflare answers 404 when the feature
 * is off, 403 when the origin is not on its allow-list, error 9422 once the free 5,000 transformations a
 * month are used up. Cloudflare's own `onerror=redirect` does nothing for an image on another domain
 * (Supabase), and a React `onError` misses images that fail BEFORE hydration — so the safety net is one
 * tiny inline script that listens for failed images on the whole window, in the capture phase (image
 * errors do not bubble), and puts the original back. These tests run that exact script text.
 */
type Listener = (e: { target: unknown }) => void;

function install() {
  const listeners: { fn: Listener; capture: unknown }[] = [];
  const win = {
    addEventListener(type: string, fn: Listener, capture?: unknown) {
      if (type === 'error') listeners.push({ fn, capture });
    },
  };
  new Function('window', IMAGE_FALLBACK_SCRIPT)(win);
  return { listeners, fire: (target: unknown) => listeners.forEach((l) => l.fn({ target })) };
}

function img(attrs: Record<string, string>, tagName = 'IMG') {
  const state = { attrs: { ...attrs }, src: attrs.src ?? '' };
  return {
    tagName,
    state,
    getAttribute: (n: string) => (n in state.attrs ? state.attrs[n]! : null),
    removeAttribute: (n: string) => {
      delete state.attrs[n];
    },
    // Like a real <img>: the property reflects into the content attribute.
    set src(v: string) {
      state.src = v;
      state.attrs.src = v;
    },
    get src() {
      return state.src;
    },
  };
}

const ORIGINAL = 'https://p.supabase.co/storage/v1/object/public/activity-images/a/b.jpg';
const RESIZED = `/cdn-cgi/image/width=800,quality=80,format=auto,fit=scale-down/${ORIGINAL}`;
const broken = () =>
  img({
    src: RESIZED,
    srcset: `${RESIZED} 800w`,
    sizes: '100vw',
    'data-src-original': ORIGINAL,
  });

describe('IMAGE_FALLBACK_SCRIPT', () => {
  it('installs exactly one window error listener, in the CAPTURE phase', () => {
    const { listeners } = install();
    expect(listeners).toHaveLength(1);
    expect(listeners[0]!.capture).toBe(true);
  });

  it('puts the original back when a resized photo fails — srcset and sizes first, or the browser keeps picking from them', () => {
    const { fire } = install();
    const el = broken();
    fire(el);
    expect(el.state.src).toBe(ORIGINAL);
    expect(el.getAttribute('srcset')).toBeNull();
    expect(el.getAttribute('sizes')).toBeNull();
  });

  it('stops once the image points at its ORIGINAL, so a photo that is broken everywhere cannot loop', () => {
    const { fire } = install();
    const el = broken();
    fire(el); // the resized URL failed → original
    let writes = 0;
    const realSrc = Object.getOwnPropertyDescriptor(el, 'src')!;
    Object.defineProperty(el, 'src', {
      get: realSrc.get,
      set(v: string) {
        writes += 1;
        realSrc.set!.call(el, v);
      },
    });
    fire(el); // the original failed too
    fire(el);
    expect(writes).toBe(0);
    expect(el.state.src).toBe(ORIGINAL);
  });

  it('rescues the image AGAIN if something puts the resized URL back after the first swap', () => {
    const { fire } = install();
    const el = broken();
    fire(el);
    expect(el.state.src).toBe(ORIGINAL);
    el.state.attrs.src = RESIZED; // e.g. a framework re-applying its props
    el.state.attrs.srcset = `${RESIZED} 800w`;
    fire(el);
    expect(el.state.src).toBe(ORIGINAL);
    expect(el.getAttribute('srcset')).toBeNull();
  });

  it('keeps data-src-original on the element (the rescue above depends on it)', () => {
    const { fire } = install();
    const el = broken();
    fire(el);
    expect(el.getAttribute('data-src-original')).toBe(ORIGINAL);
  });

  it('ignores a failed image that was never rewritten (no data-src-original)', () => {
    const { fire } = install();
    const el = img({ src: '/photography/couple.jpg' });
    fire(el);
    expect(el.state.src).toBe('/photography/couple.jpg');
  });

  it('ignores errors from anything that is not an image', () => {
    const { fire } = install();
    for (const target of [img({ 'data-src-original': ORIGINAL }, 'SCRIPT'), null, undefined, {}]) {
      expect(() => fire(target)).not.toThrow();
    }
  });

  it('is small enough to inline in every page without a thought', () => {
    expect(IMAGE_FALLBACK_SCRIPT.length).toBeLessThan(700);
  });
});
