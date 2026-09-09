const MAX_DECODE_PASSES = 5
const PERCENT_SEQUENCE_RE = /%[0-9a-fA-F]{2}/

/**
 * Repeatedly percent-decodes `input` until it stops changing.
 *
 * Route params arrive still-encoded, and clients/crawlers sometimes encode a
 * URL more than once (`%E4%BD%A0` becoming `%25E4%25BD%25A0`). Decoding once
 * leaves such inputs in a half-decoded state, which historically let encoded
 * strings leak into page titles and canonicals. Decoding to a fixed point
 * (capped to guard against pathological input) keeps every consumer agreeing
 * on what the identifier actually is.
 */
export function fullyDecodeURIComponent(input: string): string {
  let current = String(input ?? '')
  for (let pass = 0; pass < MAX_DECODE_PASSES; pass++) {
    if (!PERCENT_SEQUENCE_RE.test(current)) break
    let decoded: string
    try {
      decoded = decodeURIComponent(current)
    } catch {
      break
    }
    if (decoded === current) break
    current = decoded
  }
  return current
}
