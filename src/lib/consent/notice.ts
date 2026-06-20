/** Stored under localStorage['gytm:cookie-notice']. Bump NOTICE_VERSION to re-show after a policy change. */
export const NOTICE_VERSION = 1;
export const NOTICE_KEY = 'gytm:cookie-notice';

export function shouldShowNotice(stored: string | null): boolean {
  if (!stored) return true;
  try {
    const v = JSON.parse(stored) as { acknowledged?: boolean; version?: number };
    return !(v && v.acknowledged === true && v.version === NOTICE_VERSION);
  } catch {
    return true;
  }
}

export function serializeAck(now: number): string {
  return JSON.stringify({ acknowledged: true, version: NOTICE_VERSION, ts: now });
}
