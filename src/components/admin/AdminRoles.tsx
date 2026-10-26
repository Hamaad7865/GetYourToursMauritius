'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAdminAccess, useAdminAccessStatus } from '@/components/admin/AdminAccessProvider';
import {
  AdminError,
  AdminHeading,
  BTN_GHOST,
  BTN_PRIMARY,
  Card,
  Field,
  INPUT_CLS,
  SELECT_CLS,
  TEXTAREA_CLS,
} from '@/components/admin/ui';
import {
  CONTENT_PERMISSIONS,
  MONEY_PERMISSIONS,
  SECTION_PERMISSIONS,
  type PermissionKey,
  type PermissionMeta,
  type RoleBase,
} from '@/lib/admin/permissions';
import {
  assignMember,
  deleteRole,
  loadRoles,
  loadTeam,
  removeMember,
  saveRole,
  type TeamMember,
  type TeamRole,
} from '@/lib/admin/team';

const CONTENT_SET = new Set<PermissionKey>(CONTENT_PERMISSIONS);

const BASES: Array<{ value: RoleBase; label: string; hint: string }> = [
  { value: 'team', label: 'Team', hint: 'Can work with guests: bookings, quotes, leads…' },
  {
    value: 'content',
    label: 'Content only',
    hint: 'Never sees guests or money. For writers and SEO help.',
  },
];

interface Draft {
  id: string | null;
  name: string;
  description: string;
  base: RoleBase;
  permissions: PermissionKey[];
}

/** The role being edited. `original` is what was loaded, so "unsaved changes" is a real comparison, and
 *  the title keeps showing the SAVED name while the Name box is being typed in. `nonce` changes on every
 *  open, so the editor scrolls into view and takes focus when it is opened (not on every keystroke). */
interface EditorState {
  draft: Draft;
  original: Draft;
  nonce: number;
}

/** `null` = no operation running; otherwise which one ('role', 'add', or the member's user id). Lifted so
 *  that while one operation runs, every control on both tabs is off — no two writes race. */
type Busy = string | null;

const OWNER_TEXT = 'They will see all money and can manage roles.';
const SELF_DEMOTE_TEXT = 'You are giving up your own Owner access. Continue?';
const SELF_REMOVE_TEXT = 'Remove yourself from the back office? You will lose access immediately.';

function blankDraft(): Draft {
  return { id: null, name: '', description: '', base: 'team', permissions: [] };
}

