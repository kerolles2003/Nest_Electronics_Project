'use server';

import { createClient } from '@/lib/supabase';
import { shippingAddressSchema } from '@nest/types';
import { logCheckoutFailure, logInventoryError } from '@/lib/logger';

const RPC_ERROR_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /insufficient stock/i, message: 'Product not available' },
  { pattern: /product not available/i, message: 'Product not available' },
  { pattern: /product.*inactive/i, message: 'Product not available' },
  { pattern: /stock.*exceed/i, message: 'Product not available' },
  { pattern: /not enough/i, message: 'Product not available' },
  { pattern: /out of stock/i, message: 'Product not available' },
];

function parseRpcError(error: { message?: string; details?: string }): string {
  const text = `${error.message ?? ''} ${error.details ?? ''}`;

  for (const { pattern, message } of RPC_ERROR_PATTERNS) {
    if (pattern.test(text)) {
      return message;
    }
  }

  return error.message ?? 'An unexpected error occurred while creating your order.';
}

export type CheckoutResponse = {
  success: boolean;
  orderNumber?: string;
  orderId?: string;
  error?: string;
};

export async function createOrderAction(formData: FormData): Promise<CheckoutResponse> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: 'You must be logged in to place an order.' };
    }

    const shippingAddressRaw = {
      full_name: formData.get('shipping_address.full_name') as string,
      phone: formData.get('shipping_address.phone') as string,
      street: formData.get('shipping_address.street') as string,
      city: formData.get('shipping_address.city') as string,
      governorate: formData.get('shipping_address.governorate') as string,
      postal_code: (formData.get('shipping_address.postal_code') as string) || undefined,
    };

    const parsedAddress = shippingAddressSchema.safeParse(shippingAddressRaw);
    if (!parsedAddress.success) {
      logCheckoutFailure({
        userId: user.id,
        reason: 'Invalid shipping address',
        itemsCount: 0,
      });
      return { success: false, error: 'Invalid shipping address' };
    }

    const paymentMethod = formData.get('payment_method') as string;

    const items: Array<{
      product_id: string;
      quantity: number;
      price: number;
    }> = [];

    let i = 0;
    while (formData.has(`items.${i}.product_id`)) {
      items.push({
        product_id: formData.get(`items.${i}.product_id`) as string,
        quantity: Number(formData.get(`items.${i}.quantity`)),
        price: Number(formData.get(`items.${i}.price`)),
      });
      i++;
    }

    if (items.length === 0) {
      return { success: false, error: 'Cart is empty' };
    }

    const { data: result, error: rpcError } = await supabase.rpc('create_order_v2', {
      p_user_id: user.id,
      p_items: items.map(item => ({
        product_id: item.product_id,
        variant_id: null,
        quantity: item.quantity
      })),
      p_shipping_address: parsedAddress.data,
      p_payment_method: paymentMethod,
      p_shipping_fee: 0,
    });

    if (rpcError) {
      const parsedMessage = parseRpcError(rpcError);

      logCheckoutFailure({
        userId: user.id,
        reason: parsedMessage,
        itemsCount: items.length,
        rpcError: rpcError.message,
      });

      return { success: false, error: parsedMessage };
    }

    // Sanity check: verify order exists by fetching it back
    const { data: verifiedOrder, error: verifyError } = await supabase
      .from('orders')
      .select('id, order_number')
      .eq('id', result.id)
      .single();

    if (verifyError || !verifiedOrder) {
      logInventoryError({
        userId: user.id,
        productId: 'N/A',
        error: `Order sanity check failed: order ${result.id} not found after creation`,
      });

      return {
        success: false,
        error: 'Order could not be verified after creation. Please contact support.',
      };
    }

    return {
      success: true,
      orderNumber: verifiedOrder.order_number,
      orderId: verifiedOrder.id,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'An unexpected error occurred.',
    };
  }
}
