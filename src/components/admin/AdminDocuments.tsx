'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { getBrowserSupabase } from '@/lib/supabase/browser';
import { AdminError, AdminHeading, BTN_GHOST, BTN_PRIMARY, Card } from '@/components/admin/ui';
import { IconPlus, IconSearch } from '@/components/ui/icons';
import { fmtDateShort } from '@/lib/admin/format';
import { CURRENCY_SYMBOL, formatMinor } from '@/lib/documents/money';
import type { DocumentType } from '@/lib/documents/model';
import {
  convertDocument,
  deleteDraft,
  emailDocument,
  issueDocument,
  loadClients,
  loadDocument,
  loadDocuments,
  saveDocument,
  upsertClient,
  voidDocument,
  type DocumentClientRecord,
  type DocumentRecord,
} from '@/lib/admin/documents';
import { ClientPane } from '@/components/admin/documents/ClientPane';
import { LinesEditor } from '@/components/admin/documents/LinesEditor';
import { DetailsPane } from '@/components/admin/documents/DetailsPane';
import { DocumentPreview } from '@/components/admin/documents/DocumentPreview';
import {
  DOCUMENT_PANES,
  STATUS_LABEL,
  TYPE_LABEL,
  documentInputFromForm,
  documentModelFromForm,
  emptyDocumentForm,
  formFromDocument,
  formTotalMinor,
  refusalMessage,
  statusClass,
  type DocumentFormValues,
  type DocumentPaneId,
} from '@/components/admin/documents/state';

const TYPE_FILTERS: Array<{ value: 'all' | DocumentType; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'quote', label: 'Quotes' },
  { value: 'invoice', label: 'Invoices' },
  { value: 'proforma', label: 'Proformas' },
  { value: 'receipt', label: 'Receipts' },
];

const NEW_TYPES: DocumentType[] = ['invoice', 'quote', 'proforma', 'receipt'];

function money(record: { currency: DocumentRecord['currency']; totalMinor: number }): string {
  return `${CURRENCY_SYMBOL[record.currency]} ${formatMinor(record.totalMinor)}`;
}

export function AdminDocuments() {
  const { profile } = useAuth();
  const isStaff = profile?.role === 'admin' || profile?.role === 'staff';
  const [editing, setEditing] = useState<{ id: string | null; type: DocumentType } | null>(null);

  if (profile && !isStaff) {
    return (
      <Card title="Staff only">
        <p className="text-[13.5px] leading-relaxed text-ink-muted">
          Documents carry a client’s name, address and the amounts billed. The content role has no
          access — the tables are staff-only at the database.
        </p>
      </Card>
    );
  }

  return editing ? (
    <DocumentEditor
      id={editing.id}
      initialType={editing.type}
      onClose={() => setEditing(null)}
      onOpen={(id) => setEditing({ id, type: 'invoice' })}
      key={editing.id ?? `new-${editing.type}`}
    />
  ) : (
    <DocumentList
      onOpen={(id) => setEditing({ id, type: 'invoice' })}
      onNew={(type) => setEditing({ id: null, type })}
    />
  );
}

/* --------------------------------------------------------------------------------------------- */
/* The list                                                                                        */
/* --------------------------------------------------------------------------------------------- */

