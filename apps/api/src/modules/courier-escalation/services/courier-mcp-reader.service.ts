import { Injectable, Logger } from '@nestjs/common';

export interface McpThreadMessage {
  readonly externalTicketId: string;
  readonly body: string;
  readonly occurredAt: Date;
  readonly sourceRef: string | null;
}

export interface McpAvailability {
  readonly available: boolean;
  readonly reason: string | null;
}

/**
 * The Delhivery One MCP reader — built, and inert.
 *
 * ── WHY IT EXISTS BEFORE IT WORKS ────────────────────────────────────
 * MCP is a READ channel that would give us ticket threads directly,
 * without email parsing or a browser. Token minting currently fails with
 * `404 Realm does not exist` for realm `ucp-V6IMWCLJOOFT` and a ticket is
 * open with Delhivery. That is a BLOCKED EXTERNAL DEPENDENCY, not a task:
 * nothing we write makes it work.
 *
 * So the shape exists behind the adapter and reports itself unavailable.
 * When provisioning lands it becomes a configuration change plus the
 * transport, and the pipeline above it does not move. Building it later
 * from scratch would mean designing the read pipeline around email's
 * quirks and then discovering MCP does not fit them.
 *
 * ── DO NOT RUN `uvx d1-mcp-mint` IN PRODUCTION ───────────────────────
 * It is a third-party PyPI package that would receive our client secret,
 * and `@latest` means the code it runs can change without us. It is a
 * developer shim for minting a token by hand; the real path is a direct
 * Keycloak `client_credentials` grant over Streamable HTTP.
 *
 * ── DEGRADES, NEVER THROWS ───────────────────────────────────────────
 * Callers ask `availability()` and skip. An unprovisioned optional
 * channel must not be able to fail the read pipeline — email is the
 * channel that has to work.
 */
@Injectable()
export class CourierMcpReaderService {
  private readonly logger = new Logger(CourierMcpReaderService.name);

  /**
   * Whether MCP can be used at all.
   *
   * Configuration is env-only and absent today. When it lands, the
   * client secret follows CUR-1 and lives in `courier_credentials` — it
   * authenticates US to Delhivery, which is exactly what that table is
   * for — while the URL stays a system setting.
   */
  availability(): McpAvailability {
    const url = (process.env['D1_MCP_URL'] ?? '').trim();
    if (url === '') {
      return {
        available: false,
        reason:
          'D1_MCP_URL is unset. Delhivery One MCP is not provisioned — token minting returns "404 Realm does not exist" and a ticket is open with them.',
      };
    }
    return {
      available: false,
      reason:
        'MCP transport is not implemented yet: the realm 404 has never been resolved, so there is nothing to build the client against. TODO(delhivery-api).',
    };
  }

  /**
   * Tickets updated since a timestamp.
   *
   * Returns an empty list while unavailable rather than throwing, so a
   * caller can loop over channels without special-casing this one.
   */
  async listUpdatedSince(_since: Date): Promise<readonly McpThreadMessage[]> {
    const a = this.availability();
    if (!a.available) {
      this.logger.debug({ reason: a.reason }, 'MCP reader skipped — not available');
      return [];
    }
    // TODO(delhivery-api): Streamable HTTP + Keycloak client_credentials.
    // Unreachable until availability() can return true.
    return [];
  }
}
