/**
 * Supabase database types.
 *
 * PLACEHOLDER for Phase 0. In Phase 1, after the migrations land, this file is
 * regenerated from the live schema with:
 *
 *   npm run gen:types
 *   (supabase gen types typescript --local > src/lib/supabase/types.ts)
 *
 * Until then it provides an empty-but-valid `Database` shape so the typed
 * Supabase client compiles. Do not hand-edit beyond Phase 0.
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
