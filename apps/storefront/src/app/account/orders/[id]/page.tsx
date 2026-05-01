import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import { StatusBadge } from '@nest/ui';
import { ArrowLeft, Package } from 'lucide-react';
import { OrderStatus } from '@nest/types';
import { ROUTES } from '@nest/config/constants';

export const dynamic = 'force-dynamic';

const statusLabels: Record<string, string> = {
  [OrderStatus.PENDING_PAYMENT]: 'Pending Payment',
  [OrderStatus.PAID]: 'Paid',
  [OrderStatus.PROCESSING]: 'Processing',
  [OrderStatus.SHIPPED]: 'Shipped',
  [OrderStatus.DELIVERED]: 'Delivered',
  [OrderStatus.CANCELLED]: 'Cancelled',
  [OrderStatus.FAILED]: 'Failed',
};

const statusStepColors: Record<string, string> = {
  [OrderStatus.PENDING_PAYMENT]: 'bg-amber-400',
  [OrderStatus.PAID]: 'bg-blue-400',
  [OrderStatus.PROCESSING]: 'bg-blue-400',
  [OrderStatus.SHIPPED]: 'bg-sky-400',
  [OrderStatus.DELIVERED]: 'bg-green-500',
  [OrderStatus.CANCELLED]: 'bg-red-400',
  [OrderStatus.FAILED]: 'bg-red-400',
};

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient() as any;
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    notFound();
  }

  const { data: order } = await supabase
    .from('orders')
    .select('*, items:order_items(*), status_history:order_status_history(*)')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (!order) {
    notFound();
  }

  const statusHistory = Array.isArray(order.status_history)
    ? [...order.status_history].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )
    : [];

  return (
    <div className="space-y-6">
      <Link
        href={ROUTES.account.orders}
        className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-blue-600 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Orders
      </Link>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Order #{order.order_number}</h2>
          <p className="text-sm text-gray-400 mt-1">
            Placed on{' '}
            {new Date(order.created_at).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </p>
        </div>
        <StatusBadge status={statusLabels[order.order_status] ?? order.order_status} className="self-start sm:self-center text-sm px-3 py-1" />
      </div>

      {statusHistory.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-md p-6">
          <h3 className="font-semibold text-gray-900 mb-4">Status Timeline</h3>
          <div className="space-y-4">
            {statusHistory.map((entry, index) => (
              <div key={entry.id} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div
                    className={`w-2.5 h-2.5 rounded-full mt-1.5 ${
                      statusStepColors[entry.to_value] ?? 'bg-gray-300'
                    }`}
                  />
                  {index < statusHistory.length - 1 && (
                    <div className="w-0.5 flex-1 bg-gray-200 mt-1" />
                  )}
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-700 capitalize">
                    {entry.to_value.replace(/_/g, ' ')}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {new Date(entry.created_at).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}{' '}
                    at{' '}
                    {new Date(entry.created_at).toLocaleTimeString('en-US', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                  {entry.notes && (
                    <p className="text-xs text-gray-400 mt-0.5">{entry.notes}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-md p-6">
        <h3 className="font-semibold text-gray-900 mb-4">Items</h3>
        <div className="space-y-3">
          {Array.isArray(order.items) &&
            (order.items as any[]).map((item: any) => (
              <div
                key={item.id}
                className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{item.name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {item.sku} &middot; Qty: {item.quantity}
                  </p>
                </div>
                <div className="text-right ml-4">
                  <p className="text-sm font-semibold text-gray-900">EGP {item.total.toFixed(2)}</p>
                  <p className="text-xs text-gray-400">
                    EGP {item.price.toFixed(2)} each
                  </p>
                </div>
              </div>
            ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white border border-gray-200 rounded-md p-6">
          <h3 className="font-semibold text-gray-900 mb-3">Shipping Address</h3>
          {order.shipping_address ? (
            <div className="text-sm space-y-1">
              <p className="font-medium text-gray-900">{order.shipping_address.full_name}</p>
              <p className="text-gray-500">{order.shipping_address.phone}</p>
              <p className="text-gray-500">{order.shipping_address.street}</p>
              <p className="text-gray-500">
                {order.shipping_address.city}, {order.shipping_address.governorate}
              </p>
              {order.shipping_address.postal_code && (
                <p className="text-gray-500">{order.shipping_address.postal_code}</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-400">No shipping address available.</p>
          )}
        </div>

        <div className="bg-white border border-gray-200 rounded-md p-6">
          <h3 className="font-semibold text-gray-900 mb-3">Order Summary</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Subtotal</span>
              <span className="text-gray-900">EGP {order.subtotal.toFixed(2)}</span>
            </div>
            {order.discount > 0 && (
              <div className="flex justify-between">
                <span className="text-gray-500">Discount</span>
                <span className="text-green-600">-EGP {order.discount.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-gray-500">Shipping</span>
              <span className="text-gray-900">EGP {order.shipping_fee.toFixed(2)}</span>
            </div>
            {order.tax > 0 && (
              <div className="flex justify-between">
                <span className="text-gray-500">Tax</span>
                <span className="text-gray-900">EGP {order.tax.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-gray-200 pt-3 font-semibold text-base text-gray-900">
              <span>Total</span>
              <span>EGP {order.total.toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
