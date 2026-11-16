'use client';

import { useAdminAccess } from '@/components/admin/AdminAccessProvider';
import { PaymentCurrencyCard } from '@/components/admin/PaymentCurrencyCard';
import { AdminHeading } from '@/components/admin/ui';
import { can } from '@/lib/admin/permissions';
import { WhatsAppNumberCard } from '@/components/admin/WhatsAppNumberCard';
import { ZilAiMaintenanceCard } from '@/components/admin/ZilAiMaintenanceCard';

/**
 * SETTINGS — the site-wide switches that used to sit at the foot of Today: the number behind every
 * "Chat on WhatsApp" link, and ZilAi's maintenance notice. Each card loads and saves itself, exactly as
 * it did on Today (business_settings, staff RLS). How customers' cards are charged (MUR/EUR and the
 * rate) moved here from the Pricing page on the owner's request (16 Nov 2026). It shows only to whoever
 * holds money.currency, as it did there, and the database checks that permission again on save.
 */
export function AdminSettings() {
  const canCurrency = can(useAdminAccess(), 'money.currency');
  return (
    <div>
      <AdminHeading
        title="Settings"
        subtitle="Switches that change the public site for every visitor."
      />
      {canCurrency && (
        <div className="mb-3.5">
          <PaymentCurrencyCard />
        </div>
      )}
      <div className="grid grid-cols-1 items-start gap-3.5 lg:grid-cols-2">
        <WhatsAppNumberCard />
        <ZilAiMaintenanceCard />
      </div>
    </div>
  );
}
