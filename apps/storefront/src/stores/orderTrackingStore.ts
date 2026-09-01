import { create } from 'zustand';
import { Order, OrderLookupInput } from '@nest/types';
import { orderLookupSchema } from '@nest/types'; // Zod schema re-exported via types package
import { getSupabaseBrowserClient } from '@nest/providers';

interface OrderTrackingStore {
  order: Order | null;
  loading: boolean;
  error: string | null;
  attempts: number;
  lastAttemptAt: number | null;
  /**
   * Validate input, enforce simple client‑side rate‑limit, fetch order, and set state.
   */
  fetchOrder: (input: OrderLookupInput) => Promise<void>;
}

export const useOrderTrackingStore = create<OrderTrackingStore>((set, get) => ({
  order: null,
  loading: false,
  error: null,
  attempts: 0,
  lastAttemptAt: null,

  fetchOrder: async (input) => {
    const now = Date.now();

    // ----- rate‑limit guard -----
    if (get().attempts >= 5 && now - (get().lastAttemptAt ?? 0) < 5 * 60_000) {
      set({ error: 'Too many attempts – please wait a few minutes.', loading: false });
      return;
    }

    // ----- validation -----
    try {
      orderLookupSchema.parse(input);
    } catch (e: any) {
      set({ error: e?.errors?.[0]?.message ?? 'Invalid input', loading: false });
      return;
    }

    set({ loading: true, error: null, attempts: get().attempts + 1, lastAttemptAt: now });

    const supabase = getSupabaseBrowserClient() as any;
    const { data: orderData, error } = await supabase
      .from('orders')
      .select('*, items:order_items(*), status_history:order_status_history(*)')
      .eq('order_number', input.order_number)
      .single();

    if (error || !orderData) {
      set({ error: 'Order not found', loading: false, order: null });
      return;
    }

    // Normalize phone numbers for comparison (take last 10 digits to ignore +20/0 variations)
    const normalizePhone = (p: string) => p.replace(/\D/g, '').slice(-10);
    const storedPhone = orderData.shipping_address?.phone ? normalizePhone(orderData.shipping_address.phone) : '';
    const searchPhone = normalizePhone(input.phone);

    if (storedPhone !== searchPhone) {
      set({ error: 'Phone number does not match this order', loading: false, order: null });
      return;
    }

    set({ order: orderData as Order, loading: false, error: null });
  },
}));
