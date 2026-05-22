import { Injectable } from '@nestjs/common';
import { CredentialEnvironment } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { EnvService } from '../../../config/env.service';
import { CourierCredentialService } from '../../courier-shared/services/courier-credential.service';

const BASE_URL_SETTING = 'courier.delhivery_api_base_url';
const COURIER_CODE = 'delhivery';

/** TODO(delhivery-api): the credential field name that holds the API
 *  token. OUR encrypted payload shape is our choice — `apiToken` is the
 *  agreed key. Confirmed against the credential seed when real creds
 *  are provisioned. */
const TOKEN_FIELD = 'apiToken';

export interface DelhiveryRequestOptions {
  method: 'GET' | 'POST';
  /** Path appended to the resolved base URL. */
  path: string;
  body?: unknown;
  /** Override environment; defaults to PRODUCTION outside NODE_ENV!=production. */
  environment?: CredentialEnvironment;
}

/**
 * Module 9 — shared Delhivery wire infrastructure (commit 4). The
 * capability services (DelhiveryAwbService / DelhiveryLabelService /
 * DelhiveryServiceabilityService, commits 5-6) inject this for
 * base-URL resolution, auth, stub-mode gating and the raw request
 * helper.
 *
 * ── STUB MODE ──────────────────────────────────────────────────────
 * When `courier.delhivery_api_base_url` is EMPTY the adapter runs in
 * STUB MODE: no network, deterministic mock responses. This is the
 * default for local dev + e2e + CI. `isStubMode()` is the gate every
 * capability method checks first. Real mode (base URL set) is reached
 * only with provisioned credentials + a validated wire contract.
 *
 * ── TODO(delhivery-api) ────────────────────────────────────────────
 * Delhivery's exact endpoints, auth header format, request/response
 * JSON field names and error codes are NOT reliably known at build
 * time. Every such spot is marked `TODO(delhivery-api)`. The real-mode
 * `request()` body deliberately throws until the contract is validated
 * against Delhivery's sandbox — the orchestration above it
 * (saga / supersede / dispatch / conservation) is fully built + tested
 * in stub mode.
 */
@Injectable()
export class DelhiveryHttpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly credentials: CourierCredentialService,
  ) {}

  /** STUB MODE when `courier.delhivery_api_base_url` is unset/empty. */
  async isStubMode(): Promise<boolean> {
    return (await this.rawBaseUrl()) === '';
  }

  /** The configured base URL. Throws if called in stub mode — callers
   *  must branch on `isStubMode()` first. */
  async getBaseUrl(): Promise<string> {
    const url = await this.rawBaseUrl();
    if (url === '') {
      throw new Error(
        'DelhiveryHttpService.getBaseUrl called in STUB MODE (courier.delhivery_api_base_url is empty)',
      );
    }
    return url;
  }

  /** The credential environment for the current runtime. */
  environment(): CredentialEnvironment {
    return this.env.isProduction
      ? CredentialEnvironment.PRODUCTION
      : CredentialEnvironment.SANDBOX;
  }

  /**
   * Auth headers for a real Delhivery call. Resolves the API token via
   * CourierCredentialService (CUR-1 — decrypt-with-audit, never logged).
   *
   * TODO(delhivery-api): verify the auth scheme. Delhivery's REST API
   * is documented as `Authorization: Token <api_token>`; the SCHEME
   * word ("Token") and whether any other header is required must be
   * confirmed against the live docs before real mode is enabled.
   */
  async authHeaders(
    environment: CredentialEnvironment = this.environment(),
  ): Promise<Record<string, string>> {
    const creds = await this.credentials.getCredential(
      COURIER_CODE,
      environment,
    );
    const token = creds[TOKEN_FIELD];
    if (token === undefined || token === '') {
      throw new Error(
        `Delhivery credential is missing the '${TOKEN_FIELD}' field`,
      );
    }
    return {
      // TODO(delhivery-api): confirm "Token" scheme + exact header name.
      Authorization: `Token ${token}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Raw request helper for real mode. Deliberately unimplemented until
   * the Delhivery wire contract is validated — see class JSDoc. Callers
   * reach this ONLY when `isStubMode()` is false, which only happens
   * once an operator sets the base URL.
   */
  async request<T>(_opts: DelhiveryRequestOptions): Promise<T> {
    // TODO(delhivery-api): implement the fetch call —
    //   - exact endpoint paths (per capability)
    //   - request JSON field names + envelope shape
    //   - response parsing → our DTOs
    //   - HTTP + Delhivery error-code → DelhiveryAwbFailure mapping
    //   - rate-limit / timeout handling (phase-1a-debt: retry/backoff only)
    // Until then real mode is not operable; stub mode is the build +
    // test path.
    throw new Error(
      'DelhiveryHttpService.request: real-mode Delhivery wire contract not yet implemented (TODO(delhivery-api)). Run in stub mode (empty courier.delhivery_api_base_url).',
    );
  }

  private async rawBaseUrl(): Promise<string> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: BASE_URL_SETTING },
      select: { valueString: true },
    });
    return (row?.valueString ?? '').trim();
  }
}
