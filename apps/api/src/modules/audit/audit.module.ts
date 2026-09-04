import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditReaderService } from './application/audit-reader.service';
import { AuditService } from './application/audit.service';
import { AdminAuditController } from './presentation/admin-audit.controller';
import { AuditLog, AuditLogSchema } from './infrastructure/schemas/audit-log.schema';

/**
 * The security audit trail.
 *
 * Authority: docs/architecture/AUDIT-MODEL.md.
 *
 * Exports `AuditService` — the WRITER — and nothing else. There is deliberately
 * no repository export, no update path and no delete path: §5 rule 4 makes
 * `auditLogs` append-only, and the TTL is the only thing that removes a record.
 * A module that exported a way to modify the trail would make the trail an
 * opinion.
 *
 * ## The controller that "did not exist yet" now does
 *
 * This module carried that note for several phases, with the reason: *writing
 * it correctly is the part that had to exist first, because every
 * administrative action taken before the mechanism exists is unrecoverable.*
 * Writing has worked for several phases; what was missing was any way to read
 * it, and AUDIT-MODEL.md §8 specifies the route.
 *
 * `AuditReaderService` is a provider and is NOT exported. The writer goes to
 * every module that audits; the reader goes only to this module's own
 * controller. So nothing that writes the trail can list it, and nothing
 * anywhere can change it.
 */
@Module({
  imports: [MongooseModule.forFeature([{ name: AuditLog.name, schema: AuditLogSchema }])],
  controllers: [AdminAuditController],
  providers: [AuditService, AuditReaderService],
  exports: [AuditService],
})
export class AuditModule {}
