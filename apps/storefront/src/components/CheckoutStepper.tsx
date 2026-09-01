'use client';

import React, { useState, useCallback } from 'react';
import { Check, MapPin, ClipboardList, PackageCheck } from 'lucide-react';
import { useCartStore } from '@/stores/cart-store';
import { QuantitySelector } from '@/components/QuantitySelector';
import { EGYPTIAN_GOVERNORATES } from '@nest/config/constants';
import { createOrderAction } from '@/actions/checkout.actions';
import Image from 'next/image';

interface CheckoutStepperProps {
  onOrderCreated: (orderNumber: string) => void;
}

type ShippingFormData = {
  full_name: string;
  phone: string;
  street: string;
  city: string;
  governorate: string;
  postal_code: string;
};

const STEPS = [
  { label: 'Shipping', icon: MapPin },
  { label: 'Review', icon: ClipboardList },
  { label: 'Confirmation', icon: PackageCheck },
] as const;

export function CheckoutStepper({ onOrderCreated }: CheckoutStepperProps) {
  const [step, setStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [shippingData, setShippingData] = useState<ShippingFormData>({
    full_name: '',
    phone: '',
    street: '',
    city: '',
    governorate: '',
    postal_code: '',
  });

  const { items, updateQuantity, clearCart } = useCartStore();
  const subtotal = items.reduce((acc, item) => acc + (item.product.sale_price ?? item.product.base_price) * item.quantity, 0);

  const updateField = useCallback(
    (field: keyof ShippingFormData, value: string) => {
      setShippingData((prev) => ({ ...prev, [field]: value }));
    },
    []
  );

  const handlePlaceOrder = useCallback(async () => {
    setIsSubmitting(true);
    setOrderError(null);

    try {
      const formData = new FormData();
      formData.append('shipping_address.full_name', shippingData.full_name);
      formData.append('shipping_address.phone', shippingData.phone);
      formData.append('shipping_address.street', shippingData.street);
      formData.append('shipping_address.city', shippingData.city);
      formData.append('shipping_address.governorate', shippingData.governorate);
      if (shippingData.postal_code) {
        formData.append('shipping_address.postal_code', shippingData.postal_code);
      }
      formData.append('payment_method', 'cod');

      items.forEach((item, index) => {
        formData.append(`items.${index}.product_id`, item.product_id);
        formData.append(`items.${index}.quantity`, String(item.quantity));
        formData.append(`items.${index}.price`, String(item.product.sale_price ?? item.product.base_price));
      });

      const result = await createOrderAction(formData);

      if (result.success && result.orderNumber) {
        clearCart();
        onOrderCreated(result.orderNumber);
        setStep(2);
      } else {
        setOrderError(result.error ?? 'Failed to create order. Please try again.');
      }
    } catch {
      setOrderError('An unexpected error occurred. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, [shippingData, items, onOrderCreated, clearCart]);

  const isShippingFormValid =
    shippingData.full_name.trim().length >= 2 &&
    shippingData.phone.trim().length > 0 &&
    shippingData.street.trim().length >= 5 &&
    shippingData.city.trim().length >= 2 &&
    shippingData.governorate.length > 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-10 max-w-2xl mx-auto">
        {STEPS.map((s, i) => (
          <React.Fragment key={s.label}>
            <div className="flex flex-col items-center gap-2">
              <div
                className={`flex items-center justify-center w-12 h-12 rounded-full text-base font-bold transition-all duration-300 ${
                  i < step
                    ? 'bg-success text-white shadow-md'
                    : i === step
                      ? 'bg-primary text-white shadow-md ring-4 ring-primary/20'
                      : 'bg-surface border border-border text-foreground-muted'
                }`}
              >
                {i < step ? <Check className="w-5 h-5" strokeWidth={3} /> : i + 1}
              </div>
              <span
                className={`text-sm font-semibold hidden sm:block ${
                  i === step ? 'text-foreground' : i < step ? 'text-foreground' : 'text-foreground-muted'
                }`}
              >
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={`flex-1 h-1.5 rounded-full mx-4 sm:mx-6 transition-colors duration-300 ${
                  i < step ? 'bg-success' : 'bg-surface border border-border'
                }`}
              />
            )}
          </React.Fragment>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          {step === 0 && (
            <div className="bg-card border border-border/50 rounded-3xl p-8 shadow-sm">
              <h2 className="text-2xl font-bold text-foreground mb-8 flex items-center gap-3">
                <MapPin className="w-6 h-6 text-primary" />
                Shipping Information
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div>
                  <label className="block text-[13px] font-bold text-foreground mb-2">Full Name</label>
                  <input
                    type="text"
                    value={shippingData.full_name}
                    onChange={(e) => updateField('full_name', e.target.value)}
                    className="w-full bg-surface border border-border rounded-xl px-4 py-3 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-colors text-foreground"
                    placeholder="Ahmed Mohamed"
                  />
                </div>

                <div>
                  <label className="block text-[13px] font-bold text-foreground mb-2">Phone</label>
                  <input
                    type="tel"
                    value={shippingData.phone}
                    onChange={(e) => updateField('phone', e.target.value)}
                    className="w-full bg-surface border border-border rounded-xl px-4 py-3 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-colors text-foreground"
                    placeholder="01012345678"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-[13px] font-bold text-foreground mb-2">Street Address</label>
                  <input
                    type="text"
                    value={shippingData.street}
                    onChange={(e) => updateField('street', e.target.value)}
                    className="w-full bg-surface border border-border rounded-xl px-4 py-3 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-colors text-foreground"
                    placeholder="123 Main Street, Apt 4"
                  />
                </div>

                <div>
                  <label className="block text-[13px] font-bold text-foreground mb-2">City</label>
                  <input
                    type="text"
                    value={shippingData.city}
                    onChange={(e) => updateField('city', e.target.value)}
                    className="w-full bg-surface border border-border rounded-xl px-4 py-3 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-colors text-foreground"
                    placeholder="Cairo"
                  />
                </div>

                <div>
                  <label className="block text-[13px] font-bold text-foreground mb-2">Governorate</label>
                  <select
                    value={shippingData.governorate}
                    onChange={(e) => updateField('governorate', e.target.value)}
                    className="w-full bg-surface border border-border rounded-xl px-4 py-3 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-colors text-foreground"
                  >
                    <option value="">Select Governorate</option>
                    {EGYPTIAN_GOVERNORATES.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[13px] font-bold text-foreground mb-2">Postal Code (optional)</label>
                  <input
                    type="text"
                    value={shippingData.postal_code}
                    onChange={(e) => updateField('postal_code', e.target.value)}
                    className="w-full bg-surface border border-border rounded-xl px-4 py-3 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-colors text-foreground"
                    placeholder="12345"
                  />
                </div>
              </div>

              <div className="mt-10 flex justify-end">
                <button
                  onClick={() => setStep(1)}
                  disabled={!isShippingFormValid}
                  className="bg-primary text-white px-8 py-3.5 rounded-xl font-bold hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]"
                >
                  Continue to Review
                </button>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-6">
              <div className="bg-card border border-border/50 rounded-3xl p-8 shadow-sm">
                <h2 className="text-2xl font-bold text-foreground mb-6 flex items-center gap-3">
                  <ClipboardList className="w-6 h-6 text-primary" />
                  Order Review
                </h2>

                <div className="divide-y divide-border/50">
                  {items.map((item) => (
                    <div key={item.id} className="flex gap-4 py-5">
                      <div className="w-20 h-20 bg-surface rounded-xl border border-border/50 flex-shrink-0 relative overflow-hidden">
                        {item.product.images?.[0]?.url ? (
                          <Image
                            src={item.product.images[0].url}
                            alt={item.product.name_en}
                            fill
                            className="object-contain p-2"
                          />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center text-foreground-subtle text-xs">
                            No Image
                          </div>
                        )}
                      </div>

                      <div className="flex-1 flex flex-col justify-center">
                        <h3 className="font-semibold text-sm text-foreground line-clamp-2 mb-1">
                          {item.product.name_en}
                        </h3>
                        <p className="text-sm text-primary font-bold">
                          EGP {item.product.sale_price ?? item.product.base_price}
                        </p>
                        <div className="mt-3 inline-block">
                          <QuantitySelector
                            quantity={item.quantity}
                            onIncrease={() =>
                              updateQuantity(item.id, item.quantity + 1)
                            }
                            onDecrease={() =>
                              updateQuantity(item.id, item.quantity - 1)
                            }
                            max={item.product.available_stock}
                          />
                        </div>
                      </div>

                      <div className="text-right flex flex-col justify-center">
                        <p className="text-base font-bold text-foreground">
                          EGP {(
                            (item.product.sale_price ?? item.product.base_price) *
                            item.quantity
                          ).toFixed(2)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-card border border-border/50 rounded-3xl p-8 shadow-sm relative overflow-hidden">
                <div className="absolute top-0 left-0 w-1.5 h-full bg-primary" />
                <h3 className="font-bold text-foreground mb-4 flex items-center gap-2 text-lg">
                  <MapPin className="w-5 h-5 text-primary" />
                  Shipping Address
                </h3>
                <div className="text-[15px] text-foreground-muted space-y-1.5">
                  <p className="font-bold text-foreground">{shippingData.full_name}</p>
                  <p>{shippingData.phone}</p>
                  <p>{shippingData.street}</p>
                  <p>
                    {shippingData.city}, {shippingData.governorate}
                    {shippingData.postal_code && ` ${shippingData.postal_code}`}
                  </p>
                </div>
                <button
                  onClick={() => setStep(0)}
                  className="text-sm font-bold text-primary hover:text-primary-hover hover:underline mt-4 inline-block"
                >
                  Edit Address
                </button>
              </div>

              {orderError && (
                <div className="border border-danger/20 bg-danger/5 rounded-2xl p-5 text-sm font-medium text-danger flex items-center gap-3">
                  <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  {orderError}
                </div>
              )}

              <div className="flex justify-between items-center pt-4">
                <button
                  onClick={() => setStep(0)}
                  className="px-6 py-3.5 border border-border text-foreground font-bold rounded-xl hover:bg-surface transition-colors"
                >
                  Back to Shipping
                </button>
                <button
                  onClick={handlePlaceOrder}
                  disabled={isSubmitting}
                  className="bg-primary text-white px-8 py-3.5 rounded-xl font-bold hover:bg-primary-hover disabled:opacity-50 transition-all flex items-center gap-2 hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]"
                >
                  {isSubmitting ? 'Placing Order...' : 'Place Order'}
                  <PackageCheck className="w-5 h-5" />
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="lg:col-span-1">
          <div className="bg-[#f8f8f8] dark:bg-surface-low border border-border/50 rounded-3xl p-6 sticky top-24 shadow-sm">
            <h3 className="text-xl font-bold text-foreground mb-6">Order Summary</h3>

            <div className="divide-y divide-border/50">
              {items.map((item) => (
                <div key={item.id} className="flex justify-between py-3 text-[13px]">
                  <span className="text-foreground-muted flex-1 pr-4">
                    {item.product.name_en}{' '}
                    <span className="text-foreground font-bold">×{item.quantity}</span>
                  </span>
                  <span className="text-foreground font-bold whitespace-nowrap">
                    EGP {(
                      (item.product.sale_price ?? item.product.base_price) *
                      item.quantity
                    ).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>

            <div className="flex justify-between font-black text-xl text-foreground pt-4 border-t border-border/50 mt-4">
              <span>Total</span>
              <span className="text-primary">EGP {subtotal.toFixed(2)}</span>
            </div>

            <div className="mt-6 bg-card p-4 rounded-2xl border border-border/50 flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-success/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <svg className="w-4 h-4 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
              </div>
              <div>
                <h4 className="text-[13px] font-bold text-foreground">Cash on Delivery</h4>
                <p className="text-xs text-foreground-muted mt-1 leading-relaxed">
                  Payment will be collected upon delivery. No card required.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
