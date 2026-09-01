import type { Metadata } from 'next';
import OrderTracker from '@/components/order-tracking/OrderTracker';

export const metadata: Metadata = {
  title: 'Track Your Order | Nest Electronics',
  description: 'Check the real-time status of your Nest Electronics order. Enter your order number and phone to get tracking details.',
};

export default function TrackOrderPage() {
  return (
    <div className="bg-[var(--color-surface)] min-h-[60vh] py-16">
      <section className="max-w-4xl mx-auto px-4">
        <OrderTracker />
      </section>
    </div>
  );
}
