import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The plugins Memnox writes into agents that only run hooks in their own process, kept as
 * the files they become so they read and lint as what they are. Only the hook command and
 * the names Memnox owns are filled in at install.
 */

/** Beside this module in a checkout, and beside the bundle once built, where tsup copies it. */
const AGENT_PLUGIN_DIR = 'agent-plugins';

export const AGENT_PLUGIN = {
  OPENCLAW: 'openclaw.mjs',
  OPENCODE: 'opencode.js',
  HERMES: 'hermes.py',
} as const;

type AgentPlugin = (typeof AGENT_PLUGIN)[keyof typeof AGENT_PLUGIN];

const PLACEHOLDER = /__MEMNOX_([A-Z_]+)__/g;

/** The plugin with each `__MEMNOX_<NAME>__` replaced by its value, already in the plugin's syntax. */
export function filledPlugin(
  name: AgentPlugin,
  values: Readonly<Record<string, string>>,
): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const template = readFileSync(join(here, AGENT_PLUGIN_DIR, name), 'utf8');
  return template.replace(PLACEHOLDER, (found, key: string) => {
    const value = values[key];
    // A placeholder left in would be a plugin that fails at its first call, so it is a fault here.
    if (value === undefined)
      throw new Error(`The ${name} plugin needs a value for ${found}.`);
    return value;
  });
}
