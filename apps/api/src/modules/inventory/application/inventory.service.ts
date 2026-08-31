import { Injectable } from '@nestjs/common';
import type { ClientSession } from 'mongoose';
import { Types } from 'mongoose';
import { AppException } from '../../../common/errors/app.exception';
import type { Role } from '../../users/infrastructure/schemas/user.schema';
import { InventoryRepository } from '../infrastructure/repositories/inventory.repository';
import {
  InventoryEventType,
  InventoryReferenceType,
  type InventoryEvent,
} from '../infrastructure/schemas/inventory-event.schema';

/** One product leaving stock because it was sold. */
export interface SaleLine {
  readonly productId: Types.ObjectId;
  /** Snapshot, so the ledger entry reads standalone after a rename. */
  readonly sku: string;
  readonly quantity: number;
}

export interface SaleActor {
  readonly id: Types.ObjectId;
  readonly role: Role;
  readonly name: string;
}

export interface CommitSaleCommand {
  readonly lines: readonly SaleLine[];
  readonly orderId: Types.ObjectId;
  /** Human-readable provenance, e.g. `Order NE-20260830-0001`. */
  readonly reason: string;
  readonly actor: SaleActor;
}

/**
 * Returning goods to stock, because an order was cancelled or came back.
 *
 * `type` is a parameter rather than two near-identical methods: the mechanism
 * is byte-for-byte the same and only the ledger's event type differs, so
 * splitting it would duplicate the interesting part to vary the trivial one.
 * The union is narrowed to the two restoring types, so a caller cannot pass
 * `SALE` and write a positive entry under a negative event type.
 */
export interface RestoreStockCommand {
  readonly lines: readonly SaleLine[];
  readonly orderId: Types.ObjectId;
  readonly reason: string;
  readonly actor: SaleActor;
  readonly type: InventoryEventType.CANCELLATION | InventoryEventType.RETURN;
}

/**
 * What a restore actually did.
 *
 * `skipped` exists because a HARD-deleted product has no document to add stock
 * back to. It is reported rather than swallowed so the caller can see that the
 * ledger is deliberately short a line, and it is not an error: refusing the
 * whole cancellation would strand the customer's order in a state it could
 * never leave because somebody deleted a catalogue row.
 */
export interface RestoreOutcome {
  readonly restored: readonly CommittedLine[];
  readonly skipped: readonly Types.ObjectId[];
}

/** What the ledger recorded, returned so a caller can assert on it. */
export interface CommittedLine {
  readonly productId: Types.ObjectId;
  readonly quantity: number;
  readonly balanceBefore: number;
  readonly balanceAfter: number;
}

/**
 * The stock authority.
 *
 * Authority: docs/architecture/INVENTORY-MODEL.md.
 *
 * TWO operations, and they are inverses: `commitSale` takes stock out when an
 * order is placed, `restoreStock` puts it back when one is cancelled or
 * returned. Both write their ledger entries in the SAME transaction as the
 * stock movement, which is the whole design — legacy's ledger was written by a
 * different code path than the stock update, so the two could and did diverge.
 *
 * `RESTOCK`, `ADJUSTMENT`, `DAMAGE` and `OPENING_BALANCE` remain unimplemented:
 * each is an admin operation with its own authorization surface, and their
 * event types are already declared so adding them changes no contract.
 *
 * There is no reservation step. Under Cash on Delivery there is no payment gap
 * to hold stock across: the customer commits at checkout and cash is collected
 * at the door, so stock is committed at placement (§2).
 */
@Injectable()
export class InventoryService {
  constructor(private readonly inventory: InventoryRepository) {}

