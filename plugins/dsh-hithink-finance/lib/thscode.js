/**
 * thscode normalization.
 *
 * The upstream API takes one canonical form: `<6 digits>.<SH|SZ|BJ>`. Everything
 * else must be resolved first. Three rules matter:
 *
 *   1. A bare 6-digit code is expanded ONLY when its prefix unambiguously
 *      identifies one exchange and one asset class (see STOCK_RANGES).
 *   2. Everything else - ETFs, bonds, 老三板, anything whose exchange we cannot
 *      prove - is refused. The caller must run `hithink_symbol_search` first.
 *   3. A NAME is never guessed. Returning data for the wrong listed company is
 *      strictly worse than an error.
 *
 * Rule 1 and 2 exist because of a real defect found in review: a catch-all
 * `-> SZ` mapped 510300 (a Shanghai ETF) and 110038 (a Shanghai convertible
 * bond) to Shenzhen, i.e. it silently produced a *valid-looking but wrong*
 * symbol. Refusing is cheap; being wrong is not.
 *
 * Exchange ranges are public listing conventions, reimplemented here. No code is
 * copied from @dshtrading/connector-hithink (PolyForm-Noncommercial).
 */

const CANONICAL = /^\d{6}\.(SH|SZ|BJ)$/;
const PREFIXED = /^(SH|SZ|BJ)(\d{6})$/;
const BARE = /^\d{6}$/;

/**
 * Prefix ranges we are willing to expand on our own, most specific first.
 *
 * Deliberately narrow: A-share stocks, their B-share counterparts, and the
 * Beijing Stock Exchange. Funds (15xxxx/5xxxxx), bonds (11xxxx/12xxxx) and the
 * old NEEQ board (400xxx) are NOT here on purpose.
 */
const STOCK_RANGES = [
  { pattern: /^900\d{3}$/, exchange: 'SH' }, // Shanghai B shares
  { pattern: /^6\d{5}$/, exchange: 'SH' }, // Shanghai A shares, incl. 688/689
  { pattern: /^200\d{3}$/, exchange: 'SZ' }, // Shenzhen B shares
  { pattern: /^(000|001|002|003)\d{3}$/, exchange: 'SZ' }, // Shenzhen main board
  { pattern: /^(300|301)\d{3}$/, exchange: 'SZ' }, // ChiNext
  { pattern: /^920\d{3}$/, exchange: 'BJ' }, // BSE new range
  { pattern: /^(43|83|87)\d{4}$/, exchange: 'BJ' }, // BSE legacy ranges
];

/**
 * Infer the exchange for a bare 6-digit ticker.
 *
 * @param {string} code
 * @returns {'SH' | 'SZ' | 'BJ' | null} null means "not provable from the digits"
 */
export function exchangeFor(code) {
  for (const { pattern, exchange } of STOCK_RANGES) {
    if (pattern.test(code)) return exchange;
  }
  return null;
}

/**
 * @param {unknown} input
 * @returns {{ ok: true, thscode: string, changed: boolean }
 *   | { ok: false, reason: 'empty' | 'not_a_code' | 'ambiguous_exchange', input: string }}
 */
export function normalizeThsCode(input) {
  // A non-string is never "empty": reporting it as empty sends the caller
  // looking for a blank field that does not exist.
  if (typeof input !== 'string') {
    return { ok: false, reason: 'not_a_code', input: String(input ?? '') };
  }
  const raw = input.trim();
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
    const exchange = exchangeFor(upper);
    if (exchange === null) return { ok: false, reason: 'ambiguous_exchange', input: raw };
    return { ok: true, thscode: `${upper}.${exchange}`, changed: true };
  }

  // Numbers with a suffix we do not recognize (600519.SS, 00700.HK) and any
  // non-numeric text (a company name) land here on purpose.
  return { ok: false, reason: 'not_a_code', input: raw };
}

/**
 * Normalize a list, dropping blanks, de-duplicating, preserving input order.
 *
 * @param {unknown[]} inputs
 * @returns {{ thscodes: string[], rejected: { input: string, reason: string }[] }}
 */
export function normalizeThsCodeList(inputs) {
  const thscodes = [];
  const rejected = [];
  const seen = new Set();

  for (const input of Array.isArray(inputs) ? inputs : []) {
    const result = normalizeThsCode(input);
    const text = typeof input === 'string' ? input.trim() : String(input ?? '');
    if (!result.ok) {
      // A blank string is dropped silently; anything else is reported, because
      // the caller has to decide whether to search for it.
      if (text !== '') rejected.push({ input: text, reason: result.reason });
      continue;
    }
    if (seen.has(result.thscode)) continue;
    seen.add(result.thscode);
    thscodes.push(result.thscode);
  }
  return { thscodes, rejected };
}
