/**
 * index.ts — DocJet JS/TS SDK
 *
 * Fetch-based, zero runtime dependencies, ESM+CJS dual output.
 * Node 18+ (native fetch required).
 *
 * Exports:
 *   - DocJetClient   — typed API client
 *   - DocJetError    — error class with .code + .statusCode
 *   - verifyWebhookSignature — webhook signature verifier (the differentiator)
 */

export { verifyWebhookSignature } from './webhook.js';

// ── Template ID validation ────────────────────────────────────────────────────
// From src/templates/registry.ts SLUG_RE — same allowlist enforced server-side
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

// ── Error taxonomy codes ──────────────────────────────────────────────────────
// Full set from PATTERNS §Error Taxonomy
export type DocJetErrorCode =
  | 'AUTH_INVALID'
  | 'PAYLOAD_INVALID'
  | 'TEMPLATE_NOT_FOUND'
  | 'RATE_LIMITED'
  | 'QUOTA_EXCEEDED'
  | 'CONCURRENCY_EXCEEDED'
  | 'INTERNAL_ERROR'
  | string; // allow future codes

/**
 * DocJetError — thrown on non-2xx API responses or local validation failures.
 *
 * .code       — DocJet error code from the response body (e.g. 'QUOTA_EXCEEDED')
 * .statusCode — HTTP status code (e.g. 429), or 422 for local validation errors
 */
export class DocJetError extends Error {
  public readonly code: DocJetErrorCode;
  public readonly statusCode: number;

  constructor(message: string, code: DocJetErrorCode, statusCode: number) {
    super(message);
    this.name = 'DocJetError';
    this.code = code;
    this.statusCode = statusCode;
    // Restore prototype chain (needed for instanceof checks with transpiled code)
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ── Request/Response types ────────────────────────────────────────────────────

export interface RenderOptions {
  /** Use template_id OR html (not both) */
  template_id?: string;
  html?: string;
  data?: Record<string, unknown> | null;
  options?: Record<string, unknown>;
}

export interface RenderImageOptions {
  template_id?: string;
  html?: string;
  data?: Record<string, unknown> | null;
  width?: number;
  height?: number;
}

export interface RenderResult {
  url: string;
}

export interface TemplateInfo {
  id: string;
  name: string;
  description: string;
  outputType: string;
}

export interface UsageInfo {
  period: string;
  used: number;
  limit: number;
  remaining: number;
  tier: string;
}

// ── DocJetClient ──────────────────────────────────────────────────────────────

export interface DocJetClientOptions {
  /** API key (prefix: binfra_) */
  apiKey: string;
  /** Override the default base URL (default: https://api.docjet.dev) */
  baseUrl?: string;
}

/**
 * DocJetClient — typed client for the DocJet document generation API.
 *
 * Zero runtime dependencies. Uses the global `fetch` (Node 18+).
 *
 * @example
 * ```ts
 * const client = new DocJetClient({ apiKey: 'binfra_...' });
 * const { url } = await client.render({ template_id: 'invoice-ro', data: { total: 1000 } });
 * ```
 */
export class DocJetClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(options: DocJetClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? 'https://api.docjet.dev').replace(/\/$/, '');
  }

  // ── Private request helper ──────────────────────────────────────────────────

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    requiresAuth = true,
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (requiresAuth) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const init: RequestInit = {
      method,
      headers,
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    const res = await fetch(`${this.baseUrl}${path}`, init);

    if (!res.ok) {
      let code: DocJetErrorCode = 'INTERNAL_ERROR';
      let message = `DocJet API error: HTTP ${res.status}`;
      try {
        const errBody = (await res.json()) as { error?: string; code?: string; hint?: string };
        if (errBody.code) code = errBody.code;
        if (errBody.error) message = errBody.error;
      } catch {
        // response body is not JSON — use default message
      }
      throw new DocJetError(message, code, res.status);
    }

    return (await res.json()) as T;
  }

  // ── Public methods ──────────────────────────────────────────────────────────

  /**
   * Render a PDF document.
   * Returns a signed download URL for the rendered PDF.
   *
   * @param options - template_id (or html) + data + optional render options
   */
  async render(options: RenderOptions): Promise<RenderResult> {
    // Local template_id validation (T-05-12: SLUG_RE before network call)
    if (options.template_id !== undefined && !SLUG_RE.test(options.template_id)) {
      throw new DocJetError(
        `Invalid template_id: "${options.template_id}". Must match ^[a-z0-9][a-z0-9-]{0,63}$`,
        'PAYLOAD_INVALID',
        422,
      );
    }
    return this.request<RenderResult>('POST', '/v1/render?response=url', options);
  }

  /**
   * Render a PNG image.
   * Returns a signed download URL for the rendered image.
   *
   * @param options - template_id (or html) + data + optional width/height
   */
  async renderImage(options: RenderImageOptions): Promise<RenderResult> {
    // Local template_id validation (T-05-12)
    if (options.template_id !== undefined && !SLUG_RE.test(options.template_id)) {
      throw new DocJetError(
        `Invalid template_id: "${options.template_id}". Must match ^[a-z0-9][a-z0-9-]{0,63}$`,
        'PAYLOAD_INVALID',
        422,
      );
    }
    return this.request<RenderResult>('POST', '/v1/image?response=url', options);
  }

  /**
   * List all available templates.
   * Public endpoint — no authentication required (returns cached response).
   */
  async listTemplates(): Promise<TemplateInfo[]> {
    return this.request<TemplateInfo[]>('GET', '/v1/templates', undefined, false);
  }

  /**
   * Get current API key usage for the billing period.
   */
  async usage(): Promise<UsageInfo> {
    return this.request<UsageInfo>('GET', '/v1/keys/usage');
  }
}
