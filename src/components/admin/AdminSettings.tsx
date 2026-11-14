'use client';

import { AdminHeading } from '@/components/admin/ui';
import { WhatsAppNumberCard } from '@/components/admin/WhatsAppNumberCard';
import { ZilAiMaintenanceCard } from '@/components/admin/ZilAiMaintenanceCard';

/**
 * SETTINGS — the site-wide switches that used to sit at the foot of Today: the number behind every
 * "Chat on WhatsApp" link, and ZilAi's maintenance notice. Each card loads and saves itself, exactly as
 * it did on Today (business_settings, staff RLS). How cards are charged (MUR/EUR and the rate) stays on
 * the Pricing page, beside the fares.
 */
export function AdminSettings() {
  return (
    <div>
      <AdminHeading
        title="Settings"
        subtitle="Switches that change the public site for every visitor."
      />
      <div className="grid grid-cols-1 items-start gap-3.5 lg:grid-cols-2">
        <WhatsAppNumberCard />
        <ZilAiMaintenanceCard />
      </div>
    </div>
  );
}
