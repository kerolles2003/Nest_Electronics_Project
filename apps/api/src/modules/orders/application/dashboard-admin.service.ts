import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { MoneyDto } from '../../../common/dto/money.dto';
import { DEFAULT_LOCALE, type Locale, resolveText } from '../../../common/localization/locale';
import { Product } from '../../catalog/infrastructure/schemas/product.schema';
import { Role, User } from '../../users/infrastructure/schemas/user.schema';
import {
  DEFAULT_DASHBOARD_WINDOW,
  dashboardWindowMatch,
  resolveDashboardWindow,
  type DashboardWindowKey,
} from '../domain/dashboard-window';
import { ORDER_STATUSES, OrderStatus, PaymentStatus } from '../domain/order-status';
import { PIPELINE_STATUSES, revenueMatch } from '../domain/revenue';
import { Order } from '../infrastructure/schemas/order.schema';
import {
  AdminDashboardStatsDto,
  DashboardCustomersDto,
  DashboardLowStockItemDto,
  DashboardOrdersDto,
  DashboardProductsDto,
  DashboardRevenueDto,
  DashboardWindowDto,
} from '../presentation/dto/admin-dashboard-stats.dto';

interface OrderFacetResult {
  readonly delivered: Array<{ readonly amount: number; readonly count: number }>;
  readonly pipeline: Array<{ readonly amount: number; readonly count: number }>;
  readonly byStatus: Array<{ readonly _id: OrderStatus; readonly count: number }>;
  readonly customersWithOrders: Array<{ readonly count: number }>;
}

interface LowStockProductDoc {
  readonly _id: Types.ObjectId;
  readonly name: { readonly en: string; readonly ar?: string | null };
  readonly slug: string;
  readonly sku: string;
  readonly stock: {
    readonly onHand: number;
    readonly lowStockThreshold: number;
  };
}

/**
 * Aggregated metrics for the administrative dashboard.
 *
 * Authority: docs/architecture/ORDER-LIFECYCLE.md §"Payment status",
 *            ADR-ORDER-002, and `orders/domain/revenue.ts`.
 *
 * ## Revenue is counted at DELIVERY, not placement
 * Under Cash on Delivery, delivery IS the payment event (`payment.status = PAID`).
 * Placing an order does not mean cash was collected; counting revenue at placement
 * is counting money nobody has.
 *
 * Orders in transit or awaiting confirmation are tracked BESIDE revenue as `pipeline`,
 * allowing operators to see cash collected vs. cash in courier pipeline.
 *
 * ## Every order figure is bounded by a trailing window, 30 days by default
 *
 * See `orders/domain/dashboard-window.ts` for the argument. In short: it is the
 * better answer to the question an operator actually has, and it is what keeps
 * this endpoint from reading the whole `orders` collection on every load —
 * there is no `status` index for the facet to seek on, by deliberate design, so
 * an unbounded facet is a collection scan.
 *
 * The window bounds the ORDERS aggregation and nothing else. Product and
 * customer totals are statements about the world right now — "how many active
 * products are there" does not have a trailing-30-day version — and the one
 * customer figure that IS time-bounded, `newThisWeek`, carries its own period
 * in its name.
 *
 * `customers.withOrdersCount` moves with the window, and that is intended: over
 * 30 days it answers "how many customers ordered recently", which is a better
 * question than "how many have ever ordered". The DTO says so, and the console
 * prints the window beside it.
 */
@Injectable()
export class DashboardAdminService {
  constructor(
    @InjectModel(Order.name) private readonly orders: Model<Order>,
    @InjectModel(Product.name) private readonly products: Model<Product>,
    @InjectModel(User.name) private readonly users: Model<User>,
  ) {}

  async getStats(
    locale: Locale = DEFAULT_LOCALE,
    windowKey: DashboardWindowKey = DEFAULT_DASHBOARD_WINDOW,
  ): Promise<AdminDashboardStatsDto> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const window = resolveDashboardWindow(windowKey);
    const windowMatch = dashboardWindowMatch(window);

