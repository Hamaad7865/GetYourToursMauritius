import { getBrowserSupabase } from '@/lib/supabase/browser';
import { slugify } from '@/lib/admin/activity-write';

/* Admin CRUD for the SEO module's three tables. RLS (is_content_editor: staff/admin/seo) gates the
 * writes, so the authenticated editor talks to the tables directly through the browser client — the
 * same pattern as vehicle-pricing.ts. All reads here are the EDITOR view (drafts included). */

// ── Page meta overrides ────────────────────────────────────────────────────────

export interface SeoMetaInput {
  path: string;
  title: string;
  description: string;
  ogImageUrl: string;
}

export async function loadSeoMetaOverrides(): Promise<Map<string, SeoMetaInput>> {
  const { data, error } = await getBrowserSupabase()
    .from('seo_meta')
    .select('path, title, description, og_image_url');
  if (error) throw error;
  return new Map(
    (data ?? []).map((r) => [
      r.path,
      {
        path: r.path,
        title: r.title ?? '',
        description: r.description ?? '',
        ogImageUrl: r.og_image_url ?? '',
      },
    ]),
  );
}

/** Upsert one page's override; all-empty fields delete the row (back to the built-in default). */
export async function saveSeoMeta(input: SeoMetaInput): Promise<void> {
  const sb = getBrowserSupabase();
  const title = input.title.trim();
  const description = input.description.trim();
  const ogImageUrl = input.ogImageUrl.trim();
  if (!title && !description && !ogImageUrl) {
    const { error } = await sb.from('seo_meta').delete().eq('path', input.path);
    if (error) throw error;
    return;
  }
  const { error } = await sb.from('seo_meta').upsert({
    path: input.path,
    title: title || null,
    description: description || null,
    og_image_url: ogImageUrl || null,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

// ── Blog posts ─────────────────────────────────────────────────────────────────

export interface PostInput {
  slug: string;
  title: string;
  metaTitle: string;
  metaDescription: string;
  excerpt: string;
  readMins: number;
  sections: { heading: string; paragraphs: string[]; imageUrl?: string | null }[];
  faq: { q: string; a: string }[];
  heroImageUrl: string;
  status: 'draft' | 'published';
  publishedAt: string | null; // YYYY-MM-DD
}

/** Upload a blog photo to Storage (the public activity-images bucket, under blog/<slug>/) and
 *  return its public URL. Content editors (staff/admin/seo) may write the bucket. */
export async function uploadPostImage(file: File, slug: string): Promise<string> {
  const sb = getBrowserSupabase();
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `blog/${slugify(slug) || 'post'}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await sb.storage
    .from('activity-images')
    .upload(path, file, { cacheControl: '3600', upsert: false });
  if (error) throw error;
  return sb.storage.from('activity-images').getPublicUrl(path).data.publicUrl;
}

export interface PostListItem {
  slug: string;
  title: string;
  status: 'draft' | 'published';
  publishedAt: string | null;
  updatedAt: string;
}

export async function loadAdminPosts(): Promise<PostListItem[]> {
  const { data, error } = await getBrowserSupabase()
    .from('posts')
    .select('slug, title, status, published_at, updated_at')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    slug: r.slug,
    title: r.title,
    status: r.status,
    publishedAt: r.published_at,
    updatedAt: r.updated_at,
  }));
}

export async function loadAdminPost(slug: string): Promise<PostInput | null> {
  const { data, error } = await getBrowserSupabase()
    .from('posts')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    slug: data.slug,
    title: data.title,
    metaTitle: data.meta_title ?? '',
    metaDescription: data.meta_description ?? '',
    excerpt: data.excerpt ?? '',
    readMins: data.read_mins,
    sections: (data.sections as PostInput['sections']) ?? [],
    faq: (data.faq as PostInput['faq']) ?? [],
    heroImageUrl: data.hero_image_url ?? '',
    status: data.status,
    publishedAt: data.published_at,
  };
}

export async function savePost(input: PostInput, originalSlug?: string): Promise<void> {
  const sb = getBrowserSupabase();
  const row = {
    slug: input.slug.trim(),
    title: input.title.trim(),
    meta_title: input.metaTitle.trim() || null,
    meta_description: input.metaDescription.trim() || null,
    excerpt: input.excerpt.trim() || null,
    read_mins: Math.min(60, Math.max(1, Math.round(input.readMins || 5))),
    sections: input.sections
      .map((s) => {
        const imageUrl = s.imageUrl?.trim() || null;
        const out: { heading: string; paragraphs: string[]; imageUrl?: string } = {
          heading: s.heading.trim(),
          paragraphs: s.paragraphs.map((p) => p.trim()).filter(Boolean),
        };
        if (imageUrl) out.imageUrl = imageUrl;
        return out;
      })
      .filter((s) => s.heading || s.paragraphs.length || s.imageUrl),
    faq: input.faq.map((f) => ({ q: f.q.trim(), a: f.a.trim() })).filter((f) => f.q && f.a),
    hero_image_url: input.heroImageUrl.trim() || null,
    status: input.status,
    published_at:
      input.status === 'published'
        ? (input.publishedAt ?? new Date().toISOString().slice(0, 10))
        : input.publishedAt,
    updated_at: new Date().toISOString(),
  };
  // A renamed slug is a new PK: upsert the new row first, then remove the old one (insert-first, so
  // a failure never strands the post half-deleted).
  const { error } = await sb.from('posts').upsert(row);
  if (error) throw error;
  if (originalSlug && originalSlug !== row.slug) {
    const { error: delErr } = await sb.from('posts').delete().eq('slug', originalSlug);
    if (delErr) throw delErr;
  }
}

export async function deletePost(slug: string): Promise<void> {
  const { error } = await getBrowserSupabase().from('posts').delete().eq('slug', slug);
  if (error) throw error;
}

// ── Redirects ──────────────────────────────────────────────────────────────────

export interface RedirectRow {
  fromPath: string;
  toPath: string;
  createdAt: string;
}

export async function loadRedirects(): Promise<RedirectRow[]> {
  const { data, error } = await getBrowserSupabase()
    .from('seo_redirects')
    .select('from_path, to_path, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    fromPath: r.from_path,
    toPath: r.to_path,
    createdAt: r.created_at,
  }));
}

export async function saveRedirect(fromPath: string, toPath: string): Promise<void> {
  const { error } = await getBrowserSupabase()
    .from('seo_redirects')
    .upsert({ from_path: fromPath.trim(), to_path: toPath.trim() });
  if (error) throw error;
}

export async function deleteRedirect(fromPath: string): Promise<void> {
  const { error } = await getBrowserSupabase()
    .from('seo_redirects')
    .delete()
    .eq('from_path', fromPath);
  if (error) throw error;
}
