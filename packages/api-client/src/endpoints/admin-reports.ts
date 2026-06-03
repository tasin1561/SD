export interface ReportSummary {
  readonly range: { readonly from: string; readonly to: string };
  readonly orders: {
    readonly created: number;
    readonly confirmed: number;
    readonly delivered: number;
    readonly rtoInitiated: number;
    readonly cancelled: number;
    readonly rejectedNdr: number;
    readonly confirmRate: number;
    readonly ndrRate: number;
    readonly rtoRate: number;
    readonly deliveryRate: number;
  };
  readonly shipments: {
    readonly dispatched: number;
    readonly avgDispatchHoursFromConfirm: number | null;
    readonly avgDeliveryDaysFromDispatch: number | null;
  };
  readonly wallet: {
    readonly codCollected: string;
    readonly chargesDebited: string;
    readonly remittancesPaid: string;
    readonly netOutstanding: string;
  };
}