function message(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

function sameDraft(a: Draft, b: Draft): boolean {
  return (
    a.name === b.name &&
    a.description === b.description &&
    a.base === b.base &&
    a.permissions.length === b.permissions.length &&
    a.permissions.every((k) => b.permissions.includes(k))
  );
}

/** The role-select value for someone: 'owner', their role's id, or '' (a back-office account with none). */
function currentRoleOf(m: TeamMember): string {
  return m.role === 'admin' ? 'owner' : (m.teamRoleId ?? '');
}

function whoOf(m: TeamMember): string {
  return m.email ?? m.fullName ?? 'this person';
}

/**
 * The question to ask before a change that grants or takes away Owner — or null when neither side of it
 * is Owner. Owner is the one role that can see all the money and change everyone's access, so it never
 * happens on a single click.
 */
function ownerChangeQuestion(opts: {
  who: string;
  self: boolean;
  from: string;
  to: string;
  toName: string;
}): string | null {
  if (opts.to === 'owner' && opts.from !== 'owner') {
    return `Make ${opts.who} an Owner? ${OWNER_TEXT}`;
  }
  if (opts.from === 'owner' && opts.to !== 'owner') {
    return opts.self
      ? SELF_DEMOTE_TEXT
      : `Remove ${opts.who}’s Owner access? They will get the ${opts.toName} role.`;
  }
  return null;
}

/** An error (assertive) or a short success line (polite), shown next to the action that caused it. */
function Status({ error, notice }: { error?: string | null; notice?: string | null }) {
  if (error) {
    return (
      <p
        role="alert"
        className="rounded-xl bg-coral/10 px-3 py-2 text-[13px] font-medium text-coral-dark"
      >
        {error}
      </p>
    );
  }
  if (notice) {
    return (
      <p role="status" className="text-[13px] font-semibold text-teal-dark">
        {notice}
      </p>
    );
  }
  return null;
}

/** /admin/roles — the owner builds roles and puts people in them. Owner only (the nav and the page guard
 *  hide it from everyone else; the database refuses every write here from anyone but an Owner). */
export function AdminRoles() {
  const access = useAdminAccess();
  const { retry } = useAdminAccessStatus();
  const { user, refreshProfile } = useAuth();
  const [tab, setTab] = useState<'roles' | 'team'>('roles');
  const [roles, setRoles] = useState<TeamRole[] | null>(null);
  const [team, setTeam] = useState<TeamMember[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Lifted so a half-written role survives a trip to the Team tab and back.
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [busy, setBusy] = useState<Busy>(null);

  const load = useCallback(async () => {
    try {
      const [r, t] = await Promise.all([loadRoles(), loadTeam()]);
      setRoles(r);
      setTeam(t);
      setLoadError(null);
    } catch (e) {
      setLoadError(message(e, 'Could not load roles.'));
    }
  }, []);

  useEffect(() => {
    if (access.isOwner) void load();
  }, [access.isOwner, load]);

  // After the signed-in Owner leaves the Owner role (or the back office), the team list is no longer
  // theirs to read — reloading it would show a false "only the owner" error. Re-read their access
  // instead, so the shell's guard takes over.
  const onSelfExit = useCallback(async () => {
    try {
      await Promise.all([retry(), refreshProfile()]);
    } catch {
      // The guard re-checks on its own the next time the tab is shown.
    }
  }, [retry, refreshProfile]);

  const memberCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of team ?? []) {
      if (m.teamRoleId) counts.set(m.teamRoleId, (counts.get(m.teamRoleId) ?? 0) + 1);
    }
    return counts;
  }, [team]);

  const ownerCount = useMemo(
    () => (team === null ? null : team.filter((m) => m.role === 'admin').length),
    [team],
  );

  if (!access.isOwner) {
    return <p className="text-sm text-coral-dark">Only the owner can manage roles.</p>;
  }

  return (
    <div>
      <AdminHeading
        title="Roles"
        subtitle="Decide what each person in the back office can open, and whether they see the business’s money."
      />
      {loadError && (
        <AdminError>
          {loadError}
          <button
            type="button"
            onClick={() => void load()}
            className="ml-2 px-2 py-1 font-bold underline"
          >
            Try again
          </button>
        </AdminError>
      )}

      <div
        role="group"
        aria-label="Roles and team"
        className="mb-5 inline-flex rounded-xl border border-[#E2E7EA] bg-white p-1"
      >
        {(['roles', 'team'] as const).map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={tab === t}
            disabled={busy !== null}
            onClick={() => setTab(t)}
            className={`rounded-lg px-4 py-2 text-[13.5px] font-bold disabled:opacity-50 ${
              tab === t ? 'bg-teal text-white' : 'text-ink-muted hover:text-ink'
            }`}
          >
            {t === 'roles' ? 'Roles' : 'Team'}
          </button>
        ))}
      </div>

      {tab === 'roles' ? (
        <RolesTab
          roles={roles}
          memberCount={memberCount}
          ownerCount={ownerCount}
          editor={editor}
          setEditor={setEditor}
          busy={busy}
          setBusy={setBusy}
          onChanged={load}
        />
      ) : (
        <TeamTab
          roles={roles ?? []}
          team={team}
          selfId={user?.id ?? null}
          busy={busy}
          setBusy={setBusy}
          onChanged={load}
          onSelfExit={onSelfExit}
        />
      )}
    </div>
  );
}

