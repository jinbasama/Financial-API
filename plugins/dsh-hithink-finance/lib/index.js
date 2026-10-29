/**
 * dsh-hithink-finance -- host half.
 *
 * What this plugin is
 * -------------------
 * A curated client for 同花顺金融数据服务 (Fuyao, https://fuyao.aicubes.cn) that
 * registers a handful of `hithink_*` tools instead of the 72 upstream MCP tools.
 * The REST contract is documented in this fork under `docs/api/`; every tool
 * here maps to exactly one documented endpoint.
 *
 * Disciplines
 * -----------
 *   1. `apply()` never throws. A synchronous throw fails the loader entry and
 *      the boot audit reports "Failed to load plugins", taking the whole UI with
 *      it.
 *   2. Only inject services that every profile provides (`tools`).
 *   3. Zero runtime dependencies: only `node:*` builtins, because third-party
 *      plugins cannot import `@deepseek-ai/*` (it lives inside app.asar).
 *   4. No log noise. A healthy plugin logs nothing; a misconfigured one logs
 *      once, together with what to do about it.
 *
 * Milestone: M0 -- skeleton + credentials + thscode + `hithink_doctor`. The HTTP
 * layer and the data tools land in M1.
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DOMAIN_KEYS, enabledDomains, normalizeConfig } from './config.js';
import { resolveApiKey } from './credentials.js';
import { diagTool } from './tools/diag.js';
import { objectOutput } from './tools/render.js';

const PACKAGE_ID = 'dsh-hithink-finance';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));

/**
 * Tools each domain contributes. Only `diag` is implemented in M0; the lists for
 * the other domains are the declared plan, surfaced by `hithink_doctor` as
 * `plannedButNotRegistered` so a half-wired install is visible instead of silent.
 */
const PLANNED_BY_DOMAIN = {
  core: [
    'hithink_symbol_search',
    'hithink_quote',
    'hithink_history',
    'hithink_financials',
    'hithink_valuation',
  ],
  special: ['hithink_special'],
  index: ['hithink_index'],
  fund: ['hithink_fund'],
  futures: ['hithink_futures'],
  calendar: ['hithink_calendar'],
};

/** A logger that cannot throw. */
function makeLogger(ctx) {
  let sink = null;
  try {
    const candidate = ctx?.logger;
    sink = typeof candidate === 'function' ? (candidate(PACKAGE_ID) ?? null) : (candidate ?? null);
  } catch {
    sink = null;
  }
  return (message) => {
    try {
      if (sink !== null && typeof sink.warn === 'function') sink.warn(`[${PACKAGE_ID}] ${message}`);
      else if (sink !== null && typeof sink.info === 'function') sink.info(`[${PACKAGE_ID}] ${message}`);
      else console.warn(`[${PACKAGE_ID}] ${message}`);
    } catch {
      /* logging must never break the boot */
    }
  };
}

function resolveDshHome(env = process.env) {
  const fromEnvironment = String(env.DSH_HOME ?? '').trim();
  return fromEnvironment === '' ? join(homedir(), '.dsh') : fromEnvironment;
}

function readVersion() {
  try {
    const parsed = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
    return typeof parsed.version === 'string' ? parsed.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Implemented, domain-gated tools. Empty in M0; filled in M1+.
 */
const IMPLEMENTED_TOOLS = [];

/**
 * Which tools this configuration should register.
 *
 * `hithink_doctor` is unconditional: it is the only way to tell "plugin loaded
 * but misconfigured" apart from "plugin never loaded". Every other tool needs
 * its domain switched on explicitly, so a disabled domain costs zero tokens.
 *
 * @param {import('./config.js').HithinkConfig} settings
 */
export function selectTools(settings) {
  if (settings?.enabled === false) return [];
  const tools = [diagTool];
  for (const tool of IMPLEMENTED_TOOLS) {
    if (DOMAIN_KEYS.includes(tool.domain) && settings.domains[tool.domain] === true) {
      tools.push(tool);
    }
  }
  return tools;
}

function registerTools(ctx, warn, state) {
  if (typeof ctx?.inject !== 'function') {
    warn('host context has no inject(); the hithink tools were not registered');
    return;
  }

  try {
    ctx.inject(['tools'], (scoped) => {
      let service = null;
      try {
        service = scoped?.tools ?? null;
      } catch {
        service = null;
      }
      if (service === null || typeof service.register !== 'function') {
        warn('the tools service is unavailable; the hithink tools were not registered');
        return;
      }

      const seen = new Set();
      for (const tool of selectTools(state.settings)) {
        if (seen.has(tool.id)) continue;
        seen.add(tool.id);
        try {
          const dispose = service.register({
            name: tool.id,
            description: tool.description,
            parameters: tool.parameters,
            output: objectOutput(),
            execute: (args) => {
              try {
                return tool.execute({
                  settings: state.settings,
                  creds: state.creds,
                  registered: state.registered,
                  planned: state.planned,
                  version: state.version,
                  dshHome: state.dshHome,
                }, args ?? {});
              } catch (error) {
                // A tool must never surface as an opaque harness fault.
                return {
                  ok: false,
                  error: {
                    category: 'INTERNAL',
                    message: String(error?.message ?? error),
                    retryable: false,
                  },
                };
              }
            },
          });
          state.registered.push(tool.id);
          try {
            if (typeof dispose === 'function' && typeof scoped.on === 'function') {
              scoped.on('dispose', dispose);
            }
          } catch {
            /* disposal is best-effort */
          }
        } catch (error) {
          warn(`could not register ${tool.id}: ${String(error?.message ?? error)}`);
        }
      }
    });
  } catch (error) {
    warn(`could not inject the tools service: ${String(error?.message ?? error)}`);
  }
}

/**
 * Plugin entry point. Never throws.
 *
 * @param {unknown} ctx - host cordis context.
 * @param {Record<string, unknown>} [config] - this row's `config:` block.
 */
export function apply(ctx, config) {
  try {
    const warn = makeLogger(ctx);
    const settings = normalizeConfig(config);

    // Master switch off: registering nothing is the whole point.
    if (!settings.enabled) return;

    if (!existsSync(join(packageRoot, 'cordis.patch.yml'))) {
      warn('cordis.patch.yml is missing from the package root; reinstall the plugin');
    }

    const dshHome = resolveDshHome();
    const creds = resolveApiKey({ config: settings, dshHome });
    const planned = enabledDomains(settings).flatMap((domain) => PLANNED_BY_DOMAIN[domain] ?? []);

    const state = {
      settings,
      creds,
      registered: [],
      planned,
      version: readVersion(),
      dshHome,
    };

    registerTools(ctx, warn, state);

    // Boot audit: warn exactly once, and only when the data tools cannot work.
    if (creds.key === null) {
      warn(
        'no API key resolved, so every data tool will answer AUTH_MISSING. ' +
          'Run hithink_doctor for where we looked, or set HITHINK_FINANCE_API_KEY.',
      );
    }
  } catch {
    /* apply() must not throw, whatever happens */
  }
}

export default { name: PACKAGE_ID, apply };
