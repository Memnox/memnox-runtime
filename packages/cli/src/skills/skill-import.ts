import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import {
  declaredList,
  DEFINITION_KIND,
  discoverDefinitions,
  filesUnder,
  NodeMachineReader,
  parseFrontmatter,
  type CanonicalSkill,
  type DiscoveredSkill,
} from '@memnox/core';

/**
 * A skill or persona found in an agent's own folder, read into the hub's one shape: its
 * instructions without their header, every file beside them, and what its header said it is.
 */

/** The version an imported skill starts at, since an agent's folder keeps none. */
const FIRST_VERSION = '1.0.0';

/** The files a skill folder names its instructions by, as discovery reads them. */
const INSTRUCTION_FILES: readonly string[] = ['SKILL.md', 'skill.md', 'index.md'];

const MARKDOWN = '.md';

/** Discovery's agent names where the hub keys an agent by its kind. */
const KIND_OF: Readonly<Record<string, string>> = {
  codex: 'codex-cli',
  copilot: 'copilot-cli',
};

/** Every skill and persona in the agents' folders at home, and in a repository when one is named. */
export async function foundDefinitions(
  home: string,
  project?: string,
): Promise<DiscoveredSkill[]> {
  const roots = project === undefined || project === home ? [home] : [home, project];
  return discoverDefinitions(new NodeMachineReader(home), roots);
}

/** A found folder names its agent by the folder, which a few agents spell differently from their kind. */
export function agentKindOf(agent: string): string {
  return KIND_OF[agent] ?? agent;
}

/** The definition as a canonical skill, or why it cannot be one. */
export async function canonicalOf(
  found: DiscoveredSkill,
  name: string,
  version: string = FIRST_VERSION,
): Promise<CanonicalSkill | { refused: string }> {
  const read =
    found.kind === DEFINITION_KIND.SKILL ? await folderOf(found) : await personaOf(found);
  if ('refused' in read) return read;
  const matter = parseFrontmatter(read.text);
  const tools =
    found.grant.tools.length > 0
      ? found.grant.tools
      : (declaredList(matter, 'allowed-tools') ?? []);
  return {
    manifest: {
      name,
      version,
      description: matter.fields.get('description') ?? `Imported from ${found.agent}`,
      digest: '',
      dependencies: [],
      mcpServers: [],
      tools,
      permissions: { filesystem: [], network: [], commands: [...found.reaches] },
      agents: [agentKindOf(found.agent)],
    },
    instructions: `${matter.body.trim()}\n`,
    files: read.files,
  };
}

type Read = { text: string; files: CanonicalSkill['files'] } | { refused: string };

/** A skill folder: its instructions file, and every other file kept beside it. */
async function folderOf(found: DiscoveredSkill): Promise<Read> {
  const listed = await filesUnder(found.path);
  if ('problems' in listed) return { refused: listed.problems.join(' ') };
  const instructions = listed.files.find((file) => INSTRUCTION_FILES.includes(file.path));
  if (instructions === undefined)
    return { refused: `${found.path} has no instructions file.` };
  return {
    text: Buffer.from(instructions.bytes).toString('utf8'),
    files: listed.files.filter((file) => file !== instructions),
  };
}

/** A persona is one Markdown file, which becomes the instructions whole. */
async function personaOf(found: DiscoveredSkill): Promise<Read> {
  if (!found.path.endsWith(MARKDOWN))
    return {
      refused: `${basename(found.path)} is not a Markdown definition Memnox can import.`,
    };
  return { text: await readFile(found.path, 'utf8'), files: [] };
}
