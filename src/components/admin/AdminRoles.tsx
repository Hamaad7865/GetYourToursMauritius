'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAdminAccess } from '@/components/admin/AdminAccessProvider';
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

const BLANK: Draft = { id: null, name: '', description: '', base: 'team', permissions: [] };

function message(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

/** /admin/roles — the owner builds roles and puts people in them. Owner only (the nav and the page guard
 *  hide it from everyone else; the database refuses every write here from anyone but an Owner). */
export function AdminRoles() {
  const access = useAdminAccess();
  const { user } = useAuth();
  const [tab, setTab] = useState<'roles' | 'team'>('roles');
  const [roles, setRoles] = useState<TeamRole[] | null>(null);
  const [team, setTeam] = useState<TeamMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [r, t] = await Promise.all([loadRoles(), loadTeam()]);
      setRoles(r);
      setTeam(t);
      setError(null);
    } catch (e) {
      setError(message(e, 'Could not load roles.'));
    }
  }, []);

  useEffect(() => {
    if (access.isOwner) void load();
  }, [access.isOwner, load]);

  const memberCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of team ?? []) {
      if (m.teamRoleId) counts.set(m.teamRoleId, (counts.get(m.teamRoleId) ?? 0) + 1);
    }
    return counts;
  }, [team]);

  if (!access.isOwner) {
    return <p className="text-sm text-coral">Only the owner can manage roles.</p>;
  }

  return (
    <div>
      <AdminHeading
        title="Roles"
        subtitle="Decide what each person in the back office can open, and whether they see the business’s money."
      />
      {error && <AdminError>{error}</AdminError>}

      <div
        role="tablist"
        aria-label="Roles and team"
        className="mb-5 inline-flex rounded-xl border border-[#E2E7EA] bg-white p-1"
      >
        {(['roles', 'team'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`rounded-lg px-4 py-2 text-[13.5px] font-bold ${
              tab === t ? 'bg-teal text-white' : 'text-ink-muted hover:text-ink'
            }`}
          >
            {t === 'roles' ? 'Roles' : 'Team'}
          </button>
        ))}
      </div>

      {tab === 'roles' ? (
        <RolesTab roles={roles} memberCount={memberCount} onChanged={load} onError={setError} />
      ) : (
        <TeamTab
          roles={roles ?? []}
          team={team}
          selfId={user?.id ?? null}
          onChanged={load}
          onError={setError}
        />
      )}
    </div>
  );
}

