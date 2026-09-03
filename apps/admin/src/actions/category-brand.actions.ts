'use server'

import { createClient } from '@/lib/supabase'
import { requireAdmin } from '@/lib/services'
import { logAdminAction } from '@/lib/audit/log-action'
import { logger } from '@/lib/logger'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

/* ------------------------------------------------------------------ */
/*  Zod Schemas                                                         */
/* ------------------------------------------------------------------ */

const categorySchema = z.object({
  name_en: z.string().min(1, 'Name is required').max(255),
  name_ar: z.string().max(255).nullable().optional(),
  slug: z.string().regex(/^[a-z0-9-]+$/, 'Slug must be lowercase letters, numbers, and hyphens only').max(200),
  parent_id: z.string().uuid().nullable().optional(),
  sort_order: z.number().int().min(0).default(0),
  image_url: z.string().url().nullable().optional(),
  is_active: z.boolean().default(true),
})

const brandSchema = z.object({
  name_en: z.string().min(1, 'Name is required').max(255),
  name_ar: z.string().max(255).nullable().optional(),
  slug: z.string().regex(/^[a-z0-9-]+$/, 'Slug must be lowercase letters, numbers, and hyphens only').max(200),
  logo_url: z.string().url().nullable().optional(),
  is_active: z.boolean().default(true),
})

/* ------------------------------------------------------------------ */
/*  Category Actions                                                    */
/* ------------------------------------------------------------------ */

export async function createCategoryAction(formData: FormData) {
  const admin = await requireAdmin()
  const supabase = await createClient()

  const raw = {
    name_en: formData.get('name_en') as string,
    name_ar: (formData.get('name_ar') as string) || null,
    slug: formData.get('slug') as string,
    parent_id: (formData.get('parent_id') as string) || null,
    sort_order: parseInt(formData.get('sort_order') as string, 10) || 0,
    image_url: (formData.get('image_url') as string) || null,
    is_active: formData.get('is_active') === 'true',
  }

  const parsed = categorySchema.safeParse(raw)
  if (!parsed.success) {
    const messages = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')
    return { success: false, error: messages }
  }

  try {
    const { data, error } = await (supabase as any)
      .from('categories')
      .insert(parsed.data)
      .select('id')
      .single()

    if (error || !data) {
      return { success: false, error: error?.message ?? 'Failed to create category' }
    }

    await logAdminAction({
      adminId: admin.id,
      action: 'category:create',
      entityType: 'category',
      entityId: data.id,
      changes: parsed.data,
    })

    revalidatePath('/admin/categories')
    logger.info(`Category created: id=${data.id} name=${parsed.data.name_en} by=${admin.id}`)
    return { success: true, categoryId: data.id }
  } catch (e) {
    logger.error('createCategoryAction failed', e)
    return { success: false, error: 'Internal server error' }
  }
}

export async function updateCategoryAction(formData: FormData) {
  const admin = await requireAdmin()
  const supabase = await createClient()

  const id = formData.get('id') as string
  if (!id) return { success: false, error: 'Category ID is required' }

  const raw = {
    name_en: formData.get('name_en') as string,
    name_ar: (formData.get('name_ar') as string) || null,
    slug: formData.get('slug') as string,
    parent_id: (formData.get('parent_id') as string) || null,
    sort_order: parseInt(formData.get('sort_order') as string, 10) || 0,
    is_active: formData.get('is_active') === 'true',
    image_url: (formData.get('image_url') as string) || null,
  }

  const parsed = categorySchema.safeParse(raw)
  if (!parsed.success) {
    const messages = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')
    return { success: false, error: messages }
  }

  try {
    const { error } = await (supabase as any)
      .from('categories')
      .update({
        ...parsed.data,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)

    if (error) {
      return { success: false, error: error.message }
    }

    await logAdminAction({
      adminId: admin.id,
      action: 'category:update',
      entityType: 'category',
      entityId: id,
      changes: parsed.data,
    })

    revalidatePath('/admin/categories')
    logger.info(`Category updated: id=${id} name=${parsed.data.name_en} by=${admin.id}`)
    return { success: true }
  } catch (e) {
    logger.error('updateCategoryAction failed', e)
    return { success: false, error: 'Internal server error' }
  }
}

export async function softDeleteCategoryAction(id: string) {
  const admin = await requireAdmin()
  const supabase = await createClient()

  try {
    const { error } = await (supabase as any)
      .from('categories')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)

    if (error) {
      return { success: false, error: error.message }
    }

    await logAdminAction({
      adminId: admin.id,
      action: 'category:delete',
      entityType: 'category',
      entityId: id,
    })

    revalidatePath('/admin/categories')
    logger.info(`Category soft-deleted: id=${id} by=${admin.id}`)
    return { success: true }
  } catch (e) {
    logger.error('softDeleteCategoryAction failed', e)
    return { success: false, error: 'Internal server error' }
  }
}

