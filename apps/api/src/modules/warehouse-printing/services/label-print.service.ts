import { BadRequestException, Injectable } from '@nestjs/common';
import { ActorType } from '@skydrop/db';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { SpacesService } from '../../../infrastructure/spaces/spaces.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';
import { LabelSheetService } from './label-sheet.service';
import { ManualLabelPdfService, type ManualLabelPayload } from './manual-label-pdf.service';

export interface LabelSheetResult {
  readonly pdfBase64: string;
  readonly fileName: string;
  readonly shipmentCount: number;
  readonly pageCount: number;
  /** Parcels whose label could not be produced. Named, never dropped. */
  readonly failed: ReadonlyArray<{ shipmentId: string; shipmentNumber: string; reason: string }>;
}

const MAX_PER_SHEET = 100;

/**
 * Build the sheet, then — separately — record that it was printed.
 *
 * The two are deliberately NOT one call. A printer jams, a browser eats
 * the download, somebody prints to the wrong tray; stamping "printed"
 * because a PDF was generated would move parcels forward on the strength
 * of a file nobody held. So the operator confirms, and the confirmation
 * is the fact we record.
 */
@Injectable()
export class LabelPrintService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly spaces: SpacesService,
    private readonly sheet: LabelSheetService,
    private readonly manualPdf: ManualLabelPdfService,
  ) {}

  async build(shipmentIds: readonly string[], staffId: string): Promise<LabelSheetResult> {
    if (shipmentIds.length === 0) {
      throw new BadRequestException({
        code: 'NO_SHIPMENTS_SELECTED',
        message: 'Select at least one parcel to print labels for',
      });
    }
    if (shipmentIds.length > MAX_PER_SHEET) {
      throw new BadRequestException({
        code: 'TOO_MANY_SHIPMENTS',
        message: `A sheet holds at most ${MAX_PER_SHEET} labels; select fewer`,
      });
    }

    const shipments = await this.load(shipmentIds);
    const parts: Array<{ shipmentId: string; bytes: Buffer }> = [];
    const failed: Array<{ shipmentId: string; shipmentNumber: string; reason: string }> = [];
    const manual: ManualLabelPayload[] = [];
    const manualIds: string[] = [];

    // Selection order, not courier order: the stack comes off the
    // printer in the order it will be sorted on the bench.
    for (const id of shipmentIds) {
      const s = shipments.get(id);
      if (s === undefined) {
        failed.push({ shipmentId: id, shipmentNumber: '—', reason: 'NOT_FOUND' });
        continue;
      }
      if (s.awbNumber === null) {
        failed.push({
          shipmentId: id,
          shipmentNumber: s.shipmentNumber,
          reason: 'NO_AWB — nothing has been booked for this parcel yet',
        });
        continue;
      }

      if (s.isManualCourier) {
        // No API behind a manual courier, so we draw the label (CUR-6).
        manual.push(this.toManualPayload(s));
        manualIds.push(id);
        continue;
      }

      // An integrated courier's label was fetched at booking and stored
      // in OUR bucket (CUR-6) — never re-fetched from the courier here,
      // which would spend a live API call per print and hand back a
      // different file each time.
      const key = s.labelKey;
      if (key === null) {
        failed.push({
          shipmentId: id,
          shipmentNumber: s.shipmentNumber,
          reason: 'NO_STORED_LABEL — the courier label was never captured for this parcel',
        });
        continue;
      }
      const bytes = await this.spaces.getObject(key);
      if (bytes === null) {
        failed.push({
          shipmentId: id,
          shipmentNumber: s.shipmentNumber,
          reason: 'LABEL_MISSING_FROM_STORAGE',
        });
        continue;
      }
      parts.push({ shipmentId: id, bytes });
    }

    // Every manual label on one generated document, inserted where the
    // FIRST manual parcel sat in the selection. Four to a sheet, so a
    // batch of three manual parcels is one page rather than three.
    if (manual.length > 0) {
      const bytes = await this.manualPdf.render(manual);
      const firstIdx = shipmentIds.findIndex((id) => manualIds.includes(id));
      const at = Math.max(
        0,
        parts.findIndex((p) => shipmentIds.indexOf(p.shipmentId) > firstIdx),
      );
      const entry = { shipmentId: manualIds[0] ?? 'manual', bytes };
      if (at === 0 && parts.length > 0 && shipmentIds.indexOf(parts[0]!.shipmentId) < firstIdx) {
        parts.push(entry);
      } else {
        parts.splice(at, 0, entry);
      }
    }

    const merged = await this.sheet.merge(parts);
    for (const id of merged.failed) {
      const s = shipments.get(id);
      failed.push({
        shipmentId: id,
        shipmentNumber: s?.shipmentNumber ?? '—',
        reason: 'UNREADABLE_PDF',
      });
    }

    await this.audit.log({
      actorType: ActorType.STAFF,
      actorId: staffId,
      action: 'warehouse.labels.built',
      entityType: 'shipment',
      entityId: shipmentIds[0] ?? null,
      severity: 'LOW',
      metadata: {
        shipmentIds: [...shipmentIds],
        pageCount: merged.pageCount,
        manualCount: manual.length,
        failedCount: failed.length,
      },
    });

    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '');
    return {
      pdfBase64: merged.pdf.toString('base64'),
      fileName: `skydrop-labels-${stamp}.pdf`,
      shipmentCount: shipmentIds.length - failed.length,
      pageCount: merged.pageCount,
      failed,
    };
  }

  /**
   * The operator says the paper is in their hand.
   *
   * Guarded `updateMany` on `labelPrintedAt IS NULL`, so a second
   * confirmation of the same batch is a no-op rather than a re-stamp
   * that would make the audit trail claim two prints.
   */
  async confirmPrinted(
    shipmentIds: readonly string[],
    staffId: string,
    ctx?: ClientContext,
  ): Promise<{ confirmed: number; alreadyPrinted: number }> {
    if (shipmentIds.length === 0) {
      throw new BadRequestException({
        code: 'NO_SHIPMENTS_SELECTED',
        message: 'Nothing to confirm',
      });
    }
    const now = new Date();
    const res = await this.prisma.client.shipment.updateMany({
      where: { id: { in: [...shipmentIds] }, labelPrintedAt: null },
      data: { labelPrintedAt: now, labelPrintedByStaffId: staffId },
    });

    await this.audit.log({
      actorType: ActorType.STAFF,
      actorId: staffId,
      action: 'warehouse.labels.print_confirmed',
      entityType: 'shipment',
      entityId: shipmentIds[0] ?? null,
      severity: 'MEDIUM',
      metadata: {
        shipmentIds: [...shipmentIds],
        confirmed: res.count,
        alreadyPrinted: shipmentIds.length - res.count,
        ipAddress: ctx?.ipAddress ?? null,
        userAgent: ctx?.userAgent ?? null,
        requestId: ctx?.requestId ?? null,
      },
    });

    return { confirmed: res.count, alreadyPrinted: shipmentIds.length - res.count };
  }

  private toManualPayload(s: LoadedShipment): ManualLabelPayload {
    return {
      awbNumber: s.awbNumber ?? '—',
      courierName: s.manualCourierName ?? 'Manual courier',
      orderNumber: s.orderNumber,
      sellerCompanyName: s.sellerCompanyName ?? '',
      recipientName: s.destRecipientName,
      recipientPhone: s.destRecipientPhoneE164,
      addressLine1: s.destAddressLine1,
      addressLine2: s.destAddressLine2 ?? '',
      city: s.destCity,
      stateProvince: s.destStateProvince,
      postalCode: s.destPostalCode,
      isCod: s.codAmountInr !== null,
      codAmountInr: s.codAmountInr,
      weightGrams: s.totalWeightGrams,
      items: s.items,
    };
  }

  private async load(ids: readonly string[]): Promise<Map<string, LoadedShipment>> {
    const rows = await this.prisma.client.shipment.findMany({
      where: { id: { in: [...ids] }, deletedAt: null },
      select: {
        id: true,
        shipmentNumber: true,
        awbNumber: true,
        isManualCourier: true,
        manualCourierName: true,
        destRecipientName: true,
        destRecipientPhoneE164: true,
        destAddressLine1: true,
        destAddressLine2: true,
        destCity: true,
        destStateProvince: true,
        destPostalCode: true,
        totalWeightGrams: true,
        awbLabels: {
          where: { isCurrent: true },
          select: { spacesKey: true },
          take: 1,
        },
        items: {
          select: { skuCode: true, productName: true, quantity: true },
        },
        orderShipments: {
          select: {
            order: {
              select: {
                orderNumber: true,
                codAmountInr: true,
                seller: { select: { companyName: true } },
              },
            },
          },
          take: 1,
        },
      },
    });

    const map = new Map<string, LoadedShipment>();
    for (const r of rows) {
      const order = r.orderShipments[0]?.order;
      map.set(r.id, {
        shipmentNumber: r.shipmentNumber,
        awbNumber: r.awbNumber,
        isManualCourier: r.isManualCourier,
        manualCourierName: r.manualCourierName,
        labelKey: r.awbLabels[0]?.spacesKey ?? null,
        destRecipientName: r.destRecipientName,
        destRecipientPhoneE164: r.destRecipientPhoneE164,
        destAddressLine1: r.destAddressLine1,
        destAddressLine2: r.destAddressLine2,
        destCity: r.destCity,
        destStateProvince: r.destStateProvince,
        destPostalCode: r.destPostalCode,
        totalWeightGrams: r.totalWeightGrams,
        orderNumber: order?.orderNumber ?? '—',
        sellerCompanyName: order?.seller?.companyName ?? null,
        codAmountInr: order?.codAmountInr?.toString() ?? null,
        items: r.items.map((i) => ({
          name: i.productName,
          skuCode: i.skuCode,
          quantity: i.quantity,
        })),
      });
    }
    return map;
  }
}

interface LoadedShipment {
  readonly shipmentNumber: string;
  readonly awbNumber: string | null;
  readonly isManualCourier: boolean;
  readonly manualCourierName: string | null;
  readonly labelKey: string | null;
  readonly destRecipientName: string;
  readonly destRecipientPhoneE164: string;
  readonly destAddressLine1: string;
  readonly destAddressLine2: string | null;
  readonly destCity: string;
  readonly destStateProvince: string;
  readonly destPostalCode: string;
  readonly totalWeightGrams: number | null;
  readonly orderNumber: string;
  readonly sellerCompanyName: string | null;
  readonly codAmountInr: string | null;
  readonly items: ReadonlyArray<{ name: string; skuCode: string; quantity: number }>;
}