function RolesTab({
  roles,
  memberCount,
  onChanged,
  onError,
}: {
  roles: TeamRole[] | null;
  memberCount: Map<string, number>;
  onChanged: () => Promise<void>;
  onError: (m: string | null) => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!draft) return;
    if (!draft.name.trim()) {
      onError('A role needs a name.');
      return;
    }
    setBusy(true);
    onError(null);
    try {
      await saveRole(draft);
      setDraft(null);
      await onChanged();
    } catch (e) {
      onError(message(e, 'Could not save the role.'));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!draft?.id) return;
    if (!window.confirm(`Delete the role “${draft.name}”?`)) return;
    setBusy(true);
    onError(null);
    try {
      await deleteRole(draft.id);
      setDraft(null);
      await onChanged();
    } catch (e) {
      onError(message(e, 'Could not delete the role.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-[18px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <div className="flex flex-col gap-3">
        <Card title="Owner">
          <p className="text-[13px] text-ink-muted">
            Built in. Sees and changes everything, including this page. Can’t be edited.
          </p>
        </Card>
        {roles === null ? (
          <p className="text-sm text-ink-muted">Loading…</p>
        ) : (
          roles.map((r) => {
            const count = memberCount.get(r.id) ?? 0;
            return (
              <Card key={r.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-[14px] font-extrabold text-ink">{r.name}</h2>
                    <p className="mt-0.5 text-[12.5px] text-ink-muted">
                      {r.base === 'content' ? 'Content only' : 'Team'} · {count}{' '}
                      {count === 1 ? 'person' : 'people'} · {r.permissions.length} permissions
                    </p>
                    {r.description && (
                      <p className="mt-1.5 text-[13px] text-ink">{r.description}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    className={BTN_GHOST}
                    onClick={() =>
                      setDraft({
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
        <button type="button" className={BTN_PRIMARY} onClick={() => setDraft({ ...BLANK })}>
          New role
        </button>
      </div>

      {draft && (
        <RoleEditor
          draft={draft}
          setDraft={setDraft}
          busy={busy}
          members={draft.id ? (memberCount.get(draft.id) ?? 0) : 0}
          onSave={() => void save()}
          onCancel={() => setDraft(null)}
          onDelete={() => void remove()}
        />
      )}
    </div>
  );
}

function RoleEditor({
  draft,
  setDraft,
  busy,
  members,
  onSave,
  onCancel,
  onDelete,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  busy: boolean;
  members: number;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
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
    <Card title={draft.id ? `Edit “${draft.name || 'role'}”` : 'New role'}>
      <div className="grid gap-4">
        <Field label="Name">
          <input
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
          <legend className="mb-1.5 block text-[12.5px] font-bold text-ink/60">Base access</legend>
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

        <div className="flex flex-wrap items-center gap-2.5">
          <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={onSave}>
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
              className="ml-auto text-[13px] font-bold text-coral disabled:opacity-50"
            >
              Delete role
            </button>
          )}
        </div>
        {draft.id && members > 0 && (
          <p className="text-[12px] text-ink-muted">
            {members} {members === 1 ? 'person has' : 'people have'} this role. Move them to another
            role before deleting it.
          </p>
        )}
      </div>
    </Card>
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
}: {
  roles: TeamRole[];
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <select
      className={SELECT_CLS}
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
    >
      {value === '' && <option value="">Choose a role…</option>}
      <option value="owner">Owner — everything</option>
      {roles.map((r) => (
        <option key={r.id} value={r.id}>
          {r.name}
        </option>
      ))}
    </select>
  );
}

function TeamTab({
  roles,
  team,
  selfId,
  onChanged,
  onError,
}: {
  roles: TeamRole[];
  team: TeamMember[] | null;
  selfId: string | null;
  onChanged: () => Promise<void>;
  onError: (m: string | null) => void;
}) {
  const [email, setEmail] = useState('');
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    onError(null);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      onError(message(e, 'Could not save.'));
    } finally {
      setBusy(null);
    }
  }

  function add() {
    const e = email.trim();
    if (!e || !target) {
      onError('Type their email and pick a role.');
      return;
    }
    void run('add', async () => {
      await assignMember({ email: e }, target);
      setEmail('');
      setTarget('');
    });
  }

  return (
    <div className="flex flex-col gap-[18px]">
      <Card title="Add a member">
        <p className="mb-3 text-[13px] text-ink-muted">
          They sign up on the website first, with the email you type here.
        </p>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px_auto] sm:items-end">
          <Field label="Email">
            <input
              type="email"
              className={INPUT_CLS}
              value={email}
              autoComplete="off"
              placeholder="name@example.com"
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="Role">
            <RoleSelect roles={roles} value={target} onChange={setTarget} />
          </Field>
          <button type="button" className={BTN_PRIMARY} disabled={busy === 'add'} onClick={add}>
            {busy === 'add' ? 'Adding…' : 'Add'}
          </button>
        </div>
      </Card>

      <Card title="Team">
        {team === null ? (
          <p className="text-sm text-ink-muted">Loading…</p>
        ) : (
          <ul className="divide-y divide-[#EEF1F3]">
            {team.map((m) => {
              const current = m.role === 'admin' ? 'owner' : (m.teamRoleId ?? '');
              const self = m.userId === selfId;
              const who = m.email ?? m.fullName ?? 'this person';
              return (
                <li key={m.userId} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-bold text-ink">
                      {m.fullName || m.email || 'Unnamed account'}
                      {self && (
                        <span className="ml-1.5 text-[12px] font-semibold text-ink-muted">
                          (you)
                        </span>
                      )}
                    </p>
                    <p className="truncate text-[12.5px] text-ink-muted">{m.email}</p>
                  </div>
                  <div className="w-full sm:w-[220px]">
                    <RoleSelect
                      roles={roles}
                      value={current}
                      disabled={busy === m.userId}
                      ariaLabel={`Role for ${who}`}
                      onChange={(next) => {
                        if (!next || next === current) return;
                        if (
                          self &&
                          current === 'owner' &&
                          !window.confirm('You are giving up your own Owner access. Continue?')
                        )
                          return;
                        void run(m.userId, () => assignMember({ userId: m.userId }, next));
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    disabled={busy === m.userId}
                    onClick={() => {
                      if (
                        !window.confirm(
                          `Remove ${who} from the back office? Their account becomes an ordinary customer account.`,
                        )
                      )
                        return;
                      void run(m.userId, () => removeMember(m.userId));
                    }}
                    className="text-[13px] font-bold text-coral disabled:opacity-50"
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
