import { ConflictException, Injectable, Logger } from '@nestjs/common';
import {
  ActorType,
  ConsignmentEventType,
  ConsignmentLeg,
  InventoryMode,
  LabellingSite,
  StockUnitStatus,
} from '@skydrop/db';
import { printableBarcode } from '../../../common/barcode/printable-barcode';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { ConsignmentEventService } from '../../consignment-core/services/consignment-event.service';
import { InventoryModeService } from '../../inventory-shared/inventory-mode.service';
import { ConsignmentService } from './consignment.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';

export interface LabelSheet {
  readonly consignmentNumber: string;
  readonly site: LabellingSite;
  readonly printedAt: Date;
  readonly labels: ReadonlyArray<{
    readonly serialBarcode: string;
    readonly skuCode: string;
    readonly productName: string;
    readonly variantLabel: string | null;
    readonly expiresAt: Date | null;
    /**
     * The serial as Code 128 module widths — null if it cannot be
     * encoded, in which case the client prints the string alone.
     *
     * Serials were a monospace string until 2026-09-04, which made
     * STRICT mode a typing exercise: a picker holding a carton had to
     * read ten characters off a label and key them in at every gate.
     */
    readonly barcodeWidths: readonly number[] | null;
  }>;
}

/**
 * The printable label sheet for a consignment's serialized units.
 *
 * R4 has generated serials at intake since it landed — `generateSerial()`
 * returns `SDU-XXXXXXXXXX` — and nothing ever rendered one. A strict SKU
 * therefore could not physically work: the units existed in the ledger
 * with no barcode on the carton for a picker to scan.
 *
 * This returns the DATA; the client renders and prints it. Deliberately
 * not a PDF from the server: a warehouse prints to a label printer whose
 * stock size, orientation and DPI are properties of the bench, not of us,
 * and a server-rendered sheet would need every one of those as a
 * parameter to be wrong in a different way each time.
 *
 * Printing STAMPS `labelsPrintedAt`, which locks the labelling station.
 * A consignment half-labelled in Dhaka and half in Bangalore cannot be
 * told apart without opening every carton.
 */
@Injectable()
export class ConsignmentLabelService {
  private readonly logger = new Logger(ConsignmentLabelService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly consignments: ConsignmentService,
    private readonly events: ConsignmentEventService,
    private readonly modes: InventoryModeService,
  ) {}

  /**
   * What is waiting to be labelled, without stamping anything. The panel
   * calls this to decide whether to offer the button at all.
   */
  async preview(consignmentId: string): Promise<{
    readonly site: LabellingSite;
    readonly locked: boolean;
    readonly strictUnits: number;
    readonly strictSkus: number;
  }> {
    const consignment = await this.consignments.requireById(consignmentId);
    const legIds = this.legIdsForSite(consignment);
    const variantIds = [
      ...new Set(
        consignment.receipts
          .flatMap((r) => (legIds.includes(r.id) ? r.lines : []))
          .map((l) => l.variantId),
      ),
    ];
    const modeByVariant = await this.modes.resolveForVariants(consignment.sellerId, variantIds);
    const strictVariants = variantIds.filter((v) => modeByVariant.get(v) === InventoryMode.STRICT);
    const strictUnits =
      strictVariants.length === 0
        ? 0
        : await this.prisma.client.stockUnit.count({
            where: {
              sellerId: consignment.sellerId,
              variantId: { in: strictVariants },
              status: StockUnitStatus.IN_STOCK,
              goodsReceiptLine: { receiptId: { in: legIds } },
            },
          });
    return {
      site: consignment.labellingSite,
      locked: consignment.labelsPrintedAt !== null,
      strictUnits,
      strictSkus: strictVariants.length,
    };
  }

