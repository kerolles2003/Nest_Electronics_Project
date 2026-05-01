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

  const { items, updateQuantity, subtotal, clearCart } = useCartStore();

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
      <div className="flex items-center gap-2 mb-8">
        {STEPS.map((s, i) => (
          <React.Fragment key={s.label}>
            <div className="flex items-center">
              <div
                className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-semibold transition-colors ${
                  i < step
                    ? 'bg-green-500 text-white'
                    : i === step
                      ? 'bg-blue-600 text-white'
                      : 'border border-gray-300 text-gray-400'
                }`}
              >
                {i < step ? <Check className="w-4 h-4" /> : i + 1}
              </div>
              <span
                className={`ml-2 text-sm font-medium hidden sm:inline ${
                  i === step ? 'text-gray-900' : i < step ? 'text-gray-500' : 'text-gray-400'
                }`}
              >
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={`flex-1 h-px ${
                  i < step ? 'bg-green-500' : 'bg-gray-200'
                }`}
              />
            )}
          </React.Fragment>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          {step === 0 && (
            <div className="bg-white border border-gray-200 rounded-md p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-6 flex items-center gap-2">
                <MapPin className="w-5 h-5 text-gray-500" />
                Shipping Information
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Full Name</label>
                  <input
                    type="text"
                    value={shippingData.full_name}
                    onChange={(e) => updateField('full_name', e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    placeholder="Ahmed Mohamed"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Phone</label>
                  <input
                    type="tel"
                    value={shippingData.phone}
                    onChange={(e) => updateField('phone', e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    placeholder="01012345678"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Street Address</label>
                  <input
                    type="text"
                    value={shippingData.street}
                    onChange={(e) => updateField('street', e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    placeholder="123 Main Street, Apt 4"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">City</label>
                  <input
                    type="text"
                    value={shippingData.city}
                    onChange={(e) => updateField('city', e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    placeholder="Cairo"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Governorate</label>
                  <select
                    value={shippingData.governorate}
                    onChange={(e) => updateField('governorate', e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
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
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Postal Code (optional)</label>
                  <input
                    type="text"
                    value={shippingData.postal_code}
                    onChange={(e) => updateField('postal_code', e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    placeholder="12345"
                  />
                </div>
              </div>

              <div className="mt-8 flex justify-end">
                <button
                  onClick={() => setStep(1)}
                  disabled={!isShippingFormValid}
                  className="bg-blue-600 text-white px-6 py-2.5 rounded-md font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  Continue to Review
                </button>
              </div>
            </div>
          )}

          {step === 1 && (
            <>
              <div className="bg-white border border-gray-200 rounded-md p-6">
                <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <ClipboardList className="w-5 h-5 text-gray-500" />
                  Order Review
                </h2>

                <div className="divide-y divide-gray-100">
                  {items.map((item) => (
                    <div key={item.id} className="flex gap-4 py-4">
                      <div className="w-16 h-16 bg-gray-50 rounded-md border border-gray-200 flex-shrink-0 relative overflow-hidden">
                        {item.product.images?.[0]?.url ? (
                          <Image
                            src={item.product.images[0].url}
                            alt={item.product.name_en}
                            fill
                            className="object-contain p-1"
                          />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center text-gray-300 text-xs">
                            No Image
                          </div>
                        )}
                      </div>

                      <div className="flex-1">
                        <h3 className="font-medium text-sm text-gray-900 line-clamp-2">
                          {item.product.name_en}
                        </h3>
                        <p className="text-sm text-blue-600 font-semibold mt-1">
                          EGP {item.product.sale_price ?? item.product.base_price}
                        </p>
                        <div className="mt-2">
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

                      <div className="text-right">
                        <p className="text-sm font-semibold text-gray-900">
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

              <div className="bg-white border border-gray-200 rounded-md p-6">
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-gray-500" />
                  Shipping Address
                </h3>
                <div className="text-sm text-gray-600 space-y-1">
                  <p className="font-medium text-gray-900">{shippingData.full_name}</p>
                  <p>{shippingData.phone}</p>
                  <p>{shippingData.street}</p>
                  <p>
                    {shippingData.city}, {shippingData.governorate}
                    {shippingData.postal_code && ` ${shippingData.postal_code}`}
                  </p>
                </div>
                <button
                  onClick={() => setStep(0)}
                  className="text-sm text-blue-600 hover:underline mt-3"
                >
                  Edit
                </button>
              </div>

              {orderError && (
                <div className="border border-red-300 bg-red-50 rounded-md p-4 text-sm text-red-600">
                  {orderError}
                </div>
              )}

              <div className="flex justify-between items-center">
                <button
                  onClick={() => setStep(0)}
                  className="px-6 py-2.5 border border-gray-300 text-gray-700 rounded-md font-medium hover:bg-gray-50 transition-colors"
                >
                  Back to Shipping
                </button>
                <button
                  onClick={handlePlaceOrder}
                  disabled={isSubmitting}
                  className="bg-blue-600 text-white px-6 py-2.5 rounded-md font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-2"
                >
                  {isSubmitting ? 'Placing Order...' : 'Place Order'}
                  <PackageCheck className="w-4 h-4" />
                </button>
              </div>
            </>
          )}
        </div>

        <div className="lg:col-span-1">
          <div className="bg-white border border-gray-200 rounded-md p-4 sticky top-24">
            <h3 className="text-base font-semibold text-gray-900 mb-3">Order Summary</h3>

            <div className="divide-y divide-gray-100">
              {items.map((item) => (
                <div key={item.id} className="flex justify-between py-2 text-sm">
                  <span className="text-gray-600">
                    {item.product.name_en}{' '}
                    <span className="text-gray-400">×{item.quantity}</span>
                  </span>
                  <span className="text-gray-900 font-medium">
                    EGP {(
                      (item.product.sale_price ?? item.product.base_price) *
                      item.quantity
                    ).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>

            <div className="flex justify-between font-semibold text-lg text-gray-900 pt-3 border-t border-gray-200 mt-3">
              <span>Total</span>
              <span>EGP {subtotal.toFixed(2)}</span>
            </div>

            <p className="text-xs text-gray-500 mt-3">
              Payment will be collected upon delivery (Cash on Delivery).
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
