export interface RevealBankAccountRequest {
  readonly reason?: string;
}

export interface RevealBankAccountResponse {
  readonly accountNumber: string | null;
}
