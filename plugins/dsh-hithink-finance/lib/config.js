/**
 * Configuration for dsh-hithink-finance.
 *
 * Plain JavaScript on purpose: a third-party DSH plugin cannot import
 * `@deepseek-ai/*` (everything official lives inside app.asar), and pulling in
 * zod would add a dependency that has to agree with the profile's own copy.
 * Everything here is hand-validated.
 */

/** @typedef {typeof DEFAULTS} HithinkConfig */

export const DEFAULTS = {
  /** Master switch. When false the plugin registers nothing at all. */
  enabled: true,
  /** Explicit API key. Highest priority, but prefer the env var / credential file. */
  apiKey: '',
  /** Environment variable read for the API key. */
  apiKeyEnv: 'HITHINK_FINANCE_API_KEY',
  /** Fuyao API root. No trailing slash. */
  baseUrl: 'https://fuyao.aicubes.cn',
  /** Per-domain tool switches. A disabled domain registers no tools. */
  domains: {
    core: true,
    special: true,
    index: false,
    fund: false,
    futures: false,
    calendar: false,
  },
  /** Rows above this are spilled to a file instead of being returned inline. */
  spillRows: 200,
  /** Serialized bytes above this are spilled to a file. */
  spillBytes: 65536,
  /** Single-request timeout in milliseconds. */
  timeoutMs: 15000,
  /** Retries after the first attempt. Kept low so a turn cannot be stalled. */
  maxRetries: 2,
};

export const DOMAIN_KEYS = ['core', 'special', 'index', 'fund', 'futures', 'calendar'];

const INTEGER_BOUNDS = {
  spillRows: [1, 100000],
  spillBytes: [1024, 64 * 1024 * 1024],
  timeoutMs: [1000, 120000],
  maxRetries: [0, 5],
};

function asBoolean(value, fallback) {
  if (typeof value === 'boolean') return value;
  // YAML users write `enabled: 0` / `fund: 1` as often as `false`/`true`; a
  // config that silently does the opposite of what was written is worse than
  // rejecting it.
  if (typeof value === 'number') {
    if (value === 0) return false;
    if (value === 1) return true;
    return fallback;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
  }
  return fallback;
}

function asInteger(value, fallback, [minimum, maximum]) {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)));
}

function asText(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed === '' ? fallback : trimmed;
}

/** Hosts allowed to use plain http: a loopback address, e.g. a local proxy. */
const LOOPBACK_HOST = /^(127(\.\d{1,3}){3}|localhost|\[::1\])$/i;

/**
 * A usable API root is an absolute URL whose origin is the whole endpoint.
 *
 * Rejected on purpose: a path, query, hash or userinfo (they would be spliced
 * into every request path), and plain http on a non-loopback host -- the API key
 * travels in a header, and a cleartext hop would expose it. Anything rejected
 * falls back to the default instead of producing a request that cannot work.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeBaseUrl(value) {
  const text = asText(value, DEFAULTS.baseUrl).replace(/\/+$/, '');
  try {
    const url = new URL(text);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return DEFAULTS.baseUrl;
    if (url.hostname === '') return DEFAULTS.baseUrl;
    if (url.username !== '' || url.password !== '') return DEFAULTS.baseUrl;
    if (url.search !== '' || url.hash !== '') return DEFAULTS.baseUrl;
    if (url.pathname !== '' && url.pathname !== '/') return DEFAULTS.baseUrl;
    if (url.protocol === 'http:' && !LOOPBACK_HOST.test(url.hostname)) return DEFAULTS.baseUrl;
    return text;
  } catch {
    return DEFAULTS.baseUrl;
  }
}

/**
 * Merge user config over the defaults. Never throws: a malformed field falls
 * back to its default so a bad patch row cannot break the boot.
 *
 * @param {Record<string, unknown> | undefined} raw
 * @returns {HithinkConfig}
 */
export function normalizeConfig(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {};
  const domains = {};
  const rawDomains =
    source.domains !== null && typeof source.domains === 'object' ? source.domains : {};
  for (const key of DOMAIN_KEYS) {
    domains[key] = asBoolean(rawDomains[key], DEFAULTS.domains[key]);
  }

  const config = {
    enabled: asBoolean(source.enabled, DEFAULTS.enabled),
    apiKey: typeof source.apiKey === 'string' ? source.apiKey.trim() : DEFAULTS.apiKey,
    apiKeyEnv: asText(source.apiKeyEnv, DEFAULTS.apiKeyEnv),
    baseUrl: normalizeBaseUrl(source.baseUrl),
    domains,
    spillRows: DEFAULTS.spillRows,
    spillBytes: DEFAULTS.spillBytes,
    timeoutMs: DEFAULTS.timeoutMs,
    maxRetries: DEFAULTS.maxRetries,
  };

  for (const [key, bounds] of Object.entries(INTEGER_BOUNDS)) {
    config[key] = asInteger(source[key], DEFAULTS[key], bounds);
  }
  return config;
}

/** @param {HithinkConfig} config */
export function enabledDomains(config) {
  return DOMAIN_KEYS.filter((key) => config.domains[key] === true);
}
