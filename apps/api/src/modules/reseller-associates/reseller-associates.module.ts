import { Module } from '@nestjs/common';
import { StoreJwtGuard } from '../../common/guards/store-jwt.guard';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { CatalogReadModule } from '../catalog-read/catalog-read.module';
import { ResellerOrderGateModule } from '../reseller-order-gate/reseller-order-gate.module';
import { StoreAssociateController } from './controllers/store-associate.controller';
import { AssociatePriceService } from './services/associate-price.service';
import { AssociateService } from './services/associate.service';

/**
 * ASSOC-1 — a reseller store's own sales people: who they are, what each
 * sells a product at, and whether each may still place orders
 * (docs/associates.md).
 *
 * EXPORTS `AssociatePriceService` and nothing else. The order path needs
 * one answer from here — "what does this person sell these products at"
 * — and gets it through `pricesFor`, called inside its own transaction.
 * `AssociateService`, which holds the seller's-range check and the audit
 * rows, is INTERNAL: a caller reaching past it would write a price that
 * nobody checked against the seller's terms, which is the one thing
 * `ASSOCIATE_PRICE_OUT_OF_SELLER_RANGE` exists to prevent.
 *
 * ── WHAT IT IMPORTS, AND WHY THERE IS NO CYCLE ───────────────────────
 * `ResellerOrderGateModule` is RS-5's dependency-free R3 primitive: it
 * answers "what may this store sell, at what terms" (`offersFor`) and
 * imports neither the catalogue module nor the order module, so this one
 * can read the seller's retail range through it without closing a loop.
 * Variants are reached only through `CatalogReadService` (MUST #13).
 * `ResellerCatalogueModule` imports THIS module for the associate's own
 * price on `GET /store/catalogue/sell`; nothing here imports it back.
 */
@Module({
  imports: [AuthCommonModule, CatalogReadModule, ResellerOrderGateModule],
  controllers: [StoreAssociateController],
  providers: [AssociatePriceService, AssociateService, StoreJwtGuard],
  exports: [AssociatePriceService],
})
export class ResellerAssociatesModule {}