function DocumentList({
  onOpen,
  onNew,
}: {
  onOpen: (id: string) => void;
  onNew: (type: DocumentType) => void;
}) {
  const [rows, setRows] = useState<DocumentRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<'all' | DocumentType>('all');
  const [query, setQuery] = useState('');
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    loadDocuments()
      .then(setRows)
      .catch((err: unknown) => {
        setRows([]);
        setError(refusalMessage(err, 'Could not load the documents.'));
      });
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows ?? []).filter((d) => {
      if (type !== 'all' && d.type !== type) return false;
      if (!q) return true;
      return (
        (d.number ?? '').toLowerCase().includes(q) ||
        (d.client.name ?? '').toLowerCase().includes(q)
      );
    });
  }, [rows, type, query]);

  return (
    <div>
      <AdminHeading
        title="Documents"
        subtitle={rows ? `${filtered.length} of ${rows.length} · newest first` : 'Loading…'}
        action={
          picking ? (
            <span className="flex flex-wrap items-center gap-1.5">
              {NEW_TYPES.map((t) => (
                <button key={t} type="button" onClick={() => onNew(t)} className={BTN_GHOST}>
                  {TYPE_LABEL[t]}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setPicking(false)}
                className="px-2 text-[13px] text-ink-muted"
              >
                Cancel
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => setPicking(true)} className={BTN_PRIMARY}>
              <IconPlus width={16} height={16} /> New document
            </button>
          )
        }
      />

      <div className="mb-4 rounded-2xl border border-[#EAEEF0] bg-white p-3.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex flex-wrap gap-1 rounded-xl bg-[#F4F6F7] p-1">
            {TYPE_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setType(f.value)}
                className={`whitespace-nowrap rounded-lg px-3.5 py-1.5 text-[13px] font-bold ${
                  type === f.value ? 'bg-ink text-white shadow-sm' : 'text-ink-muted hover:text-ink'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="relative min-w-[180px] flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted">
              <IconSearch width={16} height={16} />
            </span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search documents"
              placeholder="Search number or client…"
              className="w-full rounded-xl border border-[#E2E7EA] bg-[#F7F8FA] py-2.5 pl-9 pr-3 text-[13.5px] text-ink outline-none focus:border-teal focus:bg-white"
            />
          </div>
        </div>
      </div>

      {error && <AdminError>{error}</AdminError>}

      <div className="overflow-hidden rounded-2xl border border-[#EAEEF0] bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse">
            <thead>
              <tr className="bg-[#FAFBFC]">
                {['Number', 'Type', 'Client', 'Total', 'Status', 'Date'].map((label) => (
                  <th
                    key={label}
                    className={`whitespace-nowrap px-3 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-ink-muted ${
                      label === 'Total' ? 'text-right' : ''
                    }`}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => (
                <tr
                  key={d.id}
                  onClick={() => onOpen(d.id)}
                  className="cursor-pointer border-t border-[#F2F4F6] hover:bg-[#FAFBFC]"
                >
                  <td className="whitespace-nowrap px-3 py-3 font-mono text-[12.5px] font-bold text-teal">
                    {d.number ?? '—'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-[13px] text-ink">
                    {TYPE_LABEL[d.type]}
                  </td>
                  <td className="px-3 py-3 text-[13.5px] font-bold text-ink">
                    {d.client.name || '—'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right text-[13.5px] font-extrabold text-ink tabular-nums">
                    {money(d)}
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ${statusClass(d.status)}`}
                    >
                      {STATUS_LABEL[d.status] ?? d.status}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-[13px] text-ink/70">
                    {fmtDateShort(d.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows !== null && filtered.length === 0 && (
          <div className="px-6 py-14 text-center">
            <div className="text-[15px] font-bold text-ink">
              {rows.length === 0 ? 'No documents yet' : 'Nothing matches these filters'}
            </div>
            <div className="mt-1 text-[13.5px] text-ink-muted">
              {rows.length === 0
                ? 'Create a quote, invoice, proforma or receipt for any client — in Rs, EUR or USD.'
                : 'Try another type, or clear the search.'}
            </div>
          </div>
        )}
        {rows === null && <p className="p-6 text-sm text-ink-muted">Loading…</p>}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------------------------- */
/* The editor                                                                                      */
/* --------------------------------------------------------------------------------------------- */

function DocumentEditor({
  id,
  initialType,
  onClose,
  onOpen,
}: {
  id: string | null;
  initialType: DocumentType;
  onClose: () => void;
  onOpen: (id: string) => void;
}) {
  const [form, setForm] = useState<DocumentFormValues | null>(
    id ? null : emptyDocumentForm(initialType),
  );
  const [loading, setLoading] = useState(Boolean(id));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pane, setPane] = useState<DocumentPaneId>('client');
  const [remember, setRemember] = useState(false);
  const [clients, setClients] = useState<DocumentClientRecord[]>([]);
  const [dirty, setDirty] = useState(false);

  const reload = useCallback(async (docId: string) => {
    const detail = await loadDocument(docId);
    if (!detail) throw new Error('This document no longer exists.');
    setForm(formFromDocument(detail));
    setDirty(false);
  }, []);

  useEffect(() => {
    loadClients()
      .then(setClients)
      .catch(() => setClients([]));
  }, []);

  useEffect(() => {
    if (!id) return;
    reload(id)
      .catch((err: unknown) => setError(refusalMessage(err, 'Could not load this document.')))
      .finally(() => setLoading(false));
  }, [id, reload]);

  if (loading) return <p className="text-sm text-ink-muted">Loading…</p>;
  if (!form) {
    return (
      <div>
        <AdminError>{error ?? 'Document not found.'}</AdminError>
        <button type="button" onClick={onClose} className={BTN_GHOST}>
          Back to documents
        </button>
      </div>
    );
  }

  const values = form;
  const total = formTotalMinor(values);
  const locked = values.status !== 'draft'; // an issued document is immutable — void + reissue instead
  const isNew = !values.id;

  function onChange(patch: Partial<DocumentFormValues>) {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
    setDirty(true);
    setNotice(null);
  }

  function switchType(type: DocumentType) {
    // A new draft can still change type: keep what has been entered, reset the type-specific defaults.
    const seed = emptyDocumentForm(type);
    onChange({
      type,
      dueDate: seed.dueDate,
      validUntil: seed.validUntil,
      paidAt: seed.paidAt,
    });
  }

  async function act(label: string, run: () => Promise<string | null>) {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      const message = await run();
      if (message) setNotice(message);
    } catch (err) {
      setError(refusalMessage(err, 'That did not go through.'));
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    await act('save', async () => {
      const input = documentInputFromForm(values);
      const savedId = await saveDocument(input);
      // "Remember this client" upserts the bill-to for reuse — best-effort, never blocks the save.
      if (remember && input.client.name) {
        try {
          const saved = await upsertClient({ ...input.client, id: values.clientId ?? undefined });
          setClients(await loadClients());
          setForm((prev) => (prev ? { ...prev, clientId: saved.id } : prev));
        } catch {
          /* the document is saved regardless */
        }
      }
      await reload(savedId);
      return 'Saved.';
    });
  }

  async function issue() {
    if (!values.id) return;
    await act('issue', async () => {
      const issued = await issueDocument(values.id!);
      await reload(issued.id);
      return `Issued as ${issued.number}.`;
    });
  }

  async function convert() {
    if (!values.id) return;
    await act('convert', async () => {
      const newId = await convertDocument(values.id!);
      onOpen(newId);
      return null;
    });
  }

  async function voidDoc() {
    if (!values.id) return;
    if (
      !window.confirm(
        `Void ${values.number ?? 'this document'}? It stays on record but is marked void.`,
      )
    ) {
      return;
    }
    await act('void', async () => {
      await voidDocument(values.id!);
      await reload(values.id!);
      return 'Voided.';
    });
  }

  async function removeDraft() {
    if (!values.id) return;
    if (!window.confirm('Delete this draft? This cannot be undone.')) return;
    await act('delete', async () => {
      await deleteDraft(values.id!);
      onClose();
      return null;
    });
  }

  async function email() {
    if (!values.id) return;
    await act('email', async () => {
      const { recipient } = await emailDocument(values.id!);
      return `Emailed to ${recipient || 'the client'}.`;
    });
  }

  async function downloadPdf() {
    if (!values.id) return;
    await act('download', async () => {
      const { data } = await getBrowserSupabase().auth.getSession();
      const token = data.session?.access_token;
      const res = await fetch(`/api/v1/admin/documents/${values.id}/pdf`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Could not generate the PDF. Save the document first.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${values.type}-${values.number ?? 'draft'}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      return null;
    });
  }

  return (
    <div>
      <AdminHeading
        title={values.number ?? `New ${TYPE_LABEL[values.type].toLowerCase()}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${statusClass(values.status)}`}
            >
              {STATUS_LABEL[values.status] ?? values.status}
            </span>
            <span>
              {TYPE_LABEL[values.type]} ·{' '}
              {total === null
                ? 'Total —'
                : `${CURRENCY_SYMBOL[values.currency]} ${formatMinor(total)}`}
            </span>
            {dirty && <span className="font-bold text-coral">Unsaved changes</span>}
          </span>
        }
        action={
          <span className="flex items-center gap-2">
            <button type="button" onClick={onClose} className={BTN_GHOST}>
              Back
            </button>
            {!locked && (
              <button
                type="button"
                onClick={() => void save()}
                disabled={busy !== null}
                className={BTN_PRIMARY}
              >
                {busy === 'save' ? 'Saving…' : 'Save'}
              </button>
            )}
          </span>
        }
      />

      {error && <AdminError>{error}</AdminError>}
      {notice && (
        <p
          role="status"
          className="mb-4 rounded-xl bg-teal/10 px-4 py-3 text-[13px] font-medium text-teal-dark"
        >
          {notice}
        </p>
      )}
      {locked && (
        <p className="mb-4 rounded-xl bg-gold-light/20 px-4 py-3 text-[13px] leading-relaxed text-ink">
          This document has been issued as <span className="font-bold">{values.number}</span>, so
          its contents are locked. Download it below, or Void it and start a fresh one to make a
          change.
        </p>
      )}

      {isNew && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-ink-muted">Document type:</span>
          <div className="flex flex-wrap gap-1 rounded-xl bg-[#F4F6F7] p-1">
            {NEW_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => switchType(t)}
                className={`rounded-lg px-3 py-1.5 text-[13px] font-bold ${
                  values.type === t
                    ? 'bg-ink text-white shadow-sm'
                    : 'text-ink-muted hover:text-ink'
                }`}
              >
                {TYPE_LABEL[t]}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-5 lg:flex-row">
        <nav
          aria-label="Document sections"
          className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6 lg:sticky lg:top-6 lg:mx-0 lg:w-56 lg:shrink-0 lg:flex-col lg:overflow-visible lg:px-0"
        >
          {DOCUMENT_PANES.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPane(p.id)}
              aria-current={p.id === pane ? 'page' : undefined}
              className={`flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-left text-[13px] font-semibold transition-colors lg:w-full ${
                p.id === pane
                  ? 'bg-teal/10 text-teal-dark'
                  : 'text-ink-muted hover:bg-ink/[0.04] hover:text-ink'
              }`}
            >
              <span className="whitespace-nowrap lg:truncate">{p.label}</span>
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1">
          {pane === 'client' && (
            <ClientPane
              form={values}
              onChange={onChange}
              clients={clients}
              remember={remember}
              onRememberChange={setRemember}
            />
          )}
          {pane === 'lines' && <LinesEditor form={values} onChange={onChange} />}
          {pane === 'details' && <DetailsPane form={values} onChange={onChange} />}
          {pane === 'preview' && (
            <PreviewPane
              form={values}
              busy={busy}
              dirty={dirty}
              onIssue={() => void issue()}
              onDownload={() => void downloadPdf()}
              onEmail={() => void email()}
              onConvert={() => void convert()}
              onVoid={() => void voidDoc()}
              onDelete={() => void removeDraft()}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function PreviewPane({
  form,
  busy,
  dirty,
  onIssue,
  onDownload,
  onEmail,
  onConvert,
  onVoid,
  onDelete,
}: {
  form: DocumentFormValues;
  busy: string | null;
  dirty: boolean;
  onIssue: () => void;
  onDownload: () => void;
  onEmail: () => void;
  onConvert: () => void;
  onVoid: () => void;
  onDelete: () => void;
}) {
  let previewError: string | null = null;
  let model = null;
  try {
    model = documentModelFromForm(form);
  } catch (e) {
    previewError = e instanceof Error ? e.message : 'Check the lines and amounts.';
  }

  const saved = Boolean(form.id);
  const isDraft = form.status === 'draft';

  return (
    <div className="flex flex-col gap-4">
      <Card title="Actions">
        {!saved && (
          <p className="mb-3 rounded-xl bg-[#F7F8FA] px-4 py-3 text-[13px] text-ink-muted">
            Save the document first — then you can issue it a number and download the PDF.
          </p>
        )}
        {saved && dirty && (
          <p className="mb-3 rounded-xl bg-gold-light/20 px-4 py-3 text-[13px] text-ink">
            You have unsaved changes. Save before issuing or downloading, or the PDF shows the
            stored version.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {isDraft && (
            <button
              type="button"
              onClick={onIssue}
              disabled={busy !== null || !saved || dirty}
              className={BTN_PRIMARY}
              title="Allocate the number and lock the document"
            >
              {busy === 'issue' ? 'Issuing…' : 'Issue'}
            </button>
          )}
          <button
            type="button"
            onClick={onDownload}
            disabled={busy !== null || !saved}
            className={BTN_GHOST}
          >
            {busy === 'download' ? 'Preparing…' : 'Download PDF'}
          </button>
          <button
            type="button"
            onClick={onEmail}
            disabled={busy !== null || !saved || !form.client.email.trim()}
            className={BTN_GHOST}
            title={
              form.client.email.trim() ? 'Email the PDF to the client' : 'Add a client email first'
            }
          >
            {busy === 'email' ? 'Sending…' : 'Email to client'}
          </button>
          {form.type === 'quote' &&
            saved &&
            form.status !== 'converted' &&
            form.status !== 'void' && (
              <button
                type="button"
                onClick={onConvert}
                disabled={busy !== null}
                className={BTN_GHOST}
              >
                {busy === 'convert' ? 'Converting…' : 'Convert to invoice'}
              </button>
            )}
          {saved && isDraft && (
            <button
              type="button"
              onClick={onDelete}
              disabled={busy !== null}
              className={`${BTN_GHOST} !border-coral/40 !text-coral hover:!border-coral`}
            >
              {busy === 'delete' ? 'Deleting…' : 'Delete draft'}
            </button>
          )}
          {saved && !isDraft && form.status !== 'void' && (
            <button
              type="button"
              onClick={onVoid}
              disabled={busy !== null}
              className={`${BTN_GHOST} !border-coral/40 !text-coral hover:!border-coral`}
            >
              {busy === 'void' ? 'Voiding…' : 'Void'}
            </button>
          )}
        </div>
      </Card>

      {previewError ? (
        <Card title="Preview">
          <p className="text-[13px] text-coral">{previewError}</p>
        </Card>
      ) : model ? (
        <DocumentPreview model={model} />
      ) : null}
    </div>
  );
}
