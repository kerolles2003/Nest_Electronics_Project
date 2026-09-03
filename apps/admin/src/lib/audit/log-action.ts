import { createClient } from '@/lib/supabase'
import { logger } from '@/lib/logger'

export interface AuditLogEntry {
  adminId: string
  action: string
  entityType: string
  entityId: string
  changes?: unknown | null
  ipAddress?: string | null
  userAgent?: string | null
}

/**
 * A Supabase UUID. `profiles.id` is one, and `admin_audit_logs.admin_id` has a
 * foreign key to it.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Said once per process, not once per action. A repeated warning is noise. */
let brokenTrailReported = false

/**
 * Audit logging for the admin's remaining SUPABASE screens.
 *
 * ## This trail is broken as of Phase 6, and it says so
 *
 * `admin_audit_logs.admin_id` carries a foreign key to `profiles.id` — Supabase
 * auth users. Phase 6 moved admin identity to the NestJS API, so the actor id
 * this now receives is a 24-character Mongo ObjectId, which that column cannot
 * hold and that constraint would reject.
 *
 * The previous version would have swallowed it. It wrapped the insert in a
 * `try/catch` that logged to `console.error` and continued, on the entirely
 * correct principle that audit logging must never break the operation it is
 * recording — which meant the trail would have gone silently empty on the day
 * the identity changed, and nobody would have found out until they needed it.
 *
 * So the insert is not attempted with an id the column cannot accept. It is
 * refused up front and reported ONCE per process, at warn level, naming the
 * reason. A broken audit trail that announces itself is recoverable; one that
 * returns success is not.
 *
 * ## What is NOT lost
 *
 * Order lifecycle actions — confirm, ship, deliver, delivery-failed, retry,
 * return — do not come through here at all any more and are not affected. The
 * API records the acting operator itself, from the TOKEN, inside the same
 * atomic write as the status change, and it is readable on
 * `GET /admin/orders/{id}` as `statusHistory[].actor`. That is the money path,
 * and it is the one path whose attribution is now stronger than it was.
 *
 * What this covers is products, categories, brands, coupons, inventory and
 * reviews — the screens still on Supabase. Their audit trail is part of Phase 7
 * along with the screens themselves; `AUDIT-MODEL.md` is where the replacement
 * belongs, and it should be written against the API rather than repaired here.
 */
export async function logAdminAction({
  adminId,
  action,
  entityType,
  entityId,
  changes = null,
  ipAddress = null,
  userAgent = null,
}: AuditLogEntry) {
  if (!UUID.test(adminId)) {
    if (!brokenTrailReported) {
      brokenTrailReported = true
      logger.warn(
        'admin_audit_logs is NOT being written: the acting admin is now an API account ' +
          '(Mongo ObjectId) and admin_audit_logs.admin_id has a foreign key to Supabase ' +
          'profiles.id. Every write would violate it. Order lifecycle actions are unaffected — ' +
          'the API records their actor on the order itself. Replacing this trail is Phase 7.',
        { action, entityType },
      )
    }

    return
  }

  const supabase = await createClient()

  try {
    await (supabase as any).from('admin_audit_logs').insert({
      admin_id: adminId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      changes,
      ip_address: ipAddress,
      user_agent: userAgent,
      created_at: new Date().toISOString(),
    })
  } catch (e) {
    // Audit logging must never break the main operation.
    logger.error('[AUDIT_LOG_FAIL]', { action, entityType, entityId, error: e })
  }
}
