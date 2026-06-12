/**
 * webhook.ts — verifyWebhookSignature helper for DocJet SDK.
 *
 * Inverts the server's buildSignatureHeader (src/delivery/webhook.ts) EXACTLY:
 *   signed payload: `${t}.${rawBody}`
 *   algorithm: HMAC-SHA256
 *   header format: `t=<unixSeconds>,v1=<hexHmac>`
 *   header name on the wire: X-DocJet-Signature
 *
 * Security properties:
 *   - Timing-safe comparison via timingSafeEqual (never plain ===)
 *   - Length-guarded before timingSafeEqual (unequal lengths → false, no throw)
 *   - 300s replay window by default (5-minute tolerance)
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verify a DocJet webhook signature.
 *
 * @param rawBody         - Raw request body string BEFORE JSON.parse
 * @param headerValue     - Value of the X-DocJet-Signature header
 * @param secret          - Per-key webhook signing secret
 * @param toleranceSeconds - Maximum age of the signature in seconds (default: 300)
 * @returns true if the signature is valid and within the tolerance window
 */
export function verifyWebhookSignature(
  rawBody: string,
  headerValue: string,
  secret: string,
  toleranceSeconds = 300,
): boolean {
  // Parse t= and v1= parts from header
  const parts = headerValue.split(',');
  const tPart = parts.find((p) => p.startsWith('t='));
  const v1Part = parts.find((p) => p.startsWith('v1='));
  if (!tPart || !v1Part) return false;

  // Extract timestamp and hex signature
  const t = parseInt(tPart.slice(2), 10);
  const v1 = v1Part.slice(3);

  // Validate timestamp is a real number
  if (!Number.isFinite(t) || t <= 0) return false;

  // Replay protection — reject signatures older than toleranceSeconds
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - t) > toleranceSeconds) return false;

  // Recompute HMAC — must match server's buildSignatureHeader exactly:
  // createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex')
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');

  // Length guard — timingSafeEqual throws on unequal-length Buffers
  if (expected.length !== v1.length) return false;

  // Timing-safe comparison (T-05-10: plain === is forbidden)
  const a = Buffer.from(expected);
  const b = Buffer.from(v1);
  return timingSafeEqual(a, b);
}
