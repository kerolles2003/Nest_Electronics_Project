import { createClient } from '@/lib/supabase'

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
 * Lightweight audit logger for admin actions.
 * Writes to `admin_audit_logs` table.
 * Never throws — failures are logged to console only.
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
    // Audit logging must never break the main operation
    console.error('[AUDIT_LOG_FAIL]', { action, entityType, entityId, error: e })
  }
}
