'use server'

import { z } from 'zod'
import { createClient } from '@/lib/supabase'
import { OrderStatus, PaymentStatus, FulfillmentStatus } from '@nest/types'
import { requireAdmin } from '@/lib/services'
import { logAdminAction } from '@/lib/audit/log-action'
import { logger } from '@/lib/logger'
import { revalidatePath } from 'next/cache'

const orderStatusValues = Object.values(OrderStatus) as [string, ...string[]]
const paymentStatusValues = Object.values(PaymentStatus) as [string, ...string[]]
const fulfillmentStatusValues = Object.values(FulfillmentStatus) as [string, ...string[]]

const orderIdSchema = z.object({
  orderId: z.string().uuid(),
})

const updateOrderStatusSchema = orderIdSchema.extend({
  status: z.enum(orderStatusValues),
  notes: z.string().max(1000).optional(),
})

const updatePaymentStatusSchema = orderIdSchema.extend({
  status: z.enum(paymentStatusValues),
  notes: z.string().max(1000).optional(),
})

const updateFulfillmentStatusSchema = orderIdSchema.extend({
  status: z.enum(fulfillmentStatusValues),
  trackingNumber: z.string().max(200).optional(),
  notes: z.string().max(1000).optional(),
})

const VALID_ORDER_TRANSITIONS: Record<string, string[]> = {
  [OrderStatus.PENDING_PAYMENT]: [OrderStatus.PAID, OrderStatus.CANCELLED, OrderStatus.FAILED],
  [OrderStatus.PAID]: [OrderStatus.PROCESSING, OrderStatus.CANCELLED],
  [OrderStatus.PROCESSING]: [OrderStatus.SHIPPED],
  [OrderStatus.SHIPPED]: [OrderStatus.DELIVERED],
}

const VALID_PAYMENT_TRANSITIONS: Record<string, string[]> = {
  [PaymentStatus.PENDING]: [PaymentStatus.PAID, PaymentStatus.FAILED],
  [PaymentStatus.PAID]: [PaymentStatus.REFUNDED],
}

const VALID_FULFILLMENT_TRANSITIONS: Record<string, string[]> = {
  [FulfillmentStatus.UNFULFILLED]: [FulfillmentStatus.PROCESSING],
  [FulfillmentStatus.PROCESSING]: [FulfillmentStatus.SHIPPED],
  [FulfillmentStatus.SHIPPED]: [FulfillmentStatus.DELIVERED, FulfillmentStatus.RETURNED],
}

export async function updateOrderStatusAction(orderId: string, status: string, notes?: string) {
  const { user } = await requireAdmin()

  const parsed = updateOrderStatusSchema.safeParse({ orderId, status, notes })
  if (!parsed.success) return { success: false, error: parsed.error.errors[0].message }

  try {
    const client = await createClient() as any

    // 1. Validate transition
    const { data: currentOrder } = await client
      .from('orders')
      .select('order_status')
      .eq('id', orderId)
      .single()

    if (!currentOrder) return { success: false, error: 'Order not found' }

    const currentStatus = currentOrder.order_status
    const allowed = VALID_ORDER_TRANSITIONS[currentStatus]
    if (!allowed || !allowed.includes(status)) {
      return { success: false, error: `Invalid transition from ${currentStatus} to ${status}` }
    }

    // 2. Call atomic RPC
    const { data, error: rpcError } = await client.rpc('update_order_status_v2', {
      p_order_id: orderId,
      p_field: 'order_status',
      p_new_value: status,
      p_admin_id: user.id,
      p_notes: notes
    })

    if (rpcError) throw rpcError
    if (!(data as any).success) return { success: false, error: (data as any).error }

    await logAdminAction({
      adminId: user.id,
      action: 'order:status_update',
      entityType: 'order',
      entityId: orderId,
      changes: { order_status: { old: currentStatus, new: status } },
    })

    revalidatePath(`/admin/orders/${orderId}`)
    revalidatePath('/admin/orders')

    return { success: true }
  } catch (err: any) {
    logger.error('Failed to update order status', { orderId, status, error: err.message })
    return { success: false, error: err.message }
  }
}

export async function updatePaymentStatusAction(orderId: string, status: string, notes?: string) {
  const { user } = await requireAdmin()

  const parsed = updatePaymentStatusSchema.safeParse({ orderId, status, notes })
  if (!parsed.success) return { success: false, error: parsed.error.errors[0].message }

  try {
    const client = await createClient() as any

    const { data: currentOrder } = await client
      .from('orders')
      .select('payment_status')
      .eq('id', orderId)
      .single()

    if (!currentOrder) return { success: false, error: 'Order not found' }

    const currentStatus = currentOrder.payment_status
    const allowed = VALID_PAYMENT_TRANSITIONS[currentStatus]
    if (!allowed || !allowed.includes(status)) {
      return { success: false, error: `Invalid transition from ${currentStatus} to ${status}` }
    }

    const { data, error: rpcError } = await client.rpc('update_order_status_v2', {
      p_order_id: orderId,
      p_field: 'payment_status',
      p_new_value: status,
      p_admin_id: user.id,
      p_notes: notes
    })

    if (rpcError) throw rpcError
    if (!(data as any).success) return { success: false, error: (data as any).error }

    await logAdminAction({
      adminId: user.id,
      action: 'order:payment_update',
      entityType: 'order',
      entityId: orderId,
      changes: { payment_status: { old: currentStatus, new: status } },
    })

    revalidatePath(`/admin/orders/${orderId}`)
    revalidatePath('/admin/orders')

    return { success: true }
  } catch (err: any) {
    logger.error('Failed to update payment status', { orderId, status, error: err.message })
    return { success: false, error: err.message }
  }
}

export async function updateFulfillmentStatusAction(orderId: string, status: string, trackingNumber?: string, notes?: string) {
  const { user } = await requireAdmin()

  const parsed = updateFulfillmentStatusSchema.safeParse({ orderId, status, trackingNumber, notes })
  if (!parsed.success) return { success: false, error: parsed.error.errors[0].message }

  try {
    const client = await createClient() as any

    const { data: currentOrder } = await client
      .from('orders')
      .select('fulfillment_status')
      .eq('id', orderId)
      .single()

    if (!currentOrder) return { success: false, error: 'Order not found' }

    const currentStatus = currentOrder.fulfillment_status
    const allowed = VALID_FULFILLMENT_TRANSITIONS[currentStatus]
    if (!allowed || !allowed.includes(status)) {
      return { success: false, error: `Invalid transition from ${currentStatus} to ${status}` }
    }

    const { data, error: rpcError } = await client.rpc('update_order_status_v2', {
      p_order_id: orderId,
      p_field: 'fulfillment_status',
      p_new_value: status,
      p_admin_id: user.id,
      p_notes: notes,
      p_tracking_number: trackingNumber
    })

    if (rpcError) throw rpcError
    if (!(data as any).success) return { success: false, error: (data as any).error }

    await logAdminAction({
      adminId: user.id,
      action: 'order:fulfillment_update',
      entityType: 'order',
      entityId: orderId,
      changes: { fulfillment_status: { old: currentStatus, new: status } },
    })

    revalidatePath(`/admin/orders/${orderId}`)
    revalidatePath('/admin/orders')

    return { success: true }
  } catch (err: any) {
    logger.error('Failed to update fulfillment status', { orderId, status, error: err.message })
    return { success: false, error: err.message }
  }
}
