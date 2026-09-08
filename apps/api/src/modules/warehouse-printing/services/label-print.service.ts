import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
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
/** A reprint is a handful of damaged labels, not a run. */
const MAX_REPRINT = 25;

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
    const failed: Array<{ shipmentId: string; shipmentNumber: string; reason: string }> = [];
    const manual: ManualLabelPayload[] = [];

    // Built in SELECTION order, so the stack comes off the printer in
    // the order it will be sorted on the bench. The manual parcels are
    // one generated document (four to a sheet), so the first manual
    // parcel reserves its slot and the rest fold into it — that keeps
    // three manual labels on one page instead of three.
    const slots: Array<{ shipmentId: string; bytes: Buffer } | { manualSlot: true }> = [];
    let manualSlotTaken = false;

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
        if (!manualSlotTaken) {
          slots.push({ manualSlot: true });
          manualSlotTaken = true;
        }
        continue;
      }

      // An integrated courier's label was fetched at booking and stored
      // in OUR bucket (CUR-6) — never re-fetched from the courier here,
      // which would spend a live API call per print and hand back a
      // different file each time.
      if (s.labelKey === null) {
        failed.push({
          shipmentId: id,
          shipmentNumber: s.shipmentNumber,
          reason: 'NO_STORED_LABEL — the courier label was never captured for this parcel',
        });
        continue;
      }
      const bytes = await this.spaces.getObject(s.labelKey);
      if (bytes === null) {
        failed.push({
          shipmentId: id,
          shipmentNumber: s.shipmentNumber,
          reason: 'LABEL_MISSING_FROM_STORAGE',
        });
        continue;
      }
      slots.push({ shipmentId: id, bytes });
    }

    const manualDoc = manual.length === 0 ? null : await this.manualPdf.render(manual);
    const parts = slots.flatMap((slot) => {
      if (!('manualSlot' in slot)) return [slot];
      return manualDoc === null ? [] : [{ shipmentId: 'manual-labels', bytes: manualDoc }];
    });

    const merged = await this.sheet.merge(parts);
    for (const id of merged.failed) {
      const s = shipments.get(id);
      failed.push({
        shipmentId: id,
        shipmentNumber: s?.shipmentNumber ?? '—',
        reason: 'UNREADABLE_PDF',
      });
    }

    /*
      COUNT THE SHEET, not the confirmation.

      A label that came out of the printer exists in the building whether
      or not anybody clicked "yes it printed" afterwards — and the
      question this number answers is asked later, after a box turns up
      somewhere it should not have: "could there be two of this label?".
      Confirmation answers a different question (did the paper reach a
      hand) and already has its own stamp.

      Only the parcels that actually got a label are counted; a NOT_FOUND
      or NO_AWB row produced no paper and must not read as though it did.
    */
    const printedIds = shipmentIds.filter((id) => !failed.some((f) => f.shipmentId === id));
    if (printedIds.length > 0) {
      await this.prisma.client.shipment.updateMany({
        where: { id: { in: printedIds } },
        data: { labelPrintCount: { increment: 1 } },
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
   * Print a label again for a parcel that has not been packed.
   *
   * ── WHY IT IS ITS OWN METHOD ─────────────────────────────────────────
   * `build` could always produce a sheet for an already-printed parcel;
   * what was missing was a way to REACH one and a record that it
   * happened. Adding a flag to `build` would have made "how often are we
   * reprinting" a question you answer by reading argument values, which
   * is the same mistake `force-complete` avoids by being a separate
   * endpoint (LBL-4). So: its own method, its own permission, its own
   * audit action, a reason on every call.
   *
   * ── WHY "NOT PACKED" IS THE LINE, AND WHY IT IS SAFE ─────────────────
   * Before the pack bench a parcel is a CLAIM, not a box. Two copies of
   * its label are two pieces of paper, and only one box can ever be
   * opened against it — `pack_boxes` carries a partial unique on the
   * shipment, so a second packer is refused by the database rather than
   * by a check somebody might remove.
   *
   * Once the box is SEALED the arithmetic inverts: a second label is a
   * second box waiting to happen, one of which would be delivered to
   * nobody. So a packed parcel is refused BY NAME here rather than
   * silently dropped — "cannot reprint this" sends somebody hunting,
   * where "this parcel is already packed" ends the question. And if a
   * duplicate ever does reach a bench, SCAN-1 stops the operator who
   * scans it and raises a HIGH issue, because by then the pile is in
   * doubt and not only the box.
   *
   * The reprint does NOT re-stamp `labelPrintedAt`: that records the
   * FIRST print, the parcel is already past that gate, and moving it
   * would erase when the parcel actually reached the floor. The count is
   * what records the second sheet.
   */
  async reprint(
    shipmentIds: readonly string[],
    staffId: string,
    reason: string,
    ctx?: ClientContext,
  ): Promise<LabelSheetResult> {
    if (shipmentIds.length === 0) {
      throw new BadRequestException({
        code: 'NO_SHIPMENTS_SELECTED',
        message: 'Select at least one parcel to reprint',
      });
    }
    if (shipmentIds.length > MAX_REPRINT) {
      // A reprint of two hundred is a whole-run reprint wearing a hat,
      // and that is the first-print flow, which has not been confirmed
      // yet. Same argument as LBL-5's cap on serial reprints.
      throw new BadRequestException({
        code: 'TOO_MANY_REPRINTS',
        message:
          `A reprint covers at most ${MAX_REPRINT} parcels. More than that is a whole run — ` +
          `if the sheet never printed, do not confirm it and print the run again instead.`,
      });
    }
    if (reason.trim().length < 10) {
      throw new BadRequestException({
        code: 'REPRINT_REASON_TOO_SHORT',
        message: 'Say why this is being reprinted, in at least 10 characters',
      });
    }

    const packed = await this.prisma.client.shipment.findMany({
      where: { id: { in: [...shipmentIds] }, packCompletedAt: { not: null } },
      select: { id: true, shipmentNumber: true },
    });
    if (packed.length > 0) {
      throw new ConflictException({
        code: 'LABEL_REPRINT_ALREADY_PACKED',
        message:
          `${packed.map((p) => p.shipmentNumber).join(', ')} ${packed.length === 1 ? 'is' : 'are'} ` +
          `already packed. A second label on a sealed box is how two parcels come to carry one ` +
          `waybill — if the label is damaged, the box has to be opened and repacked.`,
      });
    }

    const sheet = await this.build(shipmentIds, staffId);

    await this.audit.log({
      actorType: ActorType.STAFF,
      actorId: staffId,
      // Its own action, deliberately NOT a flag on the ordinary print:
      // "how often are we reprinting labels" has to be answerable by
      // filtering the audit log.
      action: 'warehouse.labels.reprinted',
      entityType: 'shipment',
      entityId: shipmentIds[0] ?? null,
      severity: 'HIGH',
      metadata: {
        shipmentIds: [...shipmentIds],
        reason: reason.trim(),
        failedCount: sheet.failed.length,
        ipAddress: ctx?.ipAddress ?? null,
        userAgent: ctx?.userAgent ?? null,
        requestId: ctx?.requestId ?? null,
      },
    });

    return sheet;
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
