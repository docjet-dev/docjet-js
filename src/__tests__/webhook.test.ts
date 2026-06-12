/**
 * webhook.test.ts — TDD RED: tests for verifyWebhookSignature
 * These tests MUST fail before implementation exists.
 *
 * Algorithm under test — inverse of server's buildSignatureHeader:
 *   t = unix seconds
 *   v1 = HMAC-SHA256(secret, `${t}.${rawBody}`).hex
 *   header = `t=${t},v1=${v1}`
 */
import { createHmac } from 'node:crypto';
import { describe, it, expect } from 'vitest';

// Import under test — will fail (RED) until implementation exists
import { verifyWebhookSignature } from '../webhook.js';

/**
 * Mirror of server's buildSignatureHeader — used in tests to build valid signatures.
 * MUST stay byte-for-byte identical to src/delivery/webhook.ts:buildSignatureHeader.
 */
function buildSignatureHeader(rawBody: string, secret: string, nowSeconds?: number): string {
  const t = nowSeconds ?? Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

const SECRET = 'test-webhook-secret-abc123';
const RAW_BODY = JSON.stringify({ event: 'render.complete', jobId: 'job_01' });
const NOW = Math.floor(Date.now() / 1000);

describe('verifyWebhookSignature', () => {
  it('returns true for a valid server-built signature (round-trip)', () => {
    const header = buildSignatureHeader(RAW_BODY, SECRET, NOW);
    expect(verifyWebhookSignature(RAW_BODY, header, SECRET)).toBe(true);
  });

  it('returns false for a tampered v1 (one hex char changed)', () => {
    const header = buildSignatureHeader(RAW_BODY, SECRET, NOW);
    // Flip the last hex character
    const parts = header.split(',');
    const v1Part = parts.find((p) => p.startsWith('v1='))!;
    const hexVal = v1Part.slice(3);
    const tampered = hexVal.slice(0, -1) + (hexVal.endsWith('a') ? 'b' : 'a');
    const tamperedHeader = header.replace(hexVal, tampered);
    expect(verifyWebhookSignature(RAW_BODY, tamperedHeader, SECRET)).toBe(false);
  });

  it('returns false for a timestamp older than toleranceSec (replay attack)', () => {
    const oldTime = NOW - 301; // 301s ago — beyond 300s default window
    const header = buildSignatureHeader(RAW_BODY, SECRET, oldTime);
    expect(verifyWebhookSignature(RAW_BODY, header, SECRET)).toBe(false);
  });

  it('returns false for a malformed header (missing t=)', () => {
    const badHeader = 'v1=deadbeef1234567890';
    expect(verifyWebhookSignature(RAW_BODY, badHeader, SECRET)).toBe(false);
  });

  it('returns false for a malformed header (missing v1=)', () => {
    const badHeader = `t=${NOW}`;
    expect(verifyWebhookSignature(RAW_BODY, badHeader, SECRET)).toBe(false);
  });

  it('returns false for a completely empty header', () => {
    expect(verifyWebhookSignature(RAW_BODY, '', SECRET)).toBe(false);
  });

  it('returns true for a signature within the tolerance window (just inside)', () => {
    const recentTime = NOW - 299; // 299s ago — inside 300s window
    const header = buildSignatureHeader(RAW_BODY, SECRET, recentTime);
    expect(verifyWebhookSignature(RAW_BODY, header, SECRET)).toBe(true);
  });

  it('respects a custom toleranceSec parameter', () => {
    const oldTime = NOW - 60; // 60s ago
    const header = buildSignatureHeader(RAW_BODY, SECRET, oldTime);
    // With tolerance=30 this is expired; with tolerance=120 it's valid
    expect(verifyWebhookSignature(RAW_BODY, header, SECRET, 30)).toBe(false);
    expect(verifyWebhookSignature(RAW_BODY, header, SECRET, 120)).toBe(true);
  });

  it('uses timing-safe comparison (length mismatch returns false, not throw)', () => {
    // If timingSafeEqual is called on unequal-length Buffers it throws in Node
    // The implementation must length-guard before calling timingSafeEqual
    const header = buildSignatureHeader(RAW_BODY, SECRET, NOW);
    // Truncate the v1 value to create a length mismatch
    const truncated = header.replace(/v1=[^,]+/, 'v1=deadbeef');
    expect(() => verifyWebhookSignature(RAW_BODY, truncated, SECRET)).not.toThrow();
    expect(verifyWebhookSignature(RAW_BODY, truncated, SECRET)).toBe(false);
  });
});
