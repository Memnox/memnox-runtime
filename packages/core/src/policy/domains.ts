import { DECISION_EFFECT, type DecisionEffect } from '../constants/decision.constants';
import type { Policy } from './policy';
import { TOOL_CLASS } from '../discovery/classify';
import { LOCAL_NAMESPACES } from '../constants/action-class.constants';
import { CAPABILITY } from '../domain/capability';
import { DATA_CLASSIFICATION } from '../domain/sensitive-data';
import { DATABASE_ACTION_PREFIX, STATEMENT_ARGUMENT } from '../intercept/database-call';
import {
  ACTION,
  CHANGING_HTTP_METHODS,
  EVERY_VARIABLE,
  HTTP_METHOD_ARGUMENT,
} from '../constants/action.constants';

/**
 * The things somebody decides about when writing rules for the first time, walked
 * as questions that produce a file they can read afterwards.
 */
export const POLICY_DOMAIN = {
  FILESYSTEM: 'filesystem',
  SHELL: 'shell',
  GIT: 'git',
  MCP: 'mcp',
  NETWORK: 'network',
  CLI: 'cli',
  /** Statements that take every row or change a schema, on any database client. */
  DATABASE: 'database',
  /** Any change to a database on another host. */
  REMOTE_DATABASE: 'remote-database',
  /** Moving money, deploying and handing out authority, wherever the tool is. */
  CONSEQUENTIAL: 'consequential',
  /** Any change in an environment named like production. */
  PRODUCTION: 'production',
  /** Sensitive data leaving for any destination, which a person narrows to the approved ones. */
  SENSITIVE_DATA: 'sensitive-data',
} as const;

export type PolicyDomain = (typeof POLICY_DOMAIN)[keyof typeof POLICY_DOMAIN];

export interface DomainChoice {
  domain: PolicyDomain;
  /** The question, in the words somebody would use about their own machine. */
  question: string;
  /** What most people should pick, and why it is not stricter. */
  recommended: DecisionEffect;
  because: string;
  actions: string[];
  targets?: string[];
  /** Narrows the rule to some calls of an action, as a request's method does. */
  arguments?: Record<string, string[]>;
  /** Narrows the rule to what the action does, so reads under the same name go through. */
  classes?: string[];
  /** Narrows it finer: a transfer, a deploy, an authority change. */
  capabilities?: string[];
  /** Narrows it to the environments named, as the command or the call names them. */
  environments?: string[];
  /** Narrows it to what the payload carries, as the sensitive data classifier names it. */
  dataClassifications?: string[];
}

/** What changes something, as every classifier spells it. Reads are left out on purpose. */
const CHANGING_CLASSES: readonly string[] = [
  TOOL_CLASS.WRITE,
  TOOL_CLASS.DESTRUCTIVE,
  TOOL_CLASS.COMMUNICATION,
];

/**
 * CLIs whose writes land on somebody else's system. `npm`, `docker` and `playwright` are
 * not here whole, because their writes are mostly an install, a build or a test run.
 */
const REMOTE_CLIS: readonly string[] = [
  'aws',
  'gcloud',
  'az',
  'gh',
  'kubectl',
  'terraform',
  'vercel',
  'railway',
  'fly',
  'heroku',
  'netlify',
  'stripe',
];

/** Every client a statement is read off, so a rule about databases is one rule whichever ran it. */
const DATABASE_CLIENTS: readonly string[] = [
  'psql',
  'pgcli',
  'mysql',
  'mariadb',
  'mycli',
  'mongosh',
  'sqlite3',
  // A statement an MCP database tool was handed, ruled as if a client on PATH had run it.
  DATABASE_ACTION_PREFIX,
];

/**
 * The row writes a statement names, which carry a WHERE or a filter whenever they are not
 * `-unbounded`. Schema changes, grants and a session nothing could read stay with the rule.
 */
const ROW_WRITES: readonly string[] = [
  'insert',
  'update',
  'delete',
  'merge',
  'insertone',
  'insertmany',
  'updateone',
  'updatemany',
  'deleteone',
  'deletemany',
  'replaceone',
];

/** Every database action except a bounded row write, which is ordinary work on a local database. */
const DATABASE_CHANGES: string[] = DATABASE_CLIENTS.flatMap((client) => [
  `${client}.*`,
  ...ROW_WRITES.map((write) => `!${client}.${write}`),
]);

/** The verbs of the mostly local CLIs that publish something outward. */
const OUTWARD_VERBS: readonly string[] = ['docker.push', 'npm.publish', 'npm.unpublish'];

