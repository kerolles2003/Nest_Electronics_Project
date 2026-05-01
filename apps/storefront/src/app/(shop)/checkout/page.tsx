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
      <div className="container mx-auto px-4 py-16 max-w-7xl">
        <div className="max-w-md mx-auto text-center border rounded-xl bg-card p-8">
          <ShoppingBag className="w-16 h-16 mx-auto text-muted-foreground/30 mb-4" />
          <h1 className="text-2xl font-bold mb-2">Your cart is empty</h1>
          <p className="text-muted-foreground mb-6">
            Add some products to your cart before checking out.
          </p>
          <Link href={ROUTES.products}>
            <Button>Continue Shopping</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <h1 className="text-3xl font-bold tracking-tight mb-8">Checkout</h1>
      <CheckoutStepper onOrderCreated={setOrderNumber} />
    </div>
  );
}
