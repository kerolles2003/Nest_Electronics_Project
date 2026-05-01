import type { IOrderRepository } from '@nest/repositories';
import type { Order, Cart, ShippingAddress, PaginatedResult, Pagination } from '@nest/types';
import { OrderStatus, PaymentStatus, FulfillmentStatus } from '@nest/types';

export class OrderService {
  constructor(private orderRepo: IOrderRepository) {}

  async createOrderFromCart(userId: string, cart: Cart, shippingAddress: ShippingAddress, notes?: string, couponId?: string): Promise<Order> {
    if (!cart.items.length) throw new Error('Cannot create order from empty cart');

    const subtotal = cart.subtotal;
    const discount = 0; // coupon logic handled before calling this
    const shipping_fee = 0; // MVP: free shipping or flat rate
    const total = subtotal - discount + shipping_fee;

    return this.orderRepo.create({
      user_id: userId,
      items: cart.items.map(item => ({
        product_id: item.productId,
        variant_id: item.variantId ?? undefined,
        name: item.name ?? '',
        sku: item.sku ?? '',
        price: item.price ?? 0,
        quantity: item.quantity,
      })),
      subtotal,
      discount,
      shipping_fee,
      total,
      coupon_id: couponId,
      shipping_address: shippingAddress,
      payment_method: 'cod',
      notes,
    });
  }

  async getOrderById(id: string): Promise<Order | null> {
    return this.orderRepo.findById(id);
  }

  async getUserOrders(userId: string, pagination: Pagination): Promise<PaginatedResult<Order>> {
    return this.orderRepo.findByUserId(userId, pagination);
  }

  async getAllOrders(filters: { status?: OrderStatus }, pagination: Pagination): Promise<PaginatedResult<Order>> {
    return this.orderRepo.findAll(filters, pagination);
  }

  async confirmOrder(orderId: string, adminId: string): Promise<Order> {
    return this.orderRepo.updateOrderStatus(orderId, OrderStatus.PAID, adminId, 'COD confirmed');
  }

  async shipOrder(orderId: string, adminId: string): Promise<Order> {
    await this.orderRepo.updateFulfillmentStatus(orderId, FulfillmentStatus.SHIPPED, adminId);
    return this.orderRepo.updateOrderStatus(orderId, OrderStatus.SHIPPED, adminId);
  }

  async deliverOrder(orderId: string, adminId: string): Promise<Order> {
    await this.orderRepo.updatePaymentStatus(orderId, PaymentStatus.PAID, adminId);
    await this.orderRepo.updateFulfillmentStatus(orderId, FulfillmentStatus.DELIVERED, adminId);
    return this.orderRepo.updateOrderStatus(orderId, OrderStatus.DELIVERED, adminId);
  }

  async cancelOrder(orderId: string, adminId: string, notes?: string): Promise<Order> {
    return this.orderRepo.updateOrderStatus(orderId, OrderStatus.CANCELLED, adminId, notes);
  }
}
