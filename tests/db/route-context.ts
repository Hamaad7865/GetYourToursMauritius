import type { ServiceContext } from '@/lib/services/context';

let current: ServiceContext | null = null;

/** Set the ServiceContext that the mocked buildServiceContext returns in route tests. */
export function setRouteContext(ctx: ServiceContext | null): void {
  current = ctx;
}

export function requireRouteContext(): ServiceContext {
  if (!current) {
    throw new Error('route context not set in test');
  }
  return current;
}
