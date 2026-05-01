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
      <div className="fixed inset-0 bg-black/40 z-50" onClick={closeCart} />

      <div className="fixed right-0 top-0 h-full w-full max-w-sm bg-white shadow-2xl z-50 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
            <ShoppingBag className="w-5 h-5" />
            Your Cart
            {items.length > 0 && (
              <span className="text-sm font-normal text-gray-500">
                ({items.length} {items.length === 1 ? 'item' : 'items'})
              </span>
            )}
          </h2>
          <button onClick={closeCart} className="p-2 rounded-full hover:bg-gray-100 transition-colors" aria-label="Close cart">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-400 px-6 py-12">
              <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
                <ShoppingBag className="w-8 h-8 text-gray-300" />
              </div>
              <p className="text-gray-500 font-medium text-sm">Your cart is empty</p>
              <p className="text-gray-400 text-xs mt-1 mb-5 text-center">Add items to get started</p>
              <button
                onClick={closeCart}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 text-sm font-medium transition-colors"
              >
                Continue Shopping
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {items.map((item) => {
                const price = item.product.sale_price ?? item.product.base_price;
                const lineTotal = price * item.quantity;
                return (
                  <div key={item.id} className="flex gap-3 px-5 py-4">
                    <div className="w-16 h-16 bg-gray-50 rounded-md border border-gray-200 flex-shrink-0 relative overflow-hidden">
                      {item.product.images?.[0]?.url ? (
                        <Image
                          src={item.product.images[0].url}
                          alt={item.product.name_en}
                          fill
                          className="object-contain p-1"
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center text-gray-300 text-xs">No Image</div>
                      )}
                    </div>

                    <div className="flex-1 flex flex-col justify-between min-w-0">
                      <div>
                        <div className="flex justify-between items-start gap-2">
                          <h3 className="text-sm font-medium text-gray-900 line-clamp-2">{item.product.name_en}</h3>
                          <button
                            onClick={() => removeItem(item.id)}
                            className="text-gray-400 hover:text-red-500 p-0.5 flex-shrink-0"
                            aria-label="Remove item"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <p className="text-sm text-blue-600 font-semibold mt-0.5">
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
                        <span className="text-sm font-semibold text-gray-900">
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
          <div className="border-t border-gray-200 px-5 py-4 space-y-3 bg-gray-50">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-600">Subtotal</span>
              <span className="text-lg font-bold text-gray-900">EGP {subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
            </div>
            <p className="text-xs text-gray-500">
              Shipping and taxes calculated at checkout.
            </p>
            <Link href="/checkout" onClick={closeCart} className="block">
              <button className="w-full bg-blue-600 text-white py-3 rounded-md font-semibold hover:bg-blue-700 transition-colors flex items-center justify-center gap-2">
                Proceed to Checkout
                <ArrowRight className="w-4 h-4" />
              </button>
            </Link>
            <div className="flex items-center justify-center gap-1.5 text-xs text-gray-400">
              <ShieldCheck className="w-3.5 h-3.5" />
              Secure checkout
            </div>
          </div>
        )}
      </div>
    </>
  );
}
