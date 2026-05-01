import type { SupabaseClient } from '@supabase/supabase-js';
import type { IOrderRepository, CreateOrderInput } from '@nest/repositories';
import type { Order, PaginatedResult, Pagination } from '@nest/types';
import type { OrderStatus, PaymentStatus, FulfillmentStatus } from '@nest/types';

export class SupabaseOrderProvider implements IOrderRepository {
  constructor(private client: SupabaseClient) {}

  async findById(id: string): Promise<Order | null> {
    const { data } = await this.client
      .from('orders')
      .select('*, items:order_items(*), status_history:order_status_history(*)')
      .eq('id', id).single();
    return data as Order | null;
  }

  async findByOrderNumber(orderNumber: string): Promise<Order | null> {
    const { data } = await this.client
      .from('orders').select('*, items:order_items(*)')
      .eq('order_number', orderNumber).single();
    return data as Order | null;
  }

  async findByUserId(userId: string, pagination: Pagination): Promise<PaginatedResult<Order>> {
    const from = (pagination.page - 1) * pagination.limit;
    const to = from + pagination.limit - 1;
    const { data, count } = await this.client
      .from('orders').select('*, items:order_items(*)', { count: 'exact' })
      .eq('user_id', userId).order('created_at', { ascending: false }).range(from, to);
    const total = count ?? 0;
    return { data: (data ?? []) as Order[], total, page: pagination.page, limit: pagination.limit, totalPages: Math.ceil(total / pagination.limit) };
  }

  async findAll(filters: { status?: OrderStatus }, pagination: Pagination): Promise<PaginatedResult<Order>> {
    const from = (pagination.page - 1) * pagination.limit;
    const to = from + pagination.limit - 1;
    let query = this.client.from('orders').select('*, items:order_items(*)', { count: 'exact' });
    if (filters.status) query = query.eq('order_status', filters.status);
    const { data, count } = await query.order('created_at', { ascending: false }).range(from, to);
    const total = count ?? 0;
    return { data: (data ?? []) as Order[], total, page: pagination.page, limit: pagination.limit, totalPages: Math.ceil(total / pagination.limit) };
  }

  async create(data: CreateOrderInput): Promise<Order> {
    const { items, ...orderData } = data;
    const { data: order, error } = await this.client.from('orders').insert(orderData).select().single();
    if (error || !order) throw new Error(`Failed to create order: ${error?.message}`);
    await this.client.from('order_items').insert(items.map(item => ({ ...item, order_id: order.id, total: item.price * item.quantity })));
    return order as Order;
  }

  async updateOrderStatus(id: string, status: OrderStatus, changedBy?: string, notes?: string): Promise<Order> {
    const { data: current } = await this.client.from('orders').select('order_status').eq('id', id).single();
    await this.client.from('order_status_history').insert({ order_id: id, field: 'order_status', from_value: current?.['order_status'], to_value: status, changed_by: changedBy, notes });
    const { data, error } = await this.client.from('orders').update({ order_status: status }).eq('id', id).select().single();
    if (error || !data) throw new Error(`Failed to update order status: ${error?.message}`);
    return data as Order;
  }

  async updatePaymentStatus(id: string, status: PaymentStatus, changedBy?: string): Promise<Order> {
    const { data: current } = await this.client.from('orders').select('payment_status').eq('id', id).single();
    await this.client.from('order_status_history').insert({ order_id: id, field: 'payment_status', from_value: current?.['payment_status'], to_value: status, changed_by: changedBy });
    const { data, error } = await this.client.from('orders').update({ payment_status: status }).eq('id', id).select().single();
    if (error || !data) throw new Error(`Failed to update payment status: ${error?.message}`);
    return data as Order;
  }

  async updateFulfillmentStatus(id: string, status: FulfillmentStatus, changedBy?: string): Promise<Order> {
    const { data: current } = await this.client.from('orders').select('fulfillment_status').eq('id', id).single();
    await this.client.from('order_status_history').insert({ order_id: id, field: 'fulfillment_status', from_value: current?.['fulfillment_status'], to_value: status, changed_by: changedBy });
    const { data, error } = await this.client.from('orders').update({ fulfillment_status: status }).eq('id', id).select().single();
    if (error || !data) throw new Error(`Failed to update fulfillment status: ${error?.message}`);
    return data as Order;
  }
}
