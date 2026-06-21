import type { PGlite } from '@electric-sql/pglite';

/**
 * A tiny, faithful stand-in for the Supabase browser client, backed by PGlite.
 *
 * The admin write helpers (src/lib/admin/*.ts) talk to Supabase through the PostgREST
 * query builder (`sb.from(table).select()/insert()/update()/delete()`). To regression-test
 * those helpers AGAINST THE REAL SCHEMA — real foreign keys, ON DELETE CASCADE/RESTRICT,
 * real RLS — this shim translates the exact subset of builder calls they use into SQL run
 * on the in-process Postgres. PGlite enforces the constraints, so behaviour we care about
 * (a RESTRICT delete failing, a CASCADE removing rows) is genuine, not mocked.
 *
 * Supabase semantics preserved: queries resolve to `{ data, error }` and NEVER throw — a
 * constraint violation comes back as `{ error }`, exactly as the helpers expect (they then
 * `throw error` themselves). Only the operations the helpers actually use are implemented.
 */

type Filter = { col: string; op: 'eq' | 'in'; val: unknown };
type RowMode = 'many' | 'single' | 'maybeSingle';
type Result = { data: unknown; error: unknown };

class QueryBuilder implements PromiseLike<Result> {
  private op: 'select' | 'insert' | 'update' | 'delete' = 'select';
  private cols = '*';
  private filters: Filter[] = [];
  private orderBy: string | null = null;
  private orderAsc = true;
  private limitN: number | null = null;
  private payload: Record<string, unknown> | Record<string, unknown>[] | null = null;
  private returning: string | null = null;
  private rowMode: RowMode = 'many';

  constructor(
    private readonly pg: PGlite,
    private readonly table: string,
  ) {}

  select(cols = '*'): this {
    // After an insert, `.select(...)` requests a RETURNING clause; otherwise it's a read.
    if (this.op === 'insert') this.returning = cols;
    else {
      this.op = 'select';
      this.cols = cols;
    }
    return this;
  }
  insert(payload: Record<string, unknown> | Record<string, unknown>[]): this {
    this.op = 'insert';
    this.payload = payload;
    return this;
  }
  update(payload: Record<string, unknown>): this {
    this.op = 'update';
    this.payload = payload;
    return this;
  }
  delete(): this {
    this.op = 'delete';
    return this;
  }
  eq(col: string, val: unknown): this {
    this.filters.push({ col, op: 'eq', val });
    return this;
  }
  in(col: string, vals: unknown[]): this {
    this.filters.push({ col, op: 'in', val: vals });
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }): this {
    this.orderBy = col;
    this.orderAsc = opts?.ascending ?? true;
    return this;
  }
  limit(n: number): this {
    this.limitN = n;
    return this;
  }
  single(): this {
    this.rowMode = 'single';
    return this;
  }
  maybeSingle(): this {
    this.rowMode = 'maybeSingle';
    return this;
  }

  then<TResult1 = Result, TResult2 = never>(
    onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.exec().then(onfulfilled, onrejected);
  }

  /** True when a filter is `.in(col, [])` — which matches nothing without touching the DB. */
  private hasEmptyIn(): boolean {
    return this.filters.some((f) => f.op === 'in' && Array.isArray(f.val) && f.val.length === 0);
  }

  private buildWhere(params: unknown[]): string {
    if (this.filters.length === 0) return '';
    const parts = this.filters.map((f) => {
      params.push(f.val);
      return f.op === 'eq' ? `${f.col} = $${params.length}` : `${f.col} = any($${params.length})`;
    });
    return ` where ${parts.join(' and ')}`;
  }

  private shape(rows: Record<string, unknown>[]): Result {
    if (this.rowMode === 'single') {
      if (rows.length !== 1) {
        return { data: null, error: { message: `expected exactly 1 row, got ${rows.length}` } };
      }
      return { data: rows[0], error: null };
    }
    if (this.rowMode === 'maybeSingle') {
      return { data: rows[0] ?? null, error: null };
    }
    return { data: rows, error: null };
  }

  private async exec(): Promise<Result> {
    try {
      if (this.hasEmptyIn()) return this.shape([]);
      const params: unknown[] = [];
      let sql: string;

      if (this.op === 'select') {
        const order = this.orderBy
          ? ` order by ${this.orderBy} ${this.orderAsc ? 'asc' : 'desc'}`
          : '';
        const limit = this.limitN !== null ? ` limit ${this.limitN}` : '';
        sql = `select ${this.cols} from ${this.table}${this.buildWhere(params)}${order}${limit}`;
      } else if (this.op === 'insert') {
        const rows = Array.isArray(this.payload) ? this.payload : [this.payload ?? {}];
        const cols = Object.keys(rows[0] ?? {});
        const tuples = rows
          .map(
            (row) =>
              `(${cols
                .map((c) => {
                  params.push(row[c] ?? null);
                  return `$${params.length}`;
                })
                .join(', ')})`,
          )
          .join(', ');
        const returning = this.returning ? ` returning ${this.returning}` : '';
        sql = `insert into ${this.table} (${cols.join(', ')}) values ${tuples}${returning}`;
      } else if (this.op === 'update') {
        const payload = (this.payload ?? {}) as Record<string, unknown>;
        const set = Object.keys(payload)
          .map((c) => {
            params.push(payload[c] ?? null);
            return `${c} = $${params.length}`;
          })
          .join(', ');
        sql = `update ${this.table} set ${set}${this.buildWhere(params)}`;
      } else {
        sql = `delete from ${this.table}${this.buildWhere(params)}`;
      }

      const { rows } = await this.pg.query<Record<string, unknown>>(sql, params);
      return this.shape(rows);
    } catch (error) {
      // Supabase returns the error in-band rather than rejecting; callers `throw error`.
      return { data: null, error };
    }
  }
}

export interface SupabaseShim {
  from(table: string): QueryBuilder;
  rpc(fn: string, args?: Record<string, unknown>): Promise<Result>;
}

/** Build a Supabase-browser-shaped client over a PGlite instance for tests. */
export function makeSupabaseShim(pg: PGlite): SupabaseShim {
  return {
    from: (table: string) => new QueryBuilder(pg, table),
    // `sb.rpc(fn, args)` calls a Postgres function with named args; jsonb params arrive as plain
    // objects and must be passed as JSON text. Run the REAL function on PGlite so the behaviour
    // (e.g. materialize_availability filling slots) is genuine, resolving to `{ data, error }`.
    async rpc(fn: string, args: Record<string, unknown> = {}): Promise<Result> {
      const params: unknown[] = [];
      const named = Object.keys(args).map((key) => {
        const val = args[key];
        params.push(val !== null && typeof val === 'object' ? JSON.stringify(val) : val);
        return `${key} := $${params.length}`;
      });
      try {
        const { rows } = await pg.query<{ result: unknown }>(
          `select ${fn}(${named.join(', ')}) as result`,
          params,
        );
        return { data: rows[0] ? rows[0].result : null, error: null };
      } catch (error) {
        return { data: null, error };
      }
    },
  };
}
