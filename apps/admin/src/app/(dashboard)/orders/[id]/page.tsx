import { requireAdmin, getAdminServices } from '@/lib/services';
import OrderDetail from '@/components/orders/OrderDetail';
import { notFound } from 'next/navigation';
import { ArrowLeft, Package } from 'lucide-react';
import Link from 'next/link';

export default async function OrderDetailPage(props: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  const { id } = await props.params;
  const { orderService } = await getAdminServices();
  const order = await orderService.getOrderById(id);
  if (!order) notFound();

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link
          href="/orders"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-all"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Orders
        </Link>
        <div className="h-4 w-px bg-border" />
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-primary" />
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            Order #{order.order_number}
          </h1>
        </div>
      </div>
      <OrderDetail order={order as any} adminId={admin.user.id} />
    </div>
  );
}
