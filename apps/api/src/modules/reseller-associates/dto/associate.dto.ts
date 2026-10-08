import { IsBoolean, Matches } from 'class-validator';

/**
 * Rupees with at most two decimals — the same shape RS-3's price rows
 * take, restated here because this DTO is the API boundary and the
 * service's own `checkAssociatePrice` is the authority. The regex keeps
 * a malformed body out; the rule about the SELLER's range is a decision
 * the service makes with data the DTO cannot see.
 */
const MONEY = /^\d{1,10}(\.\d{1,2})?$/;

export class SetAssociatePriceDto {
  @Matches(MONEY, {
    message: 'retailPriceInr: must be a rupee amount of zero or more, with at most two decimals',
  })
  retailPriceInr!: string;
}

export class SetAssociateOrdersPausedDto {
  /** True switches order CREATION off; everything already placed carries on. */
  @IsBoolean()
  paused!: boolean;
}
