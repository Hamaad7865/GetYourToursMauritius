'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { slugify } from '@/lib/admin/activity-write';
import {
  deletePost,
  loadAdminPost,
  loadAdminPosts,
  savePost,
  saveRedirect,
  uploadPostImage,
  type PostInput,
  type PostListItem,
} from '@/lib/admin/seo-content';
import {
  AdminHeading,
  AdminError,
  BTN_PRIMARY,
  BTN_GHOST,
  INPUT_CLS,
  TEXTAREA_CLS,
} from '@/components/admin/ui';
import { IconPlus, IconX } from '@/components/ui/icons';

/** Photo picker: upload a file (→ Storage, public URL) or paste a URL, with preview + remove. */
function ImageField({
  label,
  value,
  slug,
  onChange,
}: {
  label: string;
  value: string;
  /** Post slug — prefixes the Storage path so a post's photos stay together. */
  slug: string;
  onChange: (url: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    setUploading(true);
    try {
      onChange(await uploadPostImage(file, slug || 'post'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <span className="block text-[13px] font-semibold text-ink">{label}</span>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={value}
            alt=""
            className="h-16 w-24 shrink-0 rounded-lg border border-[#EAEEF0] object-cover"
          />
        ) : (
          <span className="grid h-16 w-24 shrink-0 place-items-center rounded-lg border border-dashed border-[#D6DDE1] text-[11px] text-ink-muted">
            No photo
          </span>
        )}
        <label className={`${BTN_GHOST} cursor-pointer`}>
          {uploading ? 'Uploading…' : 'Upload photo'}
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
              e.target.value = '';
            }}
          />
        </label>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="…or paste an image URL"
          className={`min-w-[200px] flex-1 ${INPUT_CLS}`}
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="text-sm font-bold text-coral-dark hover:underline"
          >
            Remove
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-1.5 text-[12.5px] font-medium text-coral-dark">
          {error}
        </p>
      )}
    </div>
  );
}

const EMPTY_POST: PostInput = {
  slug: '',
  title: '',
  metaTitle: '',
  metaDescription: '',
  excerpt: '',
  readMins: 5,
  sections: [{ heading: '', paragraphs: [''] }],
  faq: [],
  heroImageUrl: '',
  status: 'draft',
  publishedAt: null,
};

