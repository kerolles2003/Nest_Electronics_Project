import { requireAdmin } from "@/lib/services";
import { SectionHeader } from "@nest/ui";
import { tryApi } from "@/lib/api/client";
import * as api from "@/lib/api/endpoints";
import { ShippingRatesTable } from "@/components/settings/ShippingRatesTable";

export default async function SettingsPage() {
  await requireAdmin();

  const ratesRes = await tryApi(() => api.listShippingRates());
  const initialRates = ratesRes.ok ? ratesRes.data.data : [];

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Settings & Policies"
        description="Configure governorate shipping rates, delivery rules, and platform preferences."
      />
      <ShippingRatesTable initialRates={initialRates} />
    </div>
  );
}