  async print(staffId: string, consignmentId: string, ctx: ClientContext): Promise<LabelSheet> {
    const consignment = await this.consignments.requireById(consignmentId);
    if (consignment.labellingSite === LabellingSite.NONE) {
      throw new ConflictException({
        code: 'LABELLING_SITE_NOT_SET',
        message:
          `${consignment.consignmentNumber} has no labelling station. ` +
          'Choose Bangladesh or India first — labels are printed in one place, not both.',
      });
    }

    const legIds = this.legIdsForSite(consignment);
    if (legIds.length === 0) {
      throw new ConflictException({
        code: 'NOTHING_TO_LABEL',
        message:
          consignment.labellingSite === LabellingSite.BD
            ? `${consignment.consignmentNumber} has not been counted in Bangladesh yet`
            : `${consignment.consignmentNumber} has not arrived in India yet`,
      });
    }

    const units = await this.prisma.client.stockUnit.findMany({
      where: {
        sellerId: consignment.sellerId,
        status: StockUnitStatus.IN_STOCK,
        goodsReceiptLine: { receiptId: { in: legIds } },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        serialBarcode: true,
        batch: { select: { expiresAt: true } },
        variant: {
          select: {
            skuCode: true,
            variantLabel: true,
            product: { select: { name: true } },
          },
        },
      },
    });
    if (units.length === 0) {
      throw new ConflictException({
        code: 'NO_SERIALIZED_UNITS',
        message:
          `${consignment.consignmentNumber} has no serialized units to label. ` +
          'Only STRICT-mode SKUs are labelled; the rest are counted in aggregate.',
      });
    }

    const printedAt = new Date();
    await this.prisma.client.$transaction(async (tx) => {
      // Guarded so two operators pressing print at once do not both claim
      // the first print — the LOCK is what makes the one-station rule real,
      // so it must not be a read-then-write.
      await tx.consignment.updateMany({
        where: { id: consignmentId, labelsPrintedAt: null },
        data: { labelsPrintedAt: printedAt },
      });
      await this.events.append(
        {
          consignmentId,
          type: ConsignmentEventType.LABELS_PRINTED,
          description: `${units.length} label(s) printed in ${
            consignment.labellingSite === LabellingSite.BD ? 'Bangladesh' : 'India'
          }`,
          data: { site: consignment.labellingSite, count: units.length },
          actorType: ActorType.STAFF,
          actorId: staffId,
        },
        tx,
      );
      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: staffId,
          sellerId: consignment.sellerId,
          action: 'inventory.consignment.labels_printed',
          entityType: 'consignment',
          entityId: consignmentId,
          metadata: {
            consignmentNumber: consignment.consignmentNumber,
            site: consignment.labellingSite,
            count: units.length,
            ipAddress: ctx.ipAddress ?? null,
            userAgent: ctx.userAgent ?? null,
          },
        },
        tx,
      );
    });

    this.logger.log(
      { consignmentId, site: consignment.labellingSite, count: units.length },
      'Consignment labels printed',
    );
    return {
      consignmentNumber: consignment.consignmentNumber,
      site: consignment.labellingSite,
      printedAt,
      labels: units.map((u) => ({
        serialBarcode: u.serialBarcode,
        skuCode: u.variant.skuCode,
        productName: u.variant.product.name,
        variantLabel: u.variant.variantLabel,
        expiresAt: u.batch?.expiresAt ?? null,
        barcodeWidths: printableBarcode(u.serialBarcode).widths,
      })),
    };
  }

  /** Which legs' units the chosen station is responsible for. */
  private legIdsForSite(consignment: {
    labellingSite: LabellingSite;
    receipts: ReadonlyArray<{ id: string; leg: ConsignmentLeg | null; status: string }>;
  }): string[] {
    const wanted =
      consignment.labellingSite === LabellingSite.BD
        ? ConsignmentLeg.BD_INTAKE
        : ConsignmentLeg.IN_FINAL;
    return consignment.receipts
      .filter((r) => r.leg === wanted && r.status === 'COMPLETED')
      .map((r) => r.id);
  }
}