function RolesTab({
  roles,
  memberCount,
  ownerCount,
  editor,
  setEditor,
  busy,
  setBusy,
  onChanged,
}: {
  roles: TeamRole[] | null;
  memberCount: Map<string, number>;
  ownerCount: number | null;
  editor: EditorState | null;
  setEditor: Dispatch<SetStateAction<EditorState | null>>;
  busy: Busy;
  setBusy: (b: Busy) => void;
  onChanged: () => Promise<void>;
}) {
  const [editorError, setEditorError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Where focus goes once the editor closes: the role's Edit button, or New role.
  const focusKey = useRef<string | null>(null);
  const [focusTick, setFocusTick] = useState(0);

  useEffect(() => {
    const key = focusKey.current;
    if (!key) return;
    focusKey.current = null;
    document.querySelector<HTMLElement>(`[data-focus-key="${key}"]`)?.focus();
  }, [focusTick, roles]);

  function focusAfter(key: string) {
    focusKey.current = key;
    setFocusTick((t) => t + 1);
  }

  const dirty = editor !== null && !sameDraft(editor.draft, editor.original);

  function open(next: Draft) {
    if (editor && dirty) {
      const name = editor.original.id
        ? editor.original.name
        : editor.draft.name.trim() || 'the new role';
      if (!window.confirm(`Discard your unsaved changes to ${name}?`)) return;
    }
    setEditorError(null);
    setNotice(null);
    setEditor({ draft: next, original: next, nonce: Date.now() });
  }

  function cancel() {
    if (!editor) return;
    const id = editor.original.id;
    setEditor(null);
    setEditorError(null);
    focusAfter(id ? `edit:${id}` : 'new');
  }

  async function save() {
    if (!editor) return;
    const { draft } = editor;
    if (!draft.name.trim()) {
      setEditorError('A role needs a name.');
      return;
    }
    setBusy('role');
    setEditorError(null);
    setNotice(null);
    try {
      const id = await saveRole(draft);
      setEditor(null);
      await onChanged();
      setNotice('Saved.');
      focusAfter(`edit:${id}`);
    } catch (e) {
      setEditorError(message(e, 'Could not save the role.'));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    const id = editor?.original.id;
    if (!editor || !id) return;
    const name = editor.original.name;
    if (!window.confirm(`Delete the role “${name}”?`)) return;
    setBusy('role');
    setEditorError(null);
    setNotice(null);
    try {
      await deleteRole(id);
      setEditor(null);
      await onChanged();
      setNotice(`Deleted “${name}”.`);
      focusAfter('new');
    } catch (e) {
      setEditorError(message(e, 'Could not delete the role.'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-[18px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <div className="flex flex-col gap-3">
        <Status notice={notice} />
        <Card title="Owner">
          {ownerCount !== null && (
            <p className="mb-1 text-[12.5px] text-ink-muted">
              {ownerCount} {ownerCount === 1 ? 'person' : 'people'}
            </p>
          )}
          <p className="text-[13px] text-ink-muted">
            Built in. Sees and changes everything, including this page. Can’t be edited.
          </p>
        </Card>
        {roles === null ? (
          <p className="text-sm text-ink-muted">Loading…</p>
        ) : (
          roles.map((r) => {
            const count = memberCount.get(r.id) ?? 0;
            const permissions = r.permissions.length;
            return (
              <Card key={r.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-[14px] font-extrabold text-ink">{r.name}</h2>
                    <p className="mt-0.5 text-[12.5px] text-ink-muted">
                      {r.base === 'content' ? 'Content only' : 'Team'} · {count}{' '}
                      {count === 1 ? 'person' : 'people'} · {permissions}{' '}
                      {permissions === 1 ? 'permission' : 'permissions'}
                    </p>
                    {r.description && (
                      <p className="mt-1.5 text-[13px] text-ink">{r.description}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    className={BTN_GHOST}
                    data-focus-key={`edit:${r.id}`}
                    aria-label={`Edit ${r.name}`}
                    disabled={busy !== null}
                    onClick={() =>
                      open({
                        id: r.id,
                        name: r.name,
                        description: r.description ?? '',
                        base: r.base,
                        permissions: [...r.permissions],
                      })
                    }
                  >
                    Edit
                  </button>
                </div>
              </Card>
            );
          })
        )}
        <button
          type="button"
          className={BTN_PRIMARY}
          data-focus-key="new"
          disabled={busy !== null}
          onClick={() => open(blankDraft())}
        >
          New role
        </button>
      </div>

      {editor && (
        <RoleEditor
          editor={editor}
          setDraft={(draft) => setEditor({ ...editor, draft })}
          busy={busy === 'role'}
          error={editorError}
          members={editor.original.id ? (memberCount.get(editor.original.id) ?? 0) : 0}
          onSave={() => void save()}
          onCancel={cancel}
          onDelete={() => void remove()}
        />
      )}
    </div>
  );
}

function RoleEditor({
  editor,
  setDraft,
  busy,
  error,
  members,
  onSave,
  onCancel,
  onDelete,
}: {
  editor: EditorState;
  setDraft: (d: Draft) => void;
  busy: boolean;
  error: string | null;
  members: number;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const { draft, original, nonce } = editor;
  const rootRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // On a phone the editor sits below the list: bring it into view and put the cursor in the Name box.
  useEffect(() => {
    rootRef.current?.scrollIntoView?.({ block: 'nearest' });
    nameRef.current?.focus({ preventScroll: true });
  }, [nonce]);

  const content = draft.base === 'content';
  const toggle = (key: PermissionKey) =>
    setDraft({
      ...draft,
      permissions: draft.permissions.includes(key)
        ? draft.permissions.filter((k) => k !== key)
        : [...draft.permissions, key],
    });
  const setBase = (base: RoleBase) =>
    setDraft({
      ...draft,
      base,
      permissions:
        base === 'content'
          ? draft.permissions.filter((k) => CONTENT_SET.has(k))
          : draft.permissions,
    });
  const locked = (key: PermissionKey) => content && !CONTENT_SET.has(key);

  return (
    <div ref={rootRef} className="scroll-mt-24 lg:self-start">
      <Card title={original.id ? `Edit “${original.name || 'role'}”` : 'New role'}>
        <form
          className="grid gap-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (!busy) onSave();
          }}
        >
          <Field label="Name">
            <input
              ref={nameRef}
              className={INPUT_CLS}
              value={draft.name}
              maxLength={60}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Reservations"
            />
          </Field>
          <Field label="Description" hint="Optional — what this role is for.">
            <textarea
              className={TEXTAREA_CLS}
              rows={2}
              maxLength={300}
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
          </Field>

          <fieldset>
            <legend className="mb-1.5 block text-[12.5px] font-bold text-ink/60">
              Base access
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {BASES.map((b) => (
                <label
                  key={b.value}
                  className={`flex gap-2.5 rounded-xl border p-3 ${
                    draft.base === b.value ? 'border-teal bg-teal/5' : 'border-[#E2E7EA]'
                  } ${draft.id ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                >
                  <input
                    type="radio"
                    name="role-base"
                    className="mt-0.5 accent-teal"
                    checked={draft.base === b.value}
                    disabled={Boolean(draft.id)}
                    onChange={() => setBase(b.value)}
                  />
                  <span>
                    <span className="block text-[13.5px] font-bold text-ink">{b.label}</span>
                    <span className="block text-[12px] text-ink-muted">{b.hint}</span>
                  </span>
                </label>
              ))}
            </div>
            {draft.id && (
              <p className="mt-1.5 text-[12px] text-ink-muted">
                Base access is fixed once a role exists. Make a new role to change it.
              </p>
            )}
          </fieldset>

          <PermissionGroup
            title="Sections"
            items={SECTION_PERMISSIONS}
            selected={draft.permissions}
            locked={locked}
            onToggle={toggle}
          />
          <PermissionGroup
            title="Money"
            items={MONEY_PERMISSIONS}
            selected={draft.permissions}
            locked={locked}
            onToggle={toggle}
          />
          {content && (
            <p className="text-[12px] text-ink-muted">
              Content-only roles can’t open guest data or money, so those boxes are off.
            </p>
          )}

          <Status error={error} />

          <div className="flex flex-wrap items-center gap-2.5">
            <button type="submit" className={BTN_PRIMARY} disabled={busy}>
              {busy ? 'Saving…' : 'Save role'}
            </button>
            <button type="button" className={BTN_GHOST} disabled={busy} onClick={onCancel}>
              Cancel
            </button>
            {draft.id && (
              <button
                type="button"
                disabled={busy || members > 0}
                onClick={onDelete}
                className="ml-auto px-2 py-1.5 text-[13px] font-bold text-coral-dark disabled:opacity-50"
              >
                Delete role
              </button>
            )}
          </div>
          {draft.id && members > 0 && (
            <p className="text-[12px] text-ink-muted">
              {members} {members === 1 ? 'person has' : 'people have'} this role. Move them to
              another role before deleting it.
            </p>
          )}
        </form>
      </Card>
    </div>
  );
}

function PermissionGroup({
  title,
  items,
  selected,
  locked,
  onToggle,
}: {
  title: string;
  items: readonly PermissionMeta[];
  selected: readonly PermissionKey[];
  locked: (key: PermissionKey) => boolean;
  onToggle: (key: PermissionKey) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 block text-[12.5px] font-bold text-ink/60">{title}</legend>
      <div className="grid gap-1 sm:grid-cols-2">
        {items.map((p) => {
          const off = locked(p.key);
          return (
            <label
              key={p.key}
              className={`flex gap-2.5 rounded-lg px-2 py-1.5 ${
                off ? 'opacity-50' : 'cursor-pointer hover:bg-[#F7F8FA]'
              }`}
            >
              <input
                type="checkbox"
                className="mt-0.5 accent-teal"
                checked={selected.includes(p.key)}
                disabled={off}
                onChange={() => onToggle(p.key)}
              />
              <span>
                <span className="block text-[13.5px] font-semibold text-ink">{p.label}</span>
                <span className="block text-[12px] text-ink-muted">{p.hint}</span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function RoleSelect({
  roles,
  value,
  onChange,
  disabled,
  ariaLabel,
  orphan,
  placeholder = value === '',
}: {
  roles: TeamRole[];
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
  /** The person's current role when it is not in `roles` (the list failed to load): shown as it is,
   *  rather than letting the box claim they are an Owner. */
  orphan?: { value: string; label: string };
  /** Offer "Choose a role…" (the empty choice). A row for someone with no role keeps it, so a stray key
   *  can always be undone by choosing it again. */
  placeholder?: boolean;
}) {
  return (
    <select
      className={SELECT_CLS}
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
    >
      {placeholder && <option value="">Choose a role…</option>}
      <option value="owner">Owner — everything</option>
      {orphan && <option value={orphan.value}>{orphan.label}</option>}
      {roles.map((r) => (
        <option key={r.id} value={r.id}>
          {r.name}
        </option>
      ))}
    </select>
  );
}

/**
 * One person in the Team list. The role box only CHOOSES — nothing is saved until "Change" is clicked.
 * A focused closed <select> changes value on ArrowUp/ArrowDown and on type-ahead (Windows especially),
 * so saving on change would let a stray key make someone an Owner.
 */
function MemberRow({
  m,
  roles,
  self,
  disabled,
  onChange,
  onRemove,
}: {
  m: TeamMember;
  roles: TeamRole[];
  self: boolean;
  disabled: boolean;
  onChange: (to: string) => void;
  onRemove: () => void;
}) {
  const current = currentRoleOf(m);
  // The parent keys this row by its current role, so a saved change starts the row afresh.
  const [choice, setChoice] = useState(current);
  const who = whoOf(m);
  const known = current === '' || current === 'owner' || roles.some((r) => r.id === current);

  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-1.5 text-[13.5px] font-bold text-ink">
          <span className="truncate">{m.fullName || m.email || 'Unnamed account'}</span>
          {self && <span className="shrink-0 text-[12px] font-semibold text-ink-muted">(you)</span>}
        </p>
        {m.fullName && m.email && (
          <p className="truncate text-[12.5px] text-ink-muted">{m.email}</p>
        )}
        {current === '' && (
          <p className="mt-0.5 text-[12px] text-ink-muted">
            No role yet — they can only see the Dashboard
          </p>
        )}
      </div>
      <div className="w-full sm:w-[220px]">
        <RoleSelect
          roles={roles}
          value={choice}
          placeholder={current === ''}
          disabled={disabled}
          ariaLabel={`Role for ${who}`}
          orphan={known ? undefined : { value: current, label: m.teamRoleName ?? 'Unknown role' }}
          onChange={setChoice}
        />
      </div>
      {choice !== current && choice !== '' && (
        <button
          type="button"
          className={BTN_GHOST}
          disabled={disabled}
          aria-label={`Change role for ${who}`}
          onClick={() => onChange(choice)}
        >
          Change
        </button>
      )}
      <button
        type="button"
        disabled={disabled}
        aria-label={`Remove ${who}`}
        onClick={onRemove}
        className="px-2 py-1.5 text-[13px] font-bold text-coral-dark disabled:opacity-50"
      >
        Remove
      </button>
    </li>
  );
}

function TeamTab({
  roles,
  team,
  selfId,
  busy,
  setBusy,
  onChanged,
  onSelfExit,
}: {
  roles: TeamRole[];
  team: TeamMember[] | null;
  selfId: string | null;
  busy: Busy;
  setBusy: (b: Busy) => void;
  onChanged: () => Promise<void>;
  onSelfExit: () => Promise<void>;
}) {
  const [email, setEmail] = useState('');
  const [target, setTarget] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [addNotice, setAddNotice] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [listNotice, setListNotice] = useState<string | null>(null);

  const roleName = (id: string) =>
    id === 'owner' ? 'Owner' : (roles.find((r) => r.id === id)?.name ?? 'that role');

  /** Run one team operation. `leavesBackOffice`: the signed-in Owner is the person being changed, so the
   *  list is reloaded by re-reading their own access instead (see AdminRoles.onSelfExit). */
  async function run(
    area: 'add' | 'list',
    key: string,
    fn: () => Promise<string>,
    leavesBackOffice = false,
  ) {
    setBusy(key);
    setAddError(null);
    setAddNotice(null);
    setListError(null);
    setListNotice(null);
    try {
      const done = await fn();
      if (leavesBackOffice) await onSelfExit();
      else await onChanged();
      if (area === 'add') setAddNotice(done);
      else setListNotice(done);
    } catch (e) {
      const text = message(e, 'Could not save.');
      if (area === 'add') setAddError(text);
      else setListError(text);
    } finally {
      setBusy(null);
    }
  }

  function add(e: FormEvent) {
    e.preventDefault();
    const typed = email.trim();
    if (!typed || !target) {
      setAddNotice(null);
      setAddError('Type their email and pick a role.');
      return;
    }
    const toName = roleName(target);
    const existing = (team ?? []).find(
      (m) => m.email?.trim().toLowerCase() === typed.toLowerCase(),
    );
    let question: string | null = null;
    let leavesBackOffice = false;
    if (existing) {
      const from = currentRoleOf(existing);
      if (from === target) {
        setAddError(null);
        setAddNotice(`${typed} already has the ${toName} role.`);
        return;
      }
      const self = existing.userId === selfId;
      leavesBackOffice = self && from === 'owner' && target !== 'owner';
      question = leavesBackOffice
        ? SELF_DEMOTE_TEXT
        : `${typed} is already in the team as ${from === '' ? 'someone with no role yet' : roleName(from)} — change them to ${toName}?` +
          (target === 'owner' ? ` ${OWNER_TEXT}` : '') +
          (from === 'owner' ? ' They will lose their Owner access.' : '');
    } else if (target === 'owner') {
      question = `Make ${typed} an Owner? ${OWNER_TEXT}`;
    }
    if (question && !window.confirm(question)) return;
    void run(
      'add',
      'add',
      async () => {
        await assignMember({ email: typed }, target);
        setEmail('');
        setTarget('');
        return existing ? `${typed} is now ${toName}.` : `Added ${typed} as ${toName}.`;
      },
      leavesBackOffice,
    );
  }

  function changeRole(m: TeamMember, to: string) {
    const from = currentRoleOf(m);
    const who = whoOf(m);
    const self = m.userId === selfId;
    const question = ownerChangeQuestion({ who, self, from, to, toName: roleName(to) });
    if (question && !window.confirm(question)) return;
    void run(
      'list',
      m.userId,
      async () => {
        await assignMember({ userId: m.userId }, to);
        return `${who} is now ${roleName(to)}.`;
      },
      self && from === 'owner' && to !== 'owner',
    );
  }

  function remove(m: TeamMember) {
    const who = whoOf(m);
    const self = m.userId === selfId;
    const question = self
      ? SELF_REMOVE_TEXT
      : `Remove ${who} from the back office? Their account becomes an ordinary customer account.`;
    if (!window.confirm(question)) return;
    void run(
      'list',
      m.userId,
      async () => {
        await removeMember(m.userId);
        return `${who} was removed.`;
      },
      self,
    );
  }

  const disabled = busy !== null;

  return (
    <div className="flex flex-col gap-[18px]">
      <Card title="Add a member">
        <p className="mb-3 text-[13px] text-ink-muted">
          They sign up on the website first and click the link in their confirmation email, then you
          add them here with that email.
        </p>
        <form
          className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px_auto] sm:items-end"
          onSubmit={add}
        >
          <Field label="Email">
            <input
              type="email"
              className={INPUT_CLS}
              value={email}
              autoComplete="off"
              placeholder="name@example.com"
              disabled={disabled}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="Role">
            <RoleSelect roles={roles} value={target} disabled={disabled} onChange={setTarget} />
          </Field>
          <button type="submit" className={BTN_PRIMARY} disabled={disabled}>
            {busy === 'add' ? 'Adding…' : 'Add'}
          </button>
        </form>
        {(addError || addNotice) && (
          <div className="mt-3">
            <Status error={addError} notice={addNotice} />
          </div>
        )}
      </Card>

      <Card title="Team">
        {(listError || listNotice) && (
          <div className="mb-3">
            <Status error={listError} notice={listNotice} />
          </div>
        )}
        {team === null ? (
          <p className="text-sm text-ink-muted">Loading…</p>
        ) : (
          <ul className="divide-y divide-[#EEF1F3]">
            {team.map((m) => (
              <MemberRow
                key={`${m.userId}:${currentRoleOf(m)}`}
                m={m}
                roles={roles}
                self={m.userId === selfId}
                disabled={disabled}
                onChange={(to) => changeRole(m, to)}
                onRemove={() => remove(m)}
              />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
