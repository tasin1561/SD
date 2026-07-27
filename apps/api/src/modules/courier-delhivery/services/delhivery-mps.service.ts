import { Injectable, Logger } from '@nestjs/common';

export interface MpsBox {
  /** A PRE-FETCHED waybill. Delhivery requires one per box for MPS. */
  readonly waybill: string;
  readonly weightGrams: number;
  readonly itemDescription: string;
  readonly lengthCm?: number;
  readonly widthCm?: number;
  readonly heightCm?: number;
}

export interface MpsPlan {
  /** The box whose waybill identifies the whole consignment. */
  readonly masterWaybill: string;
  /** Total boxes, master included. */
  readonly childCount: number;
  /** Total COD across the consignment; 0 for prepaid. */
  readonly mpsAmountInr: string;
  /** Per-box create keys, ready to merge into each shipment entry. */
  readonly boxKeys: ReadonlyArray<Record<string, unknown>>;
}

/**
 * Multi-piece shipments — one order that physically travels as several
 * boxes.
 *
 * ── THE PART THAT IS EASY TO GET WRONG ───────────────────────────────
 * Every box gets its OWN waybill, and one of them is nominated master.
 * The master's waybill is repeated on every box as `master_id`, which is
 * what ties them together — get that wrong and Delhivery treats them as
 * unrelated parcels, so a three-box order arrives as three separate
 * deliveries with three tracking identities and no shared fate.
 *
 * Two more traps:
 *  - `mps_amount` is the COD total for the WHOLE consignment, not per
 *    box. Repeating the full amount on each box would ask the customer
 *    to pay three times over.
 *  - Waybills must be PRE-FETCHED (which is what the D3 pool exists
 *    for). Delhivery will not assign them for MPS.
 *
 * This service builds the per-box key set; the caller merges each into
 * the shipment entry it already builds for a single-box parcel, so the
 * two paths share all the address and payment marshalling.
 */
@Injectable()
export class DelhiveryMpsService {
  private readonly logger = new Logger(DelhiveryMpsService.name);

  /**
   * @param boxes  Every box, master first or not — the master is chosen
   *               explicitly rather than by position, so a reordering
   *               cannot silently change which parcel is authoritative.
   */
  plan(input: {
    readonly boxes: readonly MpsBox[];
    readonly masterWaybill: string;
    /** Total COD for the consignment; null/0 for prepaid. */
    readonly totalCodInr: string | null;
  }): MpsPlan {
    if (input.boxes.length < 2) {
      throw new Error(
        `MPS needs at least 2 boxes; got ${input.boxes.length}. A single box is an ordinary shipment.`,
      );
    }
    const waybills = input.boxes.map((b) => b.waybill.trim());
    if (waybills.some((w) => w === '')) {
      throw new Error(
        'Every MPS box needs a pre-fetched waybill; Delhivery will not assign them for MPS',
      );
    }
    if (new Set(waybills).size !== waybills.length) {
      throw new Error(
        'MPS boxes must have DISTINCT waybills — a repeated number would merge two boxes into one identity',
      );
    }
    if (!waybills.includes(input.masterWaybill.trim())) {
      throw new Error(`masterWaybill '${input.masterWaybill}' is not one of the boxes`);
    }

    const master = input.masterWaybill.trim();
    const mpsAmountInr = input.totalCodInr ?? '0';

    const boxKeys = input.boxes.map((box) => ({
      waybill: box.waybill.trim(),
      shipment_type: 'MPS',
      // The tie that makes N parcels one consignment.
      master_id: master,
      mps_children: input.boxes.length,
      // Consignment-wide, NOT per box — repeating it per box would bill
      // the customer once per parcel.
      mps_amount: mpsAmountInr,
      weight: String(box.weightGrams),
      products_desc: box.itemDescription.slice(0, 250),
      ...(box.lengthCm === undefined ? {} : { shipment_length: box.lengthCm }),
      ...(box.widthCm === undefined ? {} : { shipment_width: box.widthCm }),
      ...(box.heightCm === undefined ? {} : { shipment_height: box.heightCm }),
    }));

    this.logger.log({ master, boxes: input.boxes.length }, 'Planned an MPS consignment');
    return {
      masterWaybill: master,
      childCount: input.boxes.length,
      mpsAmountInr,
      boxKeys,
    };
  }
}
