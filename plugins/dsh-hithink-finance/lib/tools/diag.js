/**
 * `hithink_doctor` -- the only tool that works without an API key.
 *
 * Its job is to answer "why are the hithink tools missing / failing?" from
 * inside the session, and to be the load evidence: a plugin that registers no
 * route and no tool is indistinguishable from a plugin that never loaded.
 *
 * It never performs a network call in this milestone (M0). The bounded probe
 * arrives with lib/http.js in M1.
 */

import { credentialFileCandidates } from '../credentials.js';
import { enabledDomains } from '../config.js';

const NO_PROBE_NOTE =
  'No network probe yet (milestone M0). Live verification arrives with the HTTP layer in M1.';

/**
 * @param {{
 *   settings: import('../config.js').HithinkConfig,
 *   creds: { key: string | null, source: string, notes: string[] },
 *   registered: string[],
 *   planned: string[],
 *   version: string,
 *   dshHome: string,
 * }} deps
 */
export function buildReport(deps) {
  const { settings, creds, registered, planned, version, dshHome } = deps;
  return {
    ok: true,
    plugin: {
      name: 'dsh-hithink-finance',
      version,
      enabled: settings.enabled,
      baseUrl: settings.baseUrl,
    },
    auth: {
      configured: creds.key !== null,
      source: creds.source,
      // Never the key itself, not even its length -- length narrows a guess.
      credentialFiles: credentialFileCandidates({ dshHome }),
      notes: creds.notes,
    },
    tools: {
      registered,
      plannedButNotRegistered: planned,
      count: registered.length,
    },
    domains: {
      enabled: enabledDomains(settings),
      all: settings.domains,
    },
    limits: {
      timeoutMs: settings.timeoutMs,
      maxRetries: settings.maxRetries,
      spillRows: settings.spillRows,
      spillBytes: settings.spillBytes,
    },
    probe: null,
    note: NO_PROBE_NOTE,
  };
}

export const diagTool = {
  id: 'hithink_doctor',
  domain: 'diag',
  description:
    'Diagnose the dsh-hithink-finance plugin: whether an API key was found and from where, ' +
    'which domains/tools are registered, and the effective limits. Use this when a hithink_* ' +
    'tool is missing or returns AUTH_MISSING.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  execute: (deps) => buildReport(deps),
};
