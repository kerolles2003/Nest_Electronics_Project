'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ShoppingBag } from 'lucide-react';
import { useCartStore } from '@/stores/cart-store';
import { Button } from '@nest/ui';
import { CheckoutStepper } from '@/components/CheckoutStepper';
import { ROUTES } from '@nest/config/constants';

export default function CheckoutPage() {
  const { items } = useCartStore();
  const [orderNumber, setOrderNumber] = useState<string | null>(null);

  if (items.length === 0 && !orderNumber) {
    return (
      <div className="container mx-auto px-4 py-24 max-w-7xl min-h-[60vh] flex flex-col items-center justify-center">
        <div className="max-w-lg w-full mx-auto text-center border border-border/50 rounded-3xl bg-card p-12 shadow-sm">
          <div className="w-24 h-24 mx-auto bg-surface rounded-full flex items-center justify-center mb-6">
            <ShoppingBag className="w-12 h-12 text-primary/40" strokeWidth={1.5} />
          </div>
          <h1 className="text-3xl font-bold mb-3 text-foreground">Your cart is empty</h1>
          <p className="text-foreground-muted mb-8 text-lg">
            Add some products to your cart before checking out.
          </p>
          <Link href={ROUTES.products}>
            <Button className="w-full h-14 rounded-2xl text-base font-bold shadow-md hover:-translate-y-0.5 transition-all">
              Continue Shopping
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface-low min-h-screen pb-16">
      <div className="bg-card border-b border-border/50 pt-10 pb-10 mb-10 text-center">
        <h1 className="text-3xl sm:text-4xl font-black text-foreground mb-2">Checkout</h1>
        <p className="text-foreground-muted">Complete your order securely</p>
      </div>
      <div className="container mx-auto px-4 max-w-6xl">
        <CheckoutStepper onOrderCreated={setOrderNumber} />
      </div>
    </div>
  );
}
