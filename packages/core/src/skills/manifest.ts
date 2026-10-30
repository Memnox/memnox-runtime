import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import type { SkillManifest, SkillPermissions } from './skill';

/**
 * `skill.toml`, the manifest a skill folder carries: what it is, who published it, the digest of
 * its folder, and what it needs. Read leniently, since a list left out is a list with nothing in it.
 */

interface ManifestToml {
  name: string;
  version: string;
  publisher?: string;
  description: string;
  category?: string;
  digest: string;
  dependencies: string[];
  agents: string[];
  requires: { mcp_servers: string[]; tools: string[] };
  permissions: SkillPermissions;
}

export function manifestToml(manifest: SkillManifest): string {
  const document: ManifestToml = {
    name: manifest.name,
    version: manifest.version,
    ...(manifest.publisher === undefined ? {} : { publisher: manifest.publisher }),
    description: manifest.description,
    ...(manifest.category === undefined ? {} : { category: manifest.category }),
    digest: manifest.digest,
    dependencies: [...manifest.dependencies],
    agents: [...manifest.agents],
    requires: { mcp_servers: [...manifest.mcpServers], tools: [...manifest.tools] },
    permissions: { ...manifest.permissions },
  };
  return stringifyToml(document);
}

/** The manifest, or why it will not read; a field of the wrong type is a problem rather than a guess. */
export function parseManifest(text: string): SkillManifest | { problems: string[] } {
  let raw: Record<string, unknown>;
  try {
    raw = parseToml(text);
  } catch (err) {
    return {
      problems: [
        `skill.toml will not read: ${err instanceof Error ? err.message : String(err)}`,
      ],
    };
  }
  const problems: string[] = [];
  const requires = tableAt(raw, 'requires');
  const permissions = tableAt(raw, 'permissions');
  const manifest: SkillManifest = {
    name: stringAt(raw, 'name', problems),
    version: stringAt(raw, 'version', problems),
    description: stringAt(raw, 'description', problems),
    digest: typeof raw['digest'] === 'string' ? raw['digest'] : '',
    dependencies: listAt(raw, 'dependencies', problems),
    agents: listAt(raw, 'agents', problems),
    mcpServers: listAt(requires, 'mcp_servers', problems),
    tools: listAt(requires, 'tools', problems),
    permissions: {
      filesystem: listAt(permissions, 'filesystem', problems),
      network: listAt(permissions, 'network', problems),
      commands: listAt(permissions, 'commands', problems),
    },
    ...optionalText(raw, 'publisher'),
    ...optionalText(raw, 'category'),
  };
  return problems.length > 0 ? { problems } : manifest;
}

function stringAt(raw: Record<string, unknown>, key: string, problems: string[]): string {
  const value = raw[key];
  if (typeof value === 'string') return value;
  problems.push(`skill.toml needs ${key} as text.`);
  return '';
}

function optionalText(
  raw: Record<string, unknown>,
  key: 'publisher' | 'category',
): Partial<Pick<SkillManifest, 'publisher' | 'category'>> {
  const value = raw[key];
  return typeof value === 'string' && value !== '' ? { [key]: value } : {};
}

function tableAt(raw: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = raw[key];
  // Cast is safe: a plain table is checked for in the same expression.
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function listAt(raw: Record<string, unknown>, key: string, problems: string[]): string[] {
  const value = raw[key];
  if (value === undefined) return [];
  if (Array.isArray(value) && value.every((each) => typeof each === 'string'))
    return [...value];
  problems.push(`skill.toml needs ${key} as a list of text.`);
  return [];
}