    const [orderAggregation, productCounts, lowStockDocs, customerCounts] =
      await Promise.all([
        this.orders
          .aggregate<OrderFacetResult>([
            /*
             * ONE match, at the head, so all four branches share one index seek
             * on `order_admin_queue` ({placedAt: -1, _id: -1}) instead of four
             * scans of the collection. Empty for all-time, which the planner
             * drops.
             */
            { $match: windowMatch },
            {
              $facet: {
                delivered: [
                  { $match: revenueMatch() },
                  {
                    $group: {
                      _id: null,
                      amount: { $sum: '$pricing.grandTotal' },
                      count: { $sum: 1 },
                    },
                  },
                ],
                pipeline: [
                  {
                    $match: {
                      'payment.status': PaymentStatus.PENDING,
                      status: { $in: PIPELINE_STATUSES },
                    },
                  },
                  {
                    $group: {
                      _id: null,
                      amount: { $sum: '$pricing.grandTotal' },
                      count: { $sum: 1 },
                    },
                  },
                ],
                byStatus: [
                  {
                    $group: {
                      _id: '$status',
                      count: { $sum: 1 },
                    },
                  },
                ],
                customersWithOrders: [
                  { $match: { userId: { $ne: null } } },
                  { $group: { _id: '$userId' } },
                  { $count: 'count' },
                ],
              },
            },
          ])
          .exec(),
        Promise.all([
          this.products.countDocuments({ isActive: true, deletedAt: null }).exec(),
          this.products
            .countDocuments({
              isActive: true,
              deletedAt: null,
              $expr: { $lte: ['$stock.onHand', '$stock.lowStockThreshold'] },
            })
            .exec(),
          this.products
            .countDocuments({
              isActive: true,
              deletedAt: null,
              'stock.onHand': 0,
            })
            .exec(),
        ]),
        this.products
          .find({
            isActive: true,
            deletedAt: null,
            $expr: { $lte: ['$stock.onHand', '$stock.lowStockThreshold'] },
          })
          .select({ _id: 1, name: 1, slug: 1, sku: 1, stock: 1 })
          .sort({ 'stock.onHand': 1, _id: 1 })
          .limit(8)
          .lean<LowStockProductDoc[]>()
          .exec(),
        Promise.all([
          this.users.countDocuments({ role: Role.CUSTOMER, deletedAt: null }).exec(),
          this.users
            .countDocuments({
              role: Role.CUSTOMER,
              deletedAt: null,
              createdAt: { $gte: sevenDaysAgo },
            })
            .exec(),
        ]),
      ]);

    const facet = orderAggregation[0] ?? {
      delivered: [],
      pipeline: [],
      byStatus: [],
      customersWithOrders: [],
    };

    // 1. Revenue
    const deliveredRow = facet.delivered[0];
    const deliveredAmount = deliveredRow?.amount ?? 0;
    const deliveredCount = deliveredRow?.count ?? 0;

    const pipelineRow = facet.pipeline[0];
    const pipelineAmount = pipelineRow?.amount ?? 0;
    const pipelineCount = pipelineRow?.count ?? 0;

    const revenue: DashboardRevenueDto = {
      delivered: MoneyDto.of(deliveredAmount),
      deliveredCount,
      pipeline: MoneyDto.of(pipelineAmount),
      pipelineCount,
    };

    // 2. Orders
    const observedCounts = new Map(facet.byStatus.map((row) => [row._id, row.count]));
    const byStatus = ORDER_STATUSES.map((status) => ({
      status,
      count: observedCounts.get(status) ?? 0,
    }));
    let totalOrders = 0;
    for (const entry of byStatus) totalOrders += entry.count;

    const orders: DashboardOrdersDto = {
      total: totalOrders,
      byStatus,
    };

    // 3. Products
    const [totalProducts, lowStockCount, outOfStockCount] = productCounts;
    const lowStock: DashboardLowStockItemDto[] = lowStockDocs.map((doc) => ({
      id: doc._id.toHexString(),
      name: resolveText(doc.name, locale),
      slug: doc.slug,
      sku: doc.sku,
      onHand: doc.stock.onHand,
      lowStockThreshold: doc.stock.lowStockThreshold,
    }));

    const products: DashboardProductsDto = {
      total: totalProducts,
      lowStockCount,
      outOfStockCount,
      lowStock,
    };

    // 4. Customers
    const [totalCustomers, newThisWeek] = customerCounts;
    const withOrdersCount = facet.customersWithOrders[0]?.count ?? 0;
    const customers: DashboardCustomersDto = {
      total: totalCustomers,
      newThisWeek,
      withOrdersCount,
    };

    // 5. The window itself, so the console's caption and the numbers under it
    //    come from the same place and cannot drift apart.
    const windowDto: DashboardWindowDto = {
      key: window.key,
      days: window.days,
      label: window.label,
      since: window.since === null ? null : window.since.toISOString(),
    };

    return {
      window: windowDto,
      revenue,
      orders,
      products,
      customers,
    };
  }
}
