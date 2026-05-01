'use server'

import { createClient } from '@/lib/supabase'
import { requireAdmin } from '@/lib/services'
import { logAdminAction } from '@/lib/audit/log-action'
import { logger } from '@/lib/logger'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

const reviewStatusSchema = z.object({
  reviewId: z.string().uuid(),
  status: z.enum(['pending', 'approved', 'rejected']),
})

export async function updateReviewStatusAction(formData: FormData) {
  const { user } = await requireAdmin()
  const supabase = await createClient()

  const raw = {
    reviewId: formData.get('reviewId') as string,
    status: formData.get('status') as string,
  }

  const parsed = reviewStatusSchema.safeParse(raw)
  if (!parsed.success) {
    const messages = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')
    return { success: false, error: messages }
  }

  try {
    const { error } = await (supabase as any)
      .from('reviews')
      .update({ moderation_status: parsed.data.status })
      .eq('id', parsed.data.reviewId)

    if (error) {
      return { success: false, error: error.message }
    }

    await logAdminAction({
      adminId: user.id,
      action: `review:${parsed.data.status}`,
      entityType: 'review',
      entityId: parsed.data.reviewId,
      changes: { moderation_status: parsed.data.status },
    })

    revalidatePath('/admin/reviews')
    logger.info(`Review ${parsed.data.status}: id=${parsed.data.reviewId} by=${user.id}`)
    return { success: true }
  } catch (e) {
    logger.error('updateReviewStatusAction failed', e)
    return { success: false, error: 'Internal server error' }
  }
}

export async function deleteReviewAction(reviewId: string) {
  const { user } = await requireAdmin()
  const supabase = await createClient()

  try {
    const { error } = await (supabase as any)
      .from('reviews')
      .delete()
      .eq('id', reviewId)

    if (error) {
      return { success: false, error: error.message }
    }

    await logAdminAction({
      adminId: user.id,
      action: 'review:delete',
      entityType: 'review',
      entityId: reviewId,
    })

    revalidatePath('/admin/reviews')
    logger.info(`Review deleted: id=${reviewId} by=${user.id}`)
    return { success: true }
  } catch (e) {
    logger.error('deleteReviewAction failed', e)
    return { success: false, error: 'Internal server error' }
  }
}
