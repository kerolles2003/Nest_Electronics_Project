'use server'

import { createClient } from '@/lib/supabase'
import { requireAdmin } from '@/lib/services'
import { logAdminAction } from '@/lib/audit/log-action'
import { logger } from '@/lib/logger'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

const adjustStockSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().refine((v) => v !== 0, 'Quantity must be non-zero'),
  reason: z.string().min(3, 'Reason must be at least 3 characters'),
})

export async function adjustStockAction(formData: FormData) {
  const { user } = await requireAdmin()
  const supabase = await createClient()

  const raw = {
    productId: formData.get('productId') as string,
    quantity: parseInt(formData.get('quantity') as string, 10),
    reason: (formData.get('reason') as string)?.trim() || '',
  }

  const parsed = adjustStockSchema.safeParse(raw)
  if (!parsed.success) {
    const messages = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')
    return { success: false, error: messages }
  }

  try {
    const { data, error: rpcError } = await supabase.rpc('adjust_stock_v2', {
      p_product_id: parsed.data.productId,
      p_quantity: parsed.data.quantity,
      p_reason: parsed.data.reason,
      p_admin_id: user.id,
      p_reference_type: 'manual',
    } as any)

    if (rpcError) {
      logger.error('adjust_stock_v2 RPC failed', rpcError)
      return { success: false, error: rpcError.message }
    }

    const result = data as any
    if (!result.success) {
      return { success: false, error: result.error }
    }

    await logAdminAction({
      adminId: user.id,
      action: 'product:stock_adjust',
      entityType: 'product',
      entityId: parsed.data.productId,
      changes: { delta: parsed.data.quantity, reason: parsed.data.reason },
    })

    logger.info(`Stock adjusted: product=${parsed.data.productId} delta=${parsed.data.quantity} by=${user.id}`)

    revalidatePath('/admin/inventory')
    revalidatePath('/admin/products')
    revalidatePath(`/admin/products/${parsed.data.productId}`)

    return { success: true, newStock: result.newStock }
  } catch (e) {
    logger.error('adjustStockAction failed', e)
    return { success: false, error: 'Internal server error' }
  }
}

export async function getInventoryTransactionsAction(productId: string, page: number, limit: number) {
  /* CRITICAL: This action was missing auth validation. */
  await requireAdmin()

  const supabase = await createClient()
  const offset = (page - 1) * limit

  try {
    const { data, count, error } = await supabase
      .from('inventory_transactions')
      .select('*, profiles(full_name, avatar_url)', { count: 'exact' })
      .eq('product_id', productId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1) as any

    if (error) {
      return { success: false, error: error.message }
    }

    return {
      success: true,
      data: data ?? [],
      total: count ?? 0,
      page,
      limit,
      totalPages: Math.ceil((count ?? 0) / limit),
    }
  } catch (e) {
    logger.error('getInventoryTransactionsAction failed', e)
    return { success: false, error: 'Internal server error' }
  }
}