/* ------------------------------------------------------------------ */
/*  Brand Actions                                                       */
/* ------------------------------------------------------------------ */

export async function createBrandAction(formData: FormData) {
  const admin = await requireAdmin()
  const supabase = await createClient()

  const raw = {
    name_en: formData.get('name_en') as string,
    name_ar: (formData.get('name_ar') as string) || null,
    slug: formData.get('slug') as string,
    logo_url: (formData.get('logo_url') as string) || null,
    is_active: formData.get('is_active') === 'true',
  }

  const parsed = brandSchema.safeParse(raw)
  if (!parsed.success) {
    const messages = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')
    return { success: false, error: messages }
  }

  try {
    const { data, error } = await (supabase as any)
      .from('brands')
      .insert(parsed.data)
      .select('id')
      .single()

    if (error || !data) {
      return { success: false, error: error?.message ?? 'Failed to create brand' }
    }

    await logAdminAction({
      adminId: admin.id,
      action: 'brand:create',
      entityType: 'brand',
      entityId: data.id,
      changes: parsed.data,
    })

    revalidatePath('/admin/brands')
    logger.info(`Brand created: id=${data.id} name=${parsed.data.name_en} by=${admin.id}`)
    return { success: true, brandId: data.id }
  } catch (e) {
    logger.error('createBrandAction failed', e)
    return { success: false, error: 'Internal server error' }
  }
}

export async function updateBrandAction(formData: FormData) {
  const admin = await requireAdmin()
  const supabase = await createClient()

  const id = formData.get('id') as string
  if (!id) return { success: false, error: 'Brand ID is required' }

  const raw = {
    name_en: formData.get('name_en') as string,
    name_ar: (formData.get('name_ar') as string) || null,
    slug: formData.get('slug') as string,
    logo_url: (formData.get('logo_url') as string) || null,
    is_active: formData.get('is_active') === 'true',
  }

  const parsed = brandSchema.safeParse(raw)
  if (!parsed.success) {
    const messages = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')
    return { success: false, error: messages }
  }

  try {
    const { error } = await (supabase as any)
      .from('brands')
      .update({
        ...parsed.data,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)

    if (error) {
      return { success: false, error: error.message }
    }

    await logAdminAction({
      adminId: admin.id,
      action: 'brand:update',
      entityType: 'brand',
      entityId: id,
      changes: parsed.data,
    })

    revalidatePath('/admin/brands')
    logger.info(`Brand updated: id=${id} name=${parsed.data.name_en} by=${admin.id}`)
    return { success: true }
  } catch (e) {
    logger.error('updateBrandAction failed', e)
    return { success: false, error: 'Internal server error' }
  }
}

export async function softDeleteBrandAction(id: string) {
  const admin = await requireAdmin()
  const supabase = await createClient()

  try {
    const { error } = await (supabase as any)
      .from('brands')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)

    if (error) {
      return { success: false, error: error.message }
    }

    await logAdminAction({
      adminId: admin.id,
      action: 'brand:delete',
      entityType: 'brand',
      entityId: id,
    })

    revalidatePath('/admin/brands')
    logger.info(`Brand soft-deleted: id=${id} by=${admin.id}`)
    return { success: true }
  } catch (e) {
    logger.error('softDeleteBrandAction failed', e)
    return { success: false, error: 'Internal server error' }
  }
}
