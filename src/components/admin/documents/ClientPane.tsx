'use client';

import { Card, Field, INPUT_CLS, SELECT_CLS } from '@/components/admin/ui';
import type { DocumentClientRecord } from '@/lib/admin/documents';
import type { ClientForm, DocumentFormValues } from './state';

export function ClientPane({
  form,
  onChange,
  clients,
  remember,
  onRememberChange,
}: {
  form: DocumentFormValues;
  onChange: (patch: Partial<DocumentFormValues>) => void;
  clients: DocumentClientRecord[];
  remember: boolean;
  onRememberChange: (value: boolean) => void;
}) {
  const setClient = (field: keyof ClientForm, value: string) =>
    onChange({ client: { ...form.client, [field]: value } });

  const pick = (id: string) => {
    const found = clients.find((c) => c.id === id);
    if (!found) return;
    onChange({
      clientId: found.id,
      client: {
        name: found.name,
        email: found.email ?? '',
        phone: found.phone ?? '',
        street: found.street ?? '',
        locality: found.locality ?? '',
        region: found.region ?? '',
        country: found.country ?? '',
        brn: found.brn ?? '',
        vat: found.vat ?? '',
      },
    });
  };

  const field = (label: string, key: keyof ClientForm, placeholder = '', hint?: string) => (
    <Field label={label} hint={hint}>
      <input
        value={form.client[key]}
        onChange={(e) => {
          // Typing over an auto-filled client detaches it from the saved row — the document keeps its
          // own snapshot, and "remember" would save the edited version as a new/updated client.
          if (form.clientId) onChange({ clientId: null });
          setClient(key, e.target.value);
        }}
        placeholder={placeholder}
        className={INPUT_CLS}
      />
    </Field>
  );

  return (
    <Card title="Who this document is for">
      {clients.length > 0 && (
        <div className="mb-4 border-b border-[#EEF1F3] pb-4">
          <Field label="Use a saved client" hint="Fills the fields below — edit anything after.">
            <select
              value={form.clientId ?? ''}
              onChange={(e) => pick(e.target.value)}
              className={SELECT_CLS}
            >
              <option value="">New client…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {field('Name / company', 'name', 'GLOBALAND (PTY) LTD')}
        {field('Email', 'email', 'accounts@globaland.com')}
        {field('Phone', 'phone', '+230 5 123 4567')}
        {field('Street', 'street', 'Coastal Road, Quatre Cocos')}
        {field('Town / locality', 'locality', 'Quatre Cocos')}
        {field('Region / district', 'region', 'Flacq')}
        {field('Country', 'country', 'Mauritius')}
        {field('BRN', 'brn', 'C012345678', 'Business Registration Number — shown if set.')}
        {field('VAT', 'vat', '20xxxxxx', 'VAT number — shown if set.')}
      </div>

      <label className="mt-4 flex cursor-pointer items-center gap-2 text-[13px] font-semibold text-ink">
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => onRememberChange(e.target.checked)}
          className="h-4 w-4 rounded border-[#CBD3D8] text-teal accent-teal focus:ring-teal"
        />
        Remember this client for next time
      </label>
    </Card>
  );
}
