import { requireAdmin } from "@/lib/services";
import { SectionHeader } from "@nest/ui";

export default async function SettingsPage() {
  await requireAdmin();

  return (
    <div>
      <SectionHeader
        title="Settings"
        description="Configure admin preferences and system settings."
      />
      <div className="flex items-center justify-center py-24 text-muted-foreground text-sm">
        Settings panel coming in Phase 7.
      </div>
    </div>
  );
}
