'use server'

import { createClient } from '@/lib/supabase'
import { requireAdminActor } from '@/lib/api/identity'
import { logAdminAction } from '@/lib/audit/log-action'
import { logger } from '@/lib/logger'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

const couponSchema = z.object({
  code: z.string().min(1, 'Code is required').max(50),
  type: z.enum(['percentage', 'fixed']),
  value: z.number().min(0),
  min_order: z.number().min(0).nullable().optional(),
  max_discount: z.number().min(0).nullable().optional(),
  usage_limit: z.number().int().min(0).nullable().optional(),
  starts_at: z.string().nullable().optional(),
  expires_at: z.string().nullable().optional(),
  is_active: z.boolean().default(true),
})

export async function createCouponAction(formData: FormData) {
  const admin = await requireAdminActor()
  const supabase = await createClient()

  const raw = {
    code: (formData.get('code') as string)?.trim().toUpperCase(),
    type: formData.get('type') as string,
    value: parseFloat(formData.get('value') as string) || 0,
    min_order: formData.get('min_order') ? parseFloat(formData.get('min_order') as string) : null,
    max_discount: formData.get('max_discount') ? parseFloat(formData.get('max_discount') as string) : null,
    usage_limit: formData.get('usage_limit') ? parseInt(formData.get('usage_limit') as string, 10) : null,
    starts_at: (formData.get('starts_at') as string) || null,
    expires_at: (formData.get('expires_at') as string) || null,
    is_active: formData.get('is_active') === 'true',
  }

  const parsed = couponSchema.safeParse(raw)
  if (!parsed.success) {
    const messages = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')
    return { success: false, error: messages }
  }

  try {
    const { data, error } = await (supabase as any)
      .from('coupons')
      .insert({ ...parsed.data, used_count: 0 })
      .select('id')
      .single()

    if (error || !data) {
      return { success: false, error: error?.message ?? 'Failed to create coupon' }
    }

    await logAdminAction({
      adminId: admin.id,
      action: 'coupon:create',
      entityType: 'coupon',
      entityId: data.id,
      changes: parsed.data,
    })

    revalidatePath('/admin/coupons')
    logger.info(`Coupon created: id=${data.id} code=${parsed.data.code} by=${admin.id}`)
    return { success: true, couponId: data.id }
  } catch (e) {
    logger.error('createCouponAction failed', e)
    return { success: false, error: 'Internal server error' }
  }
}

export async function updateCouponAction(formData: FormData) {
  const admin = await requireAdminActor()
  const supabase = await createClient()

  const id = formData.get('id') as string
  if (!id) return { success: false, error: 'Coupon ID is required' }

  const raw = {
    code: (formData.get('code') as string)?.trim().toUpperCase(),
    type: formData.get('type') as string,
    value: parseFloat(formData.get('value') as string) || 0,
    min_order: formData.get('min_order') ? parseFloat(formData.get('min_order') as string) : null,
    max_discount: formData.get('max_discount') ? parseFloat(formData.get('max_discount') as string) : null,
    usage_limit: formData.get('usage_limit') ? parseInt(formData.get('usage_limit') as string, 10) : null,
    starts_at: (formData.get('starts_at') as string) || null,
    expires_at: (formData.get('expires_at') as string) || null,
    is_active: formData.get('is_active') === 'true',
  }

  const parsed = couponSchema.safeParse(raw)
  if (!parsed.success) {
    const messages = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')
    return { success: false, error: messages }
  }

  try {
    const { error } = await (supabase as any)
      .from('coupons')
      .update(parsed.data)
      .eq('id', id)

    if (error) {
      return { success: false, error: error.message }
    }

    await logAdminAction({
      adminId: admin.id,
      action: 'coupon:update',
      entityType: 'coupon',
      entityId: id,
      changes: parsed.data,
    })

    revalidatePath('/admin/coupons')
    logger.info(`Coupon updated: id=${id} by=${admin.id}`)
    return { success: true }
  } catch (e) {
    logger.error('updateCouponAction failed', e)
    return { success: false, error: 'Internal server error' }
  }
}

export async function toggleCouponActiveAction(id: string, isActive: boolean) {
  const admin = await requireAdminActor()
  const supabase = await createClient()

  try {
    const { error } = await (supabase as any)
      .from('coupons')
      .update({ is_active: isActive })
      .eq('id', id)

    if (error) {
      return { success: false, error: error.message }
    }

    await logAdminAction({
      adminId: admin.id,
      action: isActive ? 'coupon:activate' : 'coupon:deactivate',
      entityType: 'coupon',
      entityId: id,
    })

    revalidatePath('/admin/coupons')
    logger.info(`Coupon ${isActive ? 'activated' : 'deactivated'}: id=${id} by=${admin.id}`)
    return { success: true }
  } catch (e) {
    logger.error('toggleCouponActiveAction failed', e)
    return { success: false, error: 'Internal server error' }
  }
}

export async function deleteCouponAction(id: string) {
  const admin = await requireAdminActor()
  const supabase = await createClient()

  try {
    const { error } = await (supabase as any)
      .from('coupons')
      .delete()
      .eq('id', id)

    if (error) {
      return { success: false, error: error.message }
    }

    await logAdminAction({
      adminId: admin.id,
      action: 'coupon:delete',
      entityType: 'coupon',
      entityId: id,
    })

    revalidatePath('/admin/coupons')
    logger.info(`Coupon deleted: id=${id} by=${admin.id}`)
    return { success: true }
  } catch (e) {
    logger.error('deleteCouponAction failed', e)
    return { success: false, error: 'Internal server error' }
  }
}
