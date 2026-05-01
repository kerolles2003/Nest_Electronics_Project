'use client';

import React from 'react';
import { X, ShoppingBag, Trash2, ArrowRight, ShieldCheck } from 'lucide-react';
import { useUIStore } from '@/stores/ui-store';
import { useCartStore } from '@/stores/cart-store';
import { QuantitySelector } from './QuantitySelector';
import Image from 'next/image';
import Link from 'next/link';

export function CartDrawer() {
  const { isCartOpen, closeCart } = useUIStore();
  const { items, removeItem, updateQuantity, subtotal } = useCartStore();

  if (!isCartOpen) return null;

  return (
    <>
      {/* Overlay */}
      <div 
        className="fixed inset-0 bg-black/40 z-50 animate-in fade-in duration-200" 
        onClick={closeCart} 
      />

      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full w-full max-w-sm bg-white shadow-2xl z-50 flex flex-col animate-in slide-in-from-right-full duration-300 ease-out">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-bold text-foreground flex items-center gap-2">
            <ShoppingBag className="w-5 h-5" />
            Your Cart
            {items.length > 0 && (
              <span className="text-sm font-normal text-foreground-muted">
                ({items.length} {items.length === 1 ? 'item' : 'items'})
              </span>
            )}
          </h2>
          <button onClick={closeCart} className="p-2 rounded-full hover:bg-surface transition-colors" aria-label="Close cart">
            <X className="w-5 h-5 text-foreground-muted" />
          </button>
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-foreground-muted px-6 py-12">
              <div className="w-16 h-16 rounded-full bg-surface flex items-center justify-center mb-4">
                <ShoppingBag className="w-8 h-8 text-foreground-subtle" />
              </div>
              <p className="text-foreground font-medium text-sm">Your cart is empty</p>
              <p className="text-foreground-muted text-xs mt-1 mb-6 text-center">Add items to get started</p>
              <button
                onClick={closeCart}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 border border-border text-foreground rounded-md hover:bg-surface text-sm font-medium transition-colors"
              >
                Continue Shopping
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {items.map((item) => {
                const price = item.product.sale_price ?? item.product.base_price;
                const lineTotal = price * item.quantity;
                return (
                  <div key={item.id} className="flex gap-3 px-5 py-4">
                    <div className="w-16 h-16 bg-surface rounded-md border border-border flex-shrink-0 relative overflow-hidden">
                      {item.product.images?.[0]?.url ? (
                        <Image
                          src={item.product.images[0].url}
                          alt={item.product.name_en}
                          fill
                          className="object-contain p-1"
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center text-foreground-subtle text-xs">No Image</div>
                      )}
                    </div>

                    <div className="flex-1 flex flex-col justify-between min-w-0">
                      <div>
                        <div className="flex justify-between items-start gap-2">
                          <h3 className="text-sm font-medium text-foreground line-clamp-2">{item.product.name_en}</h3>
                          <button
                            onClick={() => removeItem(item.id)}
                            className="text-foreground-muted hover:text-danger p-0.5 flex-shrink-0 transition-colors"
                            aria-label="Remove item"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <p className="text-sm text-primary font-semibold mt-0.5">
                          EGP {price.toLocaleString()}
                        </p>
                      </div>

                      <div className="flex items-center justify-between mt-2">
                        <QuantitySelector
                          quantity={item.quantity}
                          onIncrease={() => updateQuantity(item.id, item.quantity + 1)}
                          onDecrease={() => updateQuantity(item.id, item.quantity - 1)}
                          max={item.product.available_stock}
                        />
                        <span className="text-sm font-semibold text-foreground">
                          EGP {lineTotal.toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        {items.length > 0 && (
          <div className="border-t border-border px-5 py-4 space-y-3 bg-surface">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground-muted">Subtotal</span>
              <span className="text-lg font-bold text-foreground">EGP {subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
            </div>
            <p className="text-xs text-foreground-muted">
              Shipping and taxes calculated at checkout.
            </p>
            <Link href="/checkout" onClick={closeCart} className="block">
              <button className="w-full bg-primary text-white py-3 rounded-md font-semibold hover:bg-primary-hover transition-colors flex items-center justify-center gap-2 active:scale-[0.98] transition-transform">
                Proceed to Checkout
                <ArrowRight className="w-4 h-4" />
              </button>
            </Link>
            <div className="flex items-center justify-center gap-1.5 text-xs text-foreground-muted">
              <ShieldCheck className="w-3.5 h-3.5" />
              Secure checkout
            </div>
          </div>
        )}
      </div>
    </>
  );
}
