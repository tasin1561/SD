export interface SellerInvoiceView {
  readonly id: string;
  readonly invoiceNumber: string;
  readonly invoiceDate: string;
  readonly pdfUrl: string | null;
  readonly totalInr: string;
}

export interface GenerateInvoiceResponse {
  readonly id: string;
  readonly invoiceNumber: string;
  readonly pdfUrl: string;
  readonly alreadyExisted: boolean;
}