/** Everything that reaches outside this machine: every action but the local ones. */
const OUTSIDE_THIS_MACHINE: string[] = [
  '*',
  ...[...LOCAL_NAMESPACES, 'package'].map((each) => `!${each}.*`),
];

/** Where credentials sit on disk, as rule targets: what the first question denies an agent, and a phone never lists. */
export const CREDENTIAL_PATHS: readonly string[] = [
  // The directory too, or asking about `~/.aws` itself answers "no rule matched".
  '**/.ssh',
  '**/.ssh/**',
  '**/.aws',
  '**/.aws/**',
  '**/.gcloud',
  '**/.gcloud/**',
  '**/.kube',
  '**/.kube/**',
  '**/.env',
  '**/.env.*',
  // A template holds names and no values, and reading it is how an agent learns the shape.
  '!**/.env.example',
  '!**/.env.sample',
  '!**/.env.template',
];

export const DOMAIN_CHOICES: readonly DomainChoice[] = [
  {
    domain: POLICY_DOMAIN.FILESYSTEM,
    question: 'Reading your credentials: ~/.ssh, ~/.aws, .env files',
    recommended: DECISION_EFFECT.DENY,
    because:
      'almost no task needs the key itself, and a leaked one is somebody’s weekend',
    actions: [ACTION.FILESYSTEM_READ, ACTION.ENVIRONMENT_READ],
    targets: [
      ...CREDENTIAL_PATHS,
      // A variable printed is the same key read another way: `printenv`, `echo $STRIPE_KEY`.
      EVERY_VARIABLE,
      '*_KEY',
      '*_KEYS',
      '*_SECRET',
      '*_TOKEN',
      '*_PASSWORD',
      '*_CREDENTIALS',
      'DATABASE_URL',
      'MONGODB_URI',
      'REDIS_URL',
    ],
  },
  {
    domain: POLICY_DOMAIN.SHELL,
    question: 'Destructive shell commands: rm -rf, dd, truncate',
    recommended: DECISION_EFFECT.ASK,
    because: 'sometimes it really is the build directory, so a person should look',
    actions: [ACTION.FILESYSTEM_DELETE],
  },
  {
    domain: POLICY_DOMAIN.GIT,
    question: 'Force-pushing, and hard resets',
    recommended: DECISION_EFFECT.DENY,
    because: 'it rewrites history somebody else may already have pulled',
    // The names the verb table produces, so an ordinary push stays allowed; `git.reset`
    // and `git.clean` are the generic classifier's spelling of the same commands.
    actions: [
      'git.push-force',
      'git.push-f',
      'git.reset-hard',
      'git.branch-d',
      'git.clean-fd',
      'git.clean-f',
      'git.clean-force',
      'git.branch-delete-force',
      'git.push-delete',
      'git.reflog-expire',
      'git.reflog-delete',
      'git.stash-clear',
      'git.stash-drop',
      'git.filter-branch',
      'git.filter-repo',
      'git.gc-prune-now',
      'git.reset',
      'git.clean',
    ],
  },
  {
    domain: POLICY_DOMAIN.MCP,
    question: 'MCP tools that change something outside this machine',
    recommended: DECISION_EFFECT.ASK,
    because:
      'these are the calls whose consequences other people see, while a tool that only lists or reads is how an agent finds its way',
    actions: ['mcp.*'],
    // Unknown too: a tool nothing could classify might change anything.
    classes: [...CHANGING_CLASSES, TOOL_CLASS.UNKNOWN],
    // A bounded row write on a local database is the database question's, which lets it pass.
    arguments: { [STATEMENT_ARGUMENT]: ['*', ...ROW_WRITES.map((write) => `!${write}`)] },
  },
  {
    domain: POLICY_DOMAIN.NETWORK,
    question: 'Requests that change something on a host no rule names',
    recommended: DECISION_EFFECT.ASK,
    because:
      'a POST, PUT, PATCH or DELETE changes somebody else’s state, while reading documentation or fetching a resource is ordinary work',
    actions: [ACTION.HTTP_REQUEST],
    arguments: { [HTTP_METHOD_ARGUMENT]: [...CHANGING_HTTP_METHODS] },
  },
  {
    domain: POLICY_DOMAIN.CLI,
    question: 'CLIs changing your cloud, repositories, deployments and databases',
    recommended: DECISION_EFFECT.ASK,
    because:
      'a deploy, a merge or a delete lands on somebody else’s system, while listing and reading are how an agent finds its way',
    actions: [...REMOTE_CLIS.map((cli) => `${cli}.*`), ...OUTWARD_VERBS],
    // Not unknown: a verb no table knows is allowed and counted rather than blocked.
    classes: [...CHANGING_CLASSES],
  },
  {
    domain: POLICY_DOMAIN.DATABASE,
    question:
      'Database statements that drop a table, change every row, or change the schema',
    recommended: DECISION_EFFECT.ASK,
    because:
      'a DELETE or UPDATE with no WHERE, a TRUNCATE or a DROP takes every row at once, while a write bounded to the rows a task needs is ordinary work',
    actions: DATABASE_CHANGES,
    classes: [...CHANGING_CLASSES],
  },
  {
    domain: POLICY_DOMAIN.REMOTE_DATABASE,
    question: 'Any change to a database on another host',
    recommended: DECISION_EFFECT.ASK,
    because:
      'a database somebody else runs is somebody else’s data, however few rows a statement names',
    actions: DATABASE_CLIENTS.map((client) => `${client}.*`),
    // A host and never a command line, which a seam falls back to and which always has a space.
    // A statement names a host only when it is not this machine.
    targets: ['**', '!* *'],
    classes: [...CHANGING_CLASSES],
  },
  {
    domain: POLICY_DOMAIN.CONSEQUENTIAL,
    question: 'Moving money, deploying, or handing out authority, through any tool',
    recommended: DECISION_EFFECT.ASK,
    because:
      'a refund, a deploy or a new admin is the kind of change that should be a person’s, however the agent reached it',
    actions: OUTSIDE_THIS_MACHINE,
    capabilities: [CAPABILITY.TRANSFER, CAPABILITY.DEPLOY, CAPABILITY.ADMIN],
  },
  {
    domain: POLICY_DOMAIN.PRODUCTION,
    question: 'Any change in an environment named like production',
    recommended: DECISION_EFFECT.ASK,
    because:
      'reading production is how an incident gets understood, and changing it is where one gets made',
    actions: OUTSIDE_THIS_MACHINE,
    environments: ['prod*', 'production', 'live'],
    classes: [...CHANGING_CLASSES],
  },
  {
    domain: POLICY_DOMAIN.SENSITIVE_DATA,
    question:
      'Sensitive data sent outside this machine: credentials, customer records, money, health, confidential material, code',
    recommended: DECISION_EFFECT.ASK,
    because:
      'a ticket or a page can talk an agent into sending what it holds, so a person looks until the approved destinations are listed as `!*.yourcompany.com` and the rule is turned to deny',
    actions: OUTSIDE_THIS_MACHINE,
    dataClassifications: [DATA_CLASSIFICATION.SENSITIVE],
  },
];