  /**
   * Decrements stock for every line and writes the matching ledger entries, all
   * inside the caller's transaction.
   *
   * ALL OR NOTHING. The first line that cannot be satisfied throws, which aborts
   * the caller's transaction and undoes every decrement already applied. There
   * is no compensating write and no partial order — the database does the
   * undoing.
   *
   * Never call this outside a transaction: the ledger write and the stock write
   * must land together, which is what makes `Σ quantityDelta == stock.onHand`
   * an invariant rather than an aspiration. Legacy had no trigger enforcing it
   * and its ledger was decorative.
   */
  async commitSale(command: CommitSaleCommand, session: ClientSession): Promise<CommittedLine[]> {
    const committed: CommittedLine[] = [];

    for (const line of command.lines) {
      const decrement = await this.inventory.decrementForSale(
        line.productId,
        line.quantity,
        session,
      );

      if (decrement === null) {
        // The write refused. Ask the database WHY rather than inferring it from
        // a value read before the update, which is the race this whole design
        // exists to close.
        const refusal = await this.inventory.diagnose(line.productId, session);

        throw refusal.reason === 'INSUFFICIENT'
          ? AppException.outOfStock(line.sku, refusal.available)
          : AppException.productUnavailable();
      }

      committed.push({
        productId: line.productId,
        quantity: line.quantity,
        balanceBefore: decrement.balanceBefore,
        balanceAfter: decrement.balanceAfter,
      });
    }

    await this.inventory.recordEvents(
      committed.map((entry, index) => ({
        productId: entry.productId,
        // Index-aligned: `committed` is built by iterating `command.lines` in
        // order and pushing exactly once per line, so positions correspond.
        sku: command.lines[index]?.sku ?? '',
        type: InventoryEventType.SALE,
        quantityDelta: -entry.quantity,
        balanceBefore: entry.balanceBefore,
        balanceAfter: entry.balanceAfter,
        reason: command.reason,
        reference: { type: InventoryReferenceType.ORDER, id: command.orderId },
        actor: { id: command.actor.id, role: command.actor.role, name: command.actor.name },
      })),
      session,
    );

    return committed;
  }

  /**
   * Puts stock back and writes the positive ledger entries. The exact inverse
   * of `commitSale`, inside the caller's transaction.
   *
   * Authority: INVENTORY-MODEL.md §5.2; ORDER-LIFECYCLE.md §11.
   *
   * ## Why this cannot restore twice
   *
   * Two independent guarantees, and the second one does not depend on any
   * application logic being correct:
   *
   *  1. The caller has already flipped the order's status with a guarded
   *     conditional update, so a second cancellation never reaches this method.
   *  2. `inventoryEvents` carries a UNIQUE index on
   *     `{reference.id, productId, type}`. If a second `CANCELLATION` for the
   *     same order and product were ever attempted, the ledger insert fails and
   *     the surrounding transaction rolls back the stock increment with it.
   *     Stock and its ledger move together or not at all — which is what makes
   *     "sum of quantityDelta equals stock.onHand" an invariant rather than an
   *     aspiration.
   *
   * Legacy restored nothing at all: `update_order_status_v2` touched no stock
   * table, so every cancelled order permanently destroyed its stock with no
   * record (F-HIGH-2).
   */
  async restoreStock(command: RestoreStockCommand, session: ClientSession): Promise<RestoreOutcome> {
    const restored: CommittedLine[] = [];
    const skipped: Types.ObjectId[] = [];
    const events: Partial<InventoryEvent>[] = [];

    for (const line of command.lines) {
      const increment = await this.inventory.incrementForRestore(
        line.productId,
        line.quantity,
        session,
      );

      if (increment === null) {
        // The product document is gone entirely. There is no balance to write a
        // self-verifying ledger entry against, so no entry is written — an
        // event claiming a balance we never observed would be worse than a gap.
        skipped.push(line.productId);
        continue;
      }

      restored.push({
        productId: line.productId,
        quantity: line.quantity,
        balanceBefore: increment.balanceBefore,
        balanceAfter: increment.balanceAfter,
      });

      events.push({
        productId: line.productId,
        sku: line.sku,
        type: command.type,
        // POSITIVE. The sign is what distinguishes this from the SALE entry
        // that took the same quantity out.
        quantityDelta: line.quantity,
        balanceBefore: increment.balanceBefore,
        balanceAfter: increment.balanceAfter,
        reason: command.reason,
        reference: { type: InventoryReferenceType.ORDER, id: command.orderId },
        actor: { id: command.actor.id, role: command.actor.role, name: command.actor.name },
      });
    }

    await this.inventory.recordEvents(events, session);

    return { restored, skipped };
  }
}
