import { afterEach, describe, expect, it, vi } from 'vitest';
import { observeNear } from '@/lib/maps/useNearViewport';

describe('observeNear', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('fires once on the first intersection, then disconnects', () => {
    let cb: IntersectionObserverCallback = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal(
      'IntersectionObserver',
      vi.fn((c: IntersectionObserverCallback) => {
        cb = c;
        return { observe: vi.fn(), disconnect };
      }),
    );
    const onNear = vi.fn();
    observeNear({} as Element, '400px', onNear);
    cb([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);
    expect(onNear).not.toHaveBeenCalled();
    cb([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    expect(onNear).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalled();
  });

  it('fires immediately when IntersectionObserver does not exist (old browsers keep the map)', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const onNear = vi.fn();
    observeNear({} as Element, '400px', onNear);
    expect(onNear).toHaveBeenCalledTimes(1);
  });
});
