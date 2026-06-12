/**
 * client.test.ts — TDD RED: tests for DocJetClient + DocJetError
 * These tests MUST fail before implementation exists.
 *
 * Uses vi.stubGlobal to mock global fetch (zero runtime deps — no node-fetch, no axios).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Imports under test — will fail (RED) until implementation exists
import { DocJetClient, DocJetError } from '../index.js';

const DEMO_API_KEY = 'binfra_test_demo_key_0000000000000000000000000000000000000000';
const BASE_URL = 'https://api.docjet.dev';

// Helper: build a mock fetch that returns a given JSON body + status
function mockFetch(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

describe('DocJetClient', () => {
  let client: DocJetClient;

  beforeEach(() => {
    client = new DocJetClient({ apiKey: DEMO_API_KEY });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── render ────────────────────────────────────────────────────────────────

  it('render() POSTs to /v1/render?response=url with Bearer and returns {url}', async () => {
    const fetchMock = mockFetch({ url: 'https://cdn.docjet.dev/out/test.pdf' });
    vi.stubGlobal('fetch', fetchMock);

    const result = await client.render({ template_id: 'invoice-ro', data: { total: 100 } });

    expect(result).toEqual({ url: 'https://cdn.docjet.dev/out/test.pdf' });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/v1/render?response=url`);
    expect((init.headers as Record<string, string>)['Authorization']).toBe(
      `Bearer ${DEMO_API_KEY}`,
    );
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(init.method).toBe('POST');
  });

  it('render() throws DocJetError with code QUOTA_EXCEEDED and statusCode 429 on 429', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({ error: 'Quota exceeded', code: 'QUOTA_EXCEEDED', hint: 'Upgrade plan' }, 429),
    );

    await expect(
      client.render({ template_id: 'invoice-ro', data: {} }),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(DocJetError);
      const e = err as DocJetError;
      expect(e.code).toBe('QUOTA_EXCEEDED');
      expect(e.statusCode).toBe(429);
      return true;
    });
  });

  it('render() throws DocJetError code AUTH_INVALID + statusCode 401 on 401', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({ error: 'Unauthorized', code: 'AUTH_INVALID', hint: 'Check API key' }, 401),
    );

    await expect(client.render({ template_id: 'invoice-ro', data: {} })).rejects.toSatisfy(
      (err: unknown) => {
        const e = err as DocJetError;
        expect(e.code).toBe('AUTH_INVALID');
        expect(e.statusCode).toBe(401);
        return true;
      },
    );
  });

  it('render() throws DocJetError code PAYLOAD_INVALID locally for invalid template_id (no fetch)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      client.render({ template_id: 'INVALID TEMPLATE ID!', data: {} }),
    ).rejects.toSatisfy((err: unknown) => {
      const e = err as DocJetError;
      expect(e.code).toBe('PAYLOAD_INVALID');
      expect(e.statusCode).toBe(422);
      return true;
    });

    // fetch must NOT have been called (local validation fires before request)
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('render() allows valid template_id slug (letters, digits, hyphens)', async () => {
    vi.stubGlobal('fetch', mockFetch({ url: 'https://cdn.docjet.dev/out/test.pdf' }));
    await expect(
      client.render({ template_id: 'my-valid-template-01', data: {} }),
    ).resolves.toBeDefined();
  });

  // ── renderImage ───────────────────────────────────────────────────────────

  it('renderImage() POSTs to /v1/image?response=url and returns {url}', async () => {
    const fetchMock = mockFetch({ url: 'https://cdn.docjet.dev/out/test.png' });
    vi.stubGlobal('fetch', fetchMock);

    const result = await client.renderImage({ template_id: 'og-card', data: { title: 'Test' } });

    expect(result).toEqual({ url: 'https://cdn.docjet.dev/out/test.png' });

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/v1/image?response=url`);
  });

  // ── listTemplates ─────────────────────────────────────────────────────────

  it('listTemplates() GETs /v1/templates and returns array', async () => {
    const templates = [
      { id: 'invoice-ro', name: 'Invoice RO', description: 'Romanian invoice', outputType: 'pdf' },
    ];
    const fetchMock = mockFetch(templates);
    vi.stubGlobal('fetch', fetchMock);

    const result = await client.listTemplates();
    expect(result).toEqual(templates);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/v1/templates`);
    expect(init.method).toBe('GET');
  });

  // ── usage ─────────────────────────────────────────────────────────────────

  it('usage() GETs /v1/keys/usage and returns usage object', async () => {
    const usageData = { period: '2026-06', used: 10, limit: 50, remaining: 40, tier: 'demo' };
    const fetchMock = mockFetch(usageData);
    vi.stubGlobal('fetch', fetchMock);

    const result = await client.usage();
    expect(result).toEqual(usageData);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/v1/keys/usage`);
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>)['Authorization']).toBe(
      `Bearer ${DEMO_API_KEY}`,
    );
  });

  // ── custom baseUrl ────────────────────────────────────────────────────────

  it('uses a custom baseUrl when provided', async () => {
    const customClient = new DocJetClient({
      apiKey: DEMO_API_KEY,
      baseUrl: 'https://staging.api.docjet.dev',
    });
    const fetchMock = mockFetch({ url: 'https://cdn.docjet.dev/out/test.pdf' });
    vi.stubGlobal('fetch', fetchMock);

    await customClient.render({ template_id: 'invoice-ro', data: {} });

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('staging.api.docjet.dev');
  });

  // ── DocJetError ───────────────────────────────────────────────────────────

  it('DocJetError is an instance of Error', () => {
    const err = new DocJetError('Test error', 'TEST_CODE', 500);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Test error');
    expect(err.code).toBe('TEST_CODE');
    expect(err.statusCode).toBe(500);
  });
});
