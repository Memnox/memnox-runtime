import {
  DISCOVERED_AGENT_KIND,
  type DiscoveredAgentKind,
} from '../discovery/discovery.constants';
import type { ProfileDraft } from '../daemon/profiles';

/**
 * Job descriptions with no agent behind them. A template carries no activity, no session and no
 * standing; using one copies its job into a new profile, and every suggestion stays off until taken.
 */

export interface ProfileTemplate {
  id: string;
  name: string;
  purpose: string;
  /** Matched by `roles:` once a profile copied from it is bound; a role grants nothing by itself. */
  role: string;
  responsibilities: string[];
  /** Skills a person may add, by name only, never installed by the template. */
  suggestedSkills: string[];
  /** Rules in plain words, shown for a person to write as rules; none is ever applied by a template. */
  suggestedRules: string[];
  /** Only agents `memnox scan` can find, so a template never names a connection nobody can make. */
  suggestedConnections: DiscoveredAgentKind[];
}

const CODING_AGENTS: DiscoveredAgentKind[] = [
  DISCOVERED_AGENT_KIND.CLAUDE_CODE,
  DISCOVERED_AGENT_KIND.CODEX_CLI,
  DISCOVERED_AGENT_KIND.CURSOR,
  DISCOVERED_AGENT_KIND.GEMINI_CLI,
];

const DESKTOP_AGENTS: DiscoveredAgentKind[] = [
  DISCOVERED_AGENT_KIND.CLAUDE_DESKTOP,
  DISCOVERED_AGENT_KIND.HERMES,
  DISCOVERED_AGENT_KIND.OPENCLAW,
];

export const PROFILE_TEMPLATES: readonly ProfileTemplate[] = [
  {
    id: 'software-development',
    name: 'Software Development',
    purpose: 'Builds and changes code in the repositories it is given.',
    role: 'developer',
    responsibilities: [
      'make the change the task asks for',
      'run the tests before handing back',
      'keep to the code fingerprint',
    ],
    suggestedSkills: ['review', 'testing'],
    suggestedRules: [
      'Ask before pushing to main.',
      'Ask before deleting files outside the repository.',
      'Never read secret files.',
    ],
    suggestedConnections: CODING_AGENTS,
  },
  {
    id: 'code-review',
    name: 'Code Review',
    purpose: 'Reads a change before it is merged and says what is risky.',
    role: 'reviewer',
    responsibilities: ['read the diff', 'name what is risky', 'suggest a smaller change'],
    suggestedSkills: ['review'],
    suggestedRules: ['Never push.', 'Never change files; only read them.'],
    suggestedConnections: CODING_AGENTS,
  },
  {
    id: 'testing',
    name: 'Testing',
    purpose: 'Writes and runs tests, and says plainly what failed.',
    role: 'tester',
    responsibilities: ['write the missing tests', 'run the suite', 'report each failure'],
    suggestedSkills: ['testing'],
    suggestedRules: ['Ask before changing code outside the test folders.', 'Never push.'],
    suggestedConnections: CODING_AGENTS,
  },
  {
    id: 'documentation',
    name: 'Documentation',
    purpose: 'Keeps the documentation true to what the code does.',
    role: 'writer',
    responsibilities: ['update docs a change made stale', 'write examples that run'],
    suggestedSkills: ['docs'],
    suggestedRules: ['Ask before changing anything outside the docs.'],
    suggestedConnections: CODING_AGENTS,
  },
  {
    id: 'research',
    name: 'Research',
    purpose: 'Finds and compares what is known about a question, with sources.',
    role: 'researcher',
    responsibilities: ['gather sources', 'compare them fairly', 'cite every claim'],
    suggestedSkills: ['research'],
    suggestedRules: ['Ask before sending anything outside this machine.'],
    suggestedConnections: [...DESKTOP_AGENTS, DISCOVERED_AGENT_KIND.CLAUDE_CODE],
  },
  {
    id: 'customer-support',
    name: 'Customer Support',
    purpose: 'Drafts answers to customers for a person to send.',
    role: 'support',
    responsibilities: [
      'draft the reply',
      'link the case it answers',
      'flag an angry customer',
    ],
    suggestedSkills: ['support-replies'],
    suggestedRules: ['Ask before sending an email.', 'Never read payment details.'],
    suggestedConnections: DESKTOP_AGENTS,
  },
  {
    id: 'operations-assistant',
    name: 'Operations Assistant',
    purpose: 'Watches the routine operational work and asks before changing anything.',
    role: 'operations',
    responsibilities: [
      'check what ran overnight',
      'say what needs a person',
      'keep notes',
    ],
    suggestedSkills: ['runbooks'],
    suggestedRules: ['Ask before any deploy.', 'Ask before restarting a service.'],
    suggestedConnections: [...DESKTOP_AGENTS, DISCOVERED_AGENT_KIND.CODEX_CLI],
  },
];

export function templateNamed(named: string): ProfileTemplate | undefined {
  const wanted = named.trim().toLowerCase();
  return PROFILE_TEMPLATES.find(
    (each) => each.id === wanted || each.name.toLowerCase() === wanted,
  );
}

/** What a template copies into a new profile: its job, and only the skills a person took. */
export function draftFromTemplate(
  template: ProfileTemplate,
  chosen: { name?: string; skills?: readonly string[] },
): ProfileDraft {
  const skills = (chosen.skills ?? []).filter((each) =>
    template.suggestedSkills.includes(each),
  );
  return {
    name:
      chosen.name === undefined || chosen.name.trim() === ''
        ? template.name
        : chosen.name,
    purpose: template.purpose,
    role: template.role,
    responsibilities: [...template.responsibilities],
    skills,
    templateOf: template.id,
  };
}
