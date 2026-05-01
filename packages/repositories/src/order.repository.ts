import type { Order, OrderItem, PaginatedResult, Pagination } from '@nest/types';
import type { OrderStatus, PaymentStatus, FulfillmentStatus } from '@nest/types';

export interface CreateOrderInput {
  user_id: string;
  items: Array<{
    product_id: string;
    variant_id?: string;
    name: string;
    sku: string;
    price: number;
    quantity: number;
  }>;
  subtotal: number;
  discount?: number;
  shipping_fee?: number;
  total: number;
  coupon_id?: string;
  shipping_address: object;
  payment_method?: string;
  notes?: string;
}

export interface IOrderRepository {
  findById(id: string): Promise<Order | null>;
  findByOrderNumber(orderNumber: string): Promise<Order | null>;
  findByUserId(userId: string, pagination: Pagination): Promise<PaginatedResult<Order>>;
  findAll(filters: { status?: OrderStatus }, pagination: Pagination): Promise<PaginatedResult<Order>>;
  create(data: CreateOrderInput): Promise<Order>;
  updateOrderStatus(id: string, status: OrderStatus, changedBy?: string, notes?: string): Promise<Order>;
  updatePaymentStatus(id: string, status: PaymentStatus, changedBy?: string): Promise<Order>;
  updateFulfillmentStatus(id: string, status: FulfillmentStatus, changedBy?: string): Promise<Order>;
}
