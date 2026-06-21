/**
 * Tiny structured logger. Emits ONE JSON line per event to stdout/stderr, which Cloudflare captures
 * (live `wrangler ... tail` + Logpush/Workers Logs) and any log sink can parse. Edge-safe: only
 * `console` + `JSON` + `crypto`/`Date` — no Node APIs.
 *
 * Convention: every line is `{ level, event, time, ...fields }`. Use a STABLE `event` string per call
 * site so logs are greppable (e.g. `event:"request"`, `event:"client_error"`); put variable data in
 * `fields`. Never log secrets, full card numbers (PAN), tokens, or raw request bodies.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogFields = Record<string, unknown>;

/** Errors don't JSON-serialise usefully (they become `{}`), so expand them to plain fields. */
function normalise(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    out[key] =
      value instanceof Error ? { name: value.name, message: value.message, stack: value.stack } : value;
  }
  return out;
}

function emit(level: LogLevel, event: string, fields: LogFields = {}): void {
  let line: string;
  try {
    line = JSON.stringify({ level, event, time: new Date().toISOString(), ...normalise(fields) });
  } catch {
    // A field had a circular ref or otherwise wouldn't serialise — never let logging throw.
    line = JSON.stringify({ level, event, time: new Date().toISOString(), msg: 'unserializable log fields' });
  }
  // Edge/Workers route console.error/warn to stderr-style streams; keep the level mapping so log
  // sinks can filter by severity.
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (event: string, fields?: LogFields) => emit('debug', event, fields),
  info: (event: string, fields?: LogFields) => emit('info', event, fields),
  warn: (event: string, fields?: LogFields) => emit('warn', event, fields),
  error: (event: string, fields?: LogFields) => emit('error', event, fields),
};

/** A short correlation id — ties a client-facing error id, the request log line, and the error log
 *  line together so a user-reported `x-request-id` can be traced to exactly what failed. */
export function newCorrelationId(): string {
  return crypto.randomUUID();
}