function Editor({
  original,
  onDone,
}: {
  /** The stored slug when editing an existing post; null for a new one. */
  original: string | null;
  onDone: () => void;
}) {
  const [v, setV] = useState<PostInput | null>(original ? null : EMPTY_POST);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [slugTouched, setSlugTouched] = useState(Boolean(original));

  useEffect(() => {
    if (!original) return;
    loadAdminPost(original)
      .then((p) => (p ? setV(p) : setError('Post not found.')))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load.'));
  }, [original]);

  if (!v) return <p className="text-sm text-ink-muted">{error ?? 'Loading…'}</p>;

  const set = (patch: Partial<PostInput>) => setV((cur) => (cur ? { ...cur, ...patch } : cur));
  const slugChanged = Boolean(original && v.slug.trim() && v.slug.trim() !== original);

  async function save(publish?: boolean) {
    if (!v) return;
    setError(null);
    const next: PostInput =
      publish === undefined ? v : { ...v, status: publish ? 'published' : 'draft' };
    if (!next.title.trim()) return setError('The post needs a title.');
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(next.slug.trim()))
      return setError('The URL slug can only contain lowercase letters, numbers and dashes.');
    setBusy(true);
    try {
      await savePost(next, original ?? undefined);
      // A renamed published post leaves its old URL dangling — cover it with a redirect in one tap.
      if (slugChanged && original && next.status === 'published') {
        try {
          await saveRedirect(`/blog/${original}`, `/blog/${next.slug.trim()}`);
        } catch {
          /* the redirect is a courtesy — the save itself succeeded */
        }
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the post.');
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-2xl border border-[#EAEEF0] bg-white p-5">
        <h2 className="text-[15px] font-extrabold text-ink">Basics</h2>
        <div className="mt-4 grid gap-3">
          <label className="block text-[13px] font-semibold text-ink">
            Title
            <input
              value={v.title}
              onChange={(e) => {
                const title = e.target.value;
                set(slugTouched ? { title } : { title, slug: slugify(title) });
              }}
              className={`mt-1 w-full ${INPUT_CLS}`}
            />
          </label>
          <label className="block text-[13px] font-semibold text-ink">
            URL slug <span className="font-normal text-ink-muted">(/blog/…)</span>
            <input
              value={v.slug}
              onChange={(e) => {
                setSlugTouched(true);
                set({ slug: e.target.value });
              }}
              className={`mt-1 w-full ${INPUT_CLS}`}
            />
          </label>
          {slugChanged && (
            <p className="rounded-lg bg-teal/5 px-3 py-2 text-[12.5px] text-ink-muted">
              You’re renaming a published URL — saving also creates a redirect from{' '}
              <b>/blog/{original}</b> to the new address so old links keep working.
            </p>
          )}
          <label className="block text-[13px] font-semibold text-ink">
            Excerpt <span className="font-normal text-ink-muted">(intro under the title)</span>
            <textarea
              value={v.excerpt}
              onChange={(e) => set({ excerpt: e.target.value })}
              rows={2}
              className={`mt-1 w-full ${TEXTAREA_CLS}`}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-[13px] font-semibold text-ink">
              Meta title <span className="font-normal text-ink-muted">(search result title)</span>
              <input
                value={v.metaTitle}
                onChange={(e) => set({ metaTitle: e.target.value })}
                placeholder={v.title}
                className={`mt-1 w-full ${INPUT_CLS}`}
              />
            </label>
            <label className="block text-[13px] font-semibold text-ink">
              Read time (minutes)
              <input
                type="number"
                min={1}
                max={60}
                value={v.readMins}
                onChange={(e) => set({ readMins: Number(e.target.value) || 5 })}
                className={`mt-1 w-full ${INPUT_CLS}`}
              />
            </label>
          </div>
          <label className="block text-[13px] font-semibold text-ink">
            Meta description
            <textarea
              value={v.metaDescription}
              onChange={(e) => set({ metaDescription: e.target.value })}
              rows={2}
              placeholder={v.excerpt}
              className={`mt-1 w-full ${TEXTAREA_CLS}`}
            />
          </label>
          <ImageField
            label="Cover photo (hero, blog card and social shares)"
            value={v.heroImageUrl}
            slug={v.slug}
            onChange={(heroImageUrl) => set({ heroImageUrl })}
          />
        </div>
      </section>

      <section className="rounded-2xl border border-[#EAEEF0] bg-white p-5">
        <h2 className="text-[15px] font-extrabold text-ink">Sections</h2>
        <p className="mt-0.5 text-[13px] text-ink-muted">
          Each section is a heading plus paragraphs (one per line break).
        </p>
        <div className="mt-4 flex flex-col gap-4">
          {v.sections.map((s, i) => (
            <div key={i} className="rounded-xl border border-[#EAEEF0] p-3">
              <div className="flex items-center gap-2">
                <input
                  value={s.heading}
                  onChange={(e) =>
                    set({
                      sections: v.sections.map((x, j) =>
                        j === i ? { ...x, heading: e.target.value } : x,
                      ),
                    })
                  }
                  placeholder="Section heading"
                  className={`w-full ${INPUT_CLS}`}
                />
                <button
                  type="button"
                  aria-label="Remove section"
                  onClick={() => set({ sections: v.sections.filter((_, j) => j !== i) })}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-muted hover:bg-coral/10 hover:text-coral"
                >
                  <IconX width={16} height={16} />
                </button>
              </div>
              <textarea
                value={s.paragraphs.join('\n\n')}
                onChange={(e) =>
                  set({
                    sections: v.sections.map((x, j) =>
                      j === i ? { ...x, paragraphs: e.target.value.split(/\n{2,}/) } : x,
                    ),
                  })
                }
                rows={5}
                placeholder="Write the section text. Separate paragraphs with an empty line."
                className={`mt-2 w-full ${TEXTAREA_CLS}`}
              />
              <div className="mt-2">
                <ImageField
                  label="Section photo (optional — shown under the heading)"
                  value={s.imageUrl ?? ''}
                  slug={v.slug}
                  onChange={(url) =>
                    set({
                      sections: v.sections.map((x, j) =>
                        j === i ? { ...x, imageUrl: url || null } : x,
                      ),
                    })
                  }
                />
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() => set({ sections: [...v.sections, { heading: '', paragraphs: [''] }] })}
            className={`${BTN_GHOST} w-fit`}
          >
            <IconPlus width={15} height={15} /> Add section
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-[#EAEEF0] bg-white p-5">
        <h2 className="text-[15px] font-extrabold text-ink">FAQ</h2>
        <p className="mt-0.5 text-[13px] text-ink-muted">
          Optional Q&A shown at the end of the article — also marked up for Google rich results.
        </p>
        <div className="mt-4 flex flex-col gap-3">
          {v.faq.map((f, i) => (
            <div key={i} className="rounded-xl border border-[#EAEEF0] p-3">
              <div className="flex items-center gap-2">
                <input
                  value={f.q}
                  onChange={(e) =>
                    set({ faq: v.faq.map((x, j) => (j === i ? { ...x, q: e.target.value } : x)) })
                  }
                  placeholder="Question"
                  className={`w-full ${INPUT_CLS}`}
                />
                <button
                  type="button"
                  aria-label="Remove question"
                  onClick={() => set({ faq: v.faq.filter((_, j) => j !== i) })}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-muted hover:bg-coral/10 hover:text-coral"
                >
                  <IconX width={16} height={16} />
                </button>
              </div>
              <textarea
                value={f.a}
                onChange={(e) =>
                  set({ faq: v.faq.map((x, j) => (j === i ? { ...x, a: e.target.value } : x)) })
                }
                rows={2}
                placeholder="Answer"
                className={`mt-2 w-full ${TEXTAREA_CLS}`}
              />
            </div>
          ))}
          <button
            type="button"
            onClick={() => set({ faq: [...v.faq, { q: '', a: '' }] })}
            className={`${BTN_GHOST} w-fit`}
          >
            <IconPlus width={15} height={15} /> Add question
          </button>
        </div>
      </section>

      {error && <AdminError>{error}</AdminError>}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => void save(true)}
          className={BTN_PRIMARY}
        >
          {v.status === 'published' ? 'Save & keep published' : 'Publish'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void save(false)}
          className={BTN_GHOST}
        >
          Save as draft
        </button>
        <button type="button" disabled={busy} onClick={onDone} className={BTN_GHOST}>
          Cancel
        </button>
        {v.status === 'published' && (
          <a
            href={`/blog/${original ?? v.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-bold text-teal hover:text-teal-dark"
          >
            View live →
          </a>
        )}
      </div>
    </div>
  );
}

export function AdminBlog() {
  const { profile } = useAuth();
  const canEdit = profile?.role === 'admin' || profile?.role === 'staff' || profile?.role === 'seo';
  const [items, setItems] = useState<PostListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // null = list view; '' = new post; a slug = editing that post.
  const [editing, setEditing] = useState<string | null>(null);
  const [listMode, setListMode] = useState(true);

  const load = useCallback(async () => {
    try {
      setItems(await loadAdminPosts());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load posts.');
    }
  }, []);

  useEffect(() => {
    if (canEdit) void load();
  }, [canEdit, load]);

  if (!canEdit) return <p className="text-sm text-coral">Access denied.</p>;

  if (!listMode) {
    return (
      <div>
        <AdminHeading
          title={editing ? 'Edit post' : 'New post'}
          subtitle="Published posts appear on /blog and in the sitemap immediately — no deploy needed."
        />
        <Editor
          original={editing || null}
          onDone={() => {
            setListMode(true);
            setEditing(null);
            void load();
          }}
        />
      </div>
    );
  }

  return (
    <div>
      <AdminHeading
        title="Blog"
        subtitle="Write and publish travel guides. Drafts are invisible to visitors; published posts go live on /blog immediately."
      />
      {error && <AdminError>{error}</AdminError>}
      <div className="mb-4">
        <button
          type="button"
          onClick={() => {
            setEditing('');
            setListMode(false);
          }}
          className={BTN_PRIMARY}
        >
          <IconPlus width={15} height={15} /> New post
        </button>
      </div>
      {!items ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : items.length === 0 ? (
        <p className="rounded-xl border border-[#EAEEF0] bg-white p-5 text-sm text-ink-muted">
          No database posts yet. The blog currently shows the 10 built-in articles — anything you
          publish here appears alongside them (or replaces one when the web address matches).
        </p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[#EAEEF0] bg-white">
          {items.map((p) => (
            <div
              key={p.slug}
              className="flex flex-wrap items-center gap-3 border-b border-[#EAEEF0] px-4 py-3 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-bold text-ink">{p.title}</p>
                <p className="text-[12px] text-ink-muted">/blog/{p.slug}</p>
              </div>
              <span
                className={`rounded-full px-2.5 py-1 text-[11.5px] font-bold ${
                  p.status === 'published'
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-amber-100 text-amber-800'
                }`}
              >
                {p.status}
              </span>
              <button
                type="button"
                onClick={() => {
                  setEditing(p.slug);
                  setListMode(false);
                }}
                className={BTN_GHOST}
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!window.confirm(`Delete "${p.title}"? This cannot be undone.`)) return;
                  deletePost(p.slug)
                    .then(load)
                    .catch((e: unknown) =>
                      setError(e instanceof Error ? e.message : 'Could not delete.'),
                    );
                }}
                className="text-sm font-bold text-coral-dark hover:underline"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
