import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditService } from './application/audit.service';
import { AuditLog, AuditLogSchema } from './infrastructure/schemas/audit-log.schema';

/**
 * The security audit trail.
 *
 * Authority: docs/architecture/AUDIT-MODEL.md.
 *
 * Exports `AuditService` and nothing else. There is deliberately no repository
 * export, no update path and no delete path: §5 rule 4 makes `auditLogs`
 * append-only, and the TTL is the only thing that removes a record. A module
 * that exported a way to modify the trail would make the trail an opinion.
 *
 * There is also no controller yet. Reading the log is an admin screen and
 * belongs with the rest of the admin surface; writing it correctly is the part
 * that had to exist first, because every administrative action taken before the
 * mechanism exists is unrecoverable.
 */
@Module({
  imports: [MongooseModule.forFeature([{ name: AuditLog.name, schema: AuditLogSchema }])],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
