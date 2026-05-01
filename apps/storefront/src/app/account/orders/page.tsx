import Link from 'next/link';
import { createClient } from '@/lib/supabase';
import { StatusBadge, Button } from '@nest/ui';
import { Package, AlertTriangle } from 'lucide-react';
import { ROUTES } from '@nest/config/constants';

export const dynamic = 'force-dynamic';

const statusLabels: Record<string, string> = {
  pending_payment: 'Pending Payment',
  paid: 'Paid',
  processing: 'Processing',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  failed: 'Failed',
};

export default async function OrdersPage() {
  try {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="text-center py-16 bg-white border border-gray-200 rounded-md">
        <Package className="w-12 h-12 mx-auto text-gray-300 mb-4" />
        <h2 className="text-lg font-medium text-gray-900">Sign in to view your orders</h2>
        <p className="text-gray-500 mt-1">
          Please sign in to access your orders.
        </p>
        <Link
          href={ROUTES.login}
          className="inline-block mt-4 text-sm font-medium text-blue-600 hover:text-blue-700"
        >
          Sign In
        </Link>
      </div>
    );
  }

  const { data: orders } = await supabase
    .from('orders')
    .select('*, items:order_items(*)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (!orders || orders.length === 0) {
    return (
      <div className="text-center py-16 bg-white border border-gray-200 rounded-md">
        <Package className="w-12 h-12 mx-auto text-gray-300 mb-4" />
        <h2 className="text-lg font-medium text-gray-900">No orders yet</h2>
        <p className="text-gray-500 mt-1">
          Start shopping to see your orders here.
        </p>
        <Link
          href={ROUTES.products}
          className="inline-block mt-4 text-sm font-medium text-blue-600 hover:text-blue-700"
        >
          Browse Products
        </Link>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Your Orders</h2>
      <div className="space-y-3">
      {orders.map((order) => {
        const itemCount = Array.isArray(order.items) ? order.items.length : 0;

        return (
          <Link
            key={order.id}
            href={ROUTES.account.order(order.id)}
            className="block bg-white border border-gray-200 rounded-md p-4 hover:shadow-sm transition-shadow"
          >
            <div className="flex items-start justify-between mb-2">
              <div>
                <p className="text-sm font-semibold text-gray-900">
                  #{order.order_number}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {new Date(order.created_at).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </p>
              </div>
              <StatusBadge status={statusLabels[order.order_status] ?? order.order_status} />
            </div>
            <div className="flex items-center justify-between text-sm pt-2 border-t border-gray-100">
              <span className="text-gray-500">
                {itemCount} {itemCount === 1 ? 'item' : 'items'}
              </span>
              <span className="font-semibold text-gray-900">EGP {order.total.toFixed(2)}</span>
            </div>
          </Link>
        );
      })}
      </div>
    </div>
  );
  } catch (error) {
    return (
      <div className="text-center py-16 bg-white border border-gray-200 rounded-md">
        <AlertTriangle className="w-12 h-12 mx-auto text-red-400 mb-4" />
        <h2 className="text-lg font-medium text-gray-900">Failed to load orders</h2>
        <p className="text-gray-500 mt-1">
          An error occurred while loading your orders.
        </p>
        <Link
          href={ROUTES.account.orders}
          className="inline-block mt-4 text-sm font-medium text-blue-600 hover:text-blue-700"
        >
          Try Again
        </Link>
      </div>
    );
  }
}
