/**
 * thscode normalization.
 *
 * The upstream API takes one canonical form: `<6 digits>.<SH|SZ|BJ>`. Everything
 * else must be resolved first. Two rules matter:
 *
 *   1. A bare 6-digit code is expanded by exchange prefix rules (see below).
 *   2. A NAME is never guessed. Returning data for the wrong listed company is
 *      strictly worse than an error, so callers must resolve names through
 *      `hithink_symbol_search` first.
 *
 * The prefix rules follow the shapes used by the upstream CLI and by
 * @dshtrading/connector-hithink (that package is PolyForm-Noncommercial, so its
 * code is NOT copied -- only the well-known exchange ranges are reimplemented).
 */

const CANONICAL = /^\d{6}\.(SH|SZ|BJ)$/;
const PREFIXED = /^(SH|SZ|BJ)(\d{6})$/;
const BARE = /^\d{6}$/;

/**
 * Infer the exchange suffix for a bare 6-digit ticker.
 *
 * - 900xxx  -> SH (B shares)
 * - 6xxxxx  -> SH
 * - 920xxx, 8xxxxx, 4xxxxx -> BJ (Beijing Stock Exchange)
 * - 0xxxxx, 3xxxxx, and everything else numeric -> SZ
 *
 * @param {string} code
 * @returns {'SH' | 'SZ' | 'BJ'}
 */
export function exchangeFor(code) {
  if (code.startsWith('900') || code.startsWith('6')) return 'SH';
  if (code.startsWith('920') || code.startsWith('8') || code.startsWith('4')) return 'BJ';
  return 'SZ';
}

/**
 * @param {unknown} input
 * @returns {{ ok: true, thscode: string, changed: boolean }
 *   | { ok: false, reason: 'empty' | 'not_a_code', input: string }}
 */
export function normalizeThsCode(input) {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (raw === '') return { ok: false, reason: 'empty', input: raw };

  const upper = raw.toUpperCase();

  if (CANONICAL.test(upper)) return { ok: true, thscode: upper, changed: upper !== raw };

  const prefixed = PREFIXED.exec(upper);
  if (prefixed !== null) {
    const [, exchange, digits] = prefixed;
    const thscode = `${digits}.${exchange}`;
    return { ok: true, thscode, changed: true };
  }

  if (BARE.test(upper)) {
    return { ok: true, thscode: `${upper}.${exchangeFor(upper)}`, changed: true };
  }

  // Numbers with a suffix we do not recognize (e.g. 600519.SS, 000001.HK), and
  // any non-ASCII text (a company name) land here on purpose.
  return { ok: false, reason: 'not_a_code', input: raw };
}

/**
 * Normalize a list, dropping blanks, de-duplicating, preserving input order.
 *
 * @param {unknown[]} inputs
 * @returns {{ thscodes: string[], rejected: string[] }}
 */
export function normalizeThsCodeList(inputs) {
  const thscodes = [];
  const rejected = [];
  const seen = new Set();

  for (const input of Array.isArray(inputs) ? inputs : []) {
    const result = normalizeThsCode(input);
    if (!result.ok) {
      const text = typeof input === 'string' ? input.trim() : String(input ?? '');
      if (text !== '') rejected.push(text);
      continue;
    }
    if (seen.has(result.thscode)) continue;
    seen.add(result.thscode);
    thscodes.push(result.thscode);
  }
  return { thscodes, rejected };
}