const REASONS: Readonly<Record<DecisionEffect, string>> = {
  [DECISION_EFFECT.ALLOW]: 'you chose to allow this',
  [DECISION_EFFECT.ASK]: 'you chose to be asked about this',
  [DECISION_EFFECT.DENY]: 'you chose to deny this',
};

/** One rule per domain the person did not leave on allow. */
export function policiesFrom(
  answers: ReadonlyMap<PolicyDomain, DecisionEffect>,
): Policy[] {
  const policies: Policy[] = [];
  for (const choice of DOMAIN_CHOICES) {
    const effect = answers.get(choice.domain);
    if (effect === undefined || effect === DECISION_EFFECT.ALLOW) continue;

    policies.push({
      name: `${choice.domain}-${effect}`,
      description: choice.question,
      match: {
        actions: choice.actions,
        ...(choice.targets === undefined ? {} : { targets: choice.targets }),
        ...(choice.arguments === undefined ? {} : { arguments: choice.arguments }),
        ...(choice.classes === undefined ? {} : { classes: choice.classes }),
        ...(choice.capabilities === undefined
          ? {}
          : { capabilities: choice.capabilities }),
        ...(choice.environments === undefined
          ? {}
          : { environments: choice.environments }),
        ...(choice.dataClassifications === undefined
          ? {}
          : { dataClassifications: choice.dataClassifications }),
      },
      decision: {
        effect,
        reason: `${REASONS[effect]}: ${choice.because}`,
        alternative: {
          // Every choice above names at least one action.
          action: choice.actions[0] as string,
          note: GENERATED_ALTERNATIVE_NOTE,
        },
      },
    });
  }
  return policies;
}

/** Written on every generated rule, which names no way forward particular to one command. */
export const GENERATED_ALTERNATIVE_NOTE =
  'Ask somebody, or change this rule if it is wrong for your work.';

/** What a run with no questions asked would write. */
export function recommendedAnswers(): Map<PolicyDomain, DecisionEffect> {
  return new Map(DOMAIN_CHOICES.map((choice) => [choice.domain, choice.recommended]));
}
