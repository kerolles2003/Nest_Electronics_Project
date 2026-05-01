import { AdminSidebar } from "@/components/layout/Sidebar";
import { AdminHeader } from "@/components/layout/AdminHeader";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <AdminSidebar />
      <div className="flex flex-col flex-1 overflow-hidden">
        <AdminHeader />
        <main className="flex-1 overflow-y-auto p-6">
          <div className="max-w-[1400px]">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
