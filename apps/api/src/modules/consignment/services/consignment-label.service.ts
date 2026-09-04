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
import { StockUnitService } from '../../inventory-shared/stock-unit.service';
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
    private readonly units: StockUnitService,
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

    // PRINT ONCE. A serial names one physical unit, so a second copy of
    // the sheet is 400 stickers that each duplicate a unit already
    // labelled — and two boxes claiming to be the same unit is not
    // something the ledger can even represent (`@@unique(sellerId,
    // serialBarcode)`), so one of them silently becomes a ghost.
    //
    // The guarded updateMany below already stopped the STAMP moving,
    // which is what locks the station (CNS-5) — but it never stopped
    // the sheet coming back, so reprinting was unlimited and only the
    // first one was ever recorded. A damaged label goes through
    // `reprintUnits`, which is per-unit and leaves a trail.
    if (consignment.labelsPrintedAt !== null) {
      throw new ConflictException({
        code: 'LABELS_ALREADY_PRINTED',
        message:
          `${consignment.consignmentNumber} was labelled on ` +
          `${consignment.labelsPrintedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC. ` +
          'Printing the sheet again would put a second sticker on every unit. For a label ' +
          'that was damaged or lost, reprint that unit on its own.',
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

  /**
   * Reprint the label for SPECIFIC units — the damaged or lost sticker.
   *
   * ── WHY PER UNIT, NEVER THE SHEET ────────────────────────────────────
   * The realistic failure is one label smudged in a carton, not four
   * hundred. Reprinting the sheet is exactly what puts a second sticker
   * on every unit, and the ledger cannot hold two units with one serial
   * (`@@unique(sellerId, serialBarcode)`), so the duplicate does not
   * announce itself — it surfaces later as a unit that was already
   * picked for a different parcel, at the bench, with a customer
   * waiting. Capping the count keeps the blast radius of the escape
   * hatch to what a person can actually be holding.
   *
   * The serial is REPRINTED AS-IS rather than reissued. A lost label is
   * a label that may yet turn up on the same box; minting a new serial
   * would make the original — still stuck to the unit — scan as
   * something that does not exist.
   *
   * Every reprint lands on the UNIT's own ledger (`LABEL_REPRINT`), not
   * only on the consignment, because the question worth asking later is
   * "has this serial been printed twice?" and that is a question about
   * the unit.
   */
  async reprintUnits(
    staffId: string,
    consignmentId: string,
    serials: readonly string[],
    reason: string,
    ctx: ClientContext,
  ): Promise<LabelSheet> {
    const consignment = await this.consignments.requireById(consignmentId);
    if (consignment.labelsPrintedAt === null) {
      throw new ConflictException({
        code: 'LABELS_NOT_PRINTED_YET',
        message:
          `${consignment.consignmentNumber} has not been labelled yet — print the sheet first. ` +
          'There is nothing to reprint.',
      });
    }

    const wanted = [...new Set(serials.map((x) => x.trim()).filter((x) => x.length > 0))];
    if (wanted.length === 0) {
      throw new ConflictException({
        code: 'NO_SERIALS_GIVEN',
        message: 'Name the units whose labels need reprinting.',
      });
    }

    const legIds = this.legIdsForSite(consignment);
    const units = await this.prisma.client.stockUnit.findMany({
      where: {
        sellerId: consignment.sellerId,
        serialBarcode: { in: wanted },
        goodsReceiptLine: { receiptId: { in: legIds } },
      },
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

    // A serial this consignment does not own is named rather than
    // silently dropped: printing four of the five somebody asked for,
    // with no comment, is how the fifth box stays unlabelled.
    const found = new Set(units.map((u) => u.serialBarcode));
    const missing = wanted.filter((x) => !found.has(x));
    if (missing.length > 0) {
      throw new ConflictException({
        code: 'SERIAL_NOT_ON_CONSIGNMENT',
        message: `Not part of ${consignment.consignmentNumber}: ${missing.join(', ')}`,
      });
    }

    const printedAt = new Date();
    await this.prisma.client.$transaction(async (tx) => {
      await this.units.recordLabelReprint(tx, {
        serials: wanted,
        sellerId: consignment.sellerId,
        actorType: ActorType.STAFF,
        actorId: staffId,
        reason,
      });
      await this.events.append(
        {
          consignmentId,
          type: ConsignmentEventType.LABELS_PRINTED,
          description: `${wanted.length} label(s) REPRINTED — ${reason}`,
          actorType: ActorType.STAFF,
          actorId: staffId,
        },
        tx,
      );
    });

    await this.audit.log({
      actorType: ActorType.STAFF,
      actorId: staffId,
      action: 'consignment.labels_reprinted',
      entityType: 'consignment',
      entityId: consignmentId,
      severity: 'HIGH',
      metadata: {
        consignmentNumber: consignment.consignmentNumber,
        serials: wanted,
        count: wanted.length,
        reason,
        ipAddress: ctx.ipAddress ?? null,
        userAgent: ctx.userAgent ?? null,
        requestId: ctx.requestId ?? null,
      },
    });

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
