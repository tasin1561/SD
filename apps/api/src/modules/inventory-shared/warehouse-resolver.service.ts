import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { WarehouseStatus } from '@skydrop/db';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/** system_settings key holding the BLR-01 (Phase 1A single-warehouse) uuid. */
const DEFAULT_WAREHOUSE_SETTING_KEY = 'ops.default_warehouse_id';
/** system_settings key holding the Bangladesh intake warehouse uuid. */
const BD_INTAKE_WAREHOUSE_SETTING_KEY = 'ops.bd_intake_warehouse_id';

export interface WarehouseRef {
  id: string;
  code: string;
  name: string;
  status: WarehouseStatus;
  /** Can customer orders ship FROM here? False for an intake-only site
   *  such as the Bangladesh warehouse. */
  fulfilsOrders: boolean;
}

/**
 * Resolves "which warehouse" for inventory operations.
 *
 * Locked decision #6: inventory services take a strict `warehouseId`;
 * only seller-facing controllers aggregate across warehouses. This service
 * is the one place where "no warehouse specified" becomes "the configured
 * default", and where a caller-supplied id is validated to exist.
 *
 * A mis-seeded / dangling `ops.default_warehouse_id` is an operational
 * misconfiguration, not a client error — it surfaces as 500 with a clear
 * code, never as a confusing 404 to a seller.
 */
@Injectable()
export class WarehouseResolverService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The configured default warehouse id, verified to point at a live
   * (non-soft-deleted) warehouse. Throws if unset or dangling.
   */
  async getDefaultWarehouseId(): Promise<string> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: DEFAULT_WAREHOUSE_SETTING_KEY },
      select: { valueString: true },
    });
    const id = row?.valueString?.trim();
    if (!id) {
      throw new InternalServerErrorException({
        code: 'DEFAULT_WAREHOUSE_NOT_CONFIGURED',
        message: `${DEFAULT_WAREHOUSE_SETTING_KEY} is not set`,
      });
    }
    const wh = await this.prisma.client.warehouse.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!wh) {
      throw new InternalServerErrorException({
        code: 'DEFAULT_WAREHOUSE_INVALID',
        message: `${DEFAULT_WAREHOUSE_SETTING_KEY} points to a missing or deleted warehouse`,
      });
    }
    return wh.id;
  }

  /**
   * Caller-supplied id wins (validated for existence); otherwise the
   * configured default. Use at the controller/service boundary to turn an
   * optional request param into the strict id the inner services require.
   */
  async resolveWarehouseId(explicitId?: string | null): Promise<string> {
    if (explicitId) {
      const wh = await this.requireWarehouse(explicitId);
      return wh.id;
    }
    return this.getDefaultWarehouseId();
  }

  /**
   * The Bangladesh intake warehouse, for a VIA_BD consignment.
   *
   * Refuses loudly when unset rather than falling back to the default:
   * the seller SAID Bangladesh, and quietly booking their consignment
   * against the Indian warehouse would tell them their stock had arrived
   * in a country it never reached.
   *
   * Also refuses a warehouse that fulfils orders. An intake site whose
   * stock is sellable defeats the point of the route — goods sitting in
   * Dhaka would be promised to customers in India.
   */
  async getBdIntakeWarehouseId(): Promise<string> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: BD_INTAKE_WAREHOUSE_SETTING_KEY },
      select: { valueString: true },
    });
    const id = row?.valueString?.trim();
    if (!id) {
      throw new ConflictException({
        code: 'BD_WAREHOUSE_NOT_CONFIGURED',
        message:
          'No Bangladesh intake warehouse is configured, so stock cannot be sent there yet. ' +
          `Create the warehouse (fulfils orders OFF) and set ${BD_INTAKE_WAREHOUSE_SETTING_KEY}, ` +
          'or ship this consignment straight to India.',
      });
    }
    const wh = await this.prisma.client.warehouse.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, code: true, fulfilsOrders: true },
    });
    if (!wh) {
      throw new InternalServerErrorException({
        code: 'BD_WAREHOUSE_INVALID',
        message: `${BD_INTAKE_WAREHOUSE_SETTING_KEY} points to a missing or deleted warehouse`,
      });
    }
    if (wh.fulfilsOrders) {
      throw new ConflictException({
        code: 'BD_WAREHOUSE_FULFILS_ORDERS',
        message:
          `${wh.code} is configured as the Bangladesh intake warehouse but still fulfils orders. ` +
          'Turn that off — otherwise stock waiting in Dhaka is offered to customers in India.',
      });
    }
    return wh.id;
  }

  /**
   * THE one reader of `warehouses.fulfils_orders`.
   *
   * Our Bangladesh warehouse takes stock in and never ships an order
   * out — the goods there are on their way to India and are not
   * sellable from Dhaka. Every surface that needs to know asks here and
   * does not test `countryCode` itself; five call sites each deciding
   * what "an Indian warehouse" means is exactly how they come to
   * disagree (the same argument that put bin tracking behind
   * BinPolicyService).
   *
   * Defaults TRUE on a missing row: a warehouse that cannot be read is
   * somebody else's error to raise, and answering "this building does
   * not fulfil orders" would quietly take a live site out of service.
   */
  async fulfilsOrders(id: string): Promise<boolean> {
    const wh = await this.prisma.client.warehouse.findFirst({
      where: { id, deletedAt: null },
      select: { fulfilsOrders: true },
    });
    return wh?.fulfilsOrders ?? true;
  }

  /** A non-soft-deleted warehouse, or 404. */
  async requireWarehouse(id: string): Promise<WarehouseRef> {
    const wh = await this.prisma.client.warehouse.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, code: true, name: true, status: true, fulfilsOrders: true },
    });
    if (!wh) {
      throw new NotFoundException({
        code: 'WAREHOUSE_NOT_FOUND',
        message: 'Warehouse not found',
      });
    }
    return wh;
  }
}
