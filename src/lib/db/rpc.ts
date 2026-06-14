/**
 * The narrow database port the service layer depends on. Services only ever call
 * Postgres `api_*` functions (each taking a single jsonb `p` and returning jsonb),
 * so this single method is all they need. Two adapters implement it: a Supabase
 * client (production) and a PGlite shim (tests) — both run the identical SQL, so
 * the service layer is verified with zero mock divergence.
 */
export type RpcParams = Record<string, unknown>;

export interface DbRpc {
  rpc<T = unknown>(fn: string, params: RpcParams): Promise<T>;
}
