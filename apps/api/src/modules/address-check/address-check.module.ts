import { Module } from '@nestjs/common';
import { SolustationHttpService } from './services/solustation-http.service';

/**
 * Order page v2 — address checking against Solustation Address.
 *
 * Solustation is OUR OWN company's service and a SEPARATE PRODUCT. It
 * is reached only over its public HTTPS URL, with a Bearer key from
 * env: never by importing its code, reading its database, or touching
 * its files or services on the server — even though both run on the
 * same host today. The coupling is deliberately only the HTTP contract,
 * so either side can be deployed, moved or rewritten without the other
 * finding out.
 *
 * Nothing in here may block an order. Every call can fail and every
 * caller carries on: a check is advice about a delivery, and a delivery
 * that was going to be attempted is still attempted. `SOLADDR_API_KEY`
 * being empty is a supported state, not a misconfiguration — the page
 * says "Address check unavailable" and saving behaves exactly as it did
 * before any of this existed.
 *
 * The HTTP client is exported because the queue workers and the
 * per-console proxy controllers all need it and none of them should
 * reimplement base-URL resolution, auth or failure classification.
 */
@Module({
  providers: [SolustationHttpService],
  exports: [SolustationHttpService],
})
export class AddressCheckModule {}
