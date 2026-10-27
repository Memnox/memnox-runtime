/**
 * One recorded action read against everything that decided it, off the row alone, so a
 * verdict explains itself after the rules moved. Facts and agreeing rules, never a score.
 */
import { DECISION_EFFECT } from '../constants/decision.constants';
import { CONTAINMENT_SIGNAL } from '../gate/containment';
import {
  ALLOWANCE_SIGNAL_PREFIX,
  HIDDEN_CODE_SIGNAL,
  INVESTIGATE_SIGNAL,
  STRAIN_SIGNAL,
} from '../gate/local-gate';
import { SELF_PROTECTION_SIGNAL } from '../gate/self-protection';
import { NOTICE_SIGNAL, NOTICE_SIGNAL_PREFIX } from '../notice/notice.constants';
import { SCOPE_MATCH } from '../domain/task';
import type { MemnoxEvent } from '../event/event';
import {
  CONTEXT_DOMAIN,
  CONTEXT_SIGNAL_PREFIX,
  type ContextDomain,
} from './ledger.constants';

/** One part of the context, and what the row says about it. */
export interface ContextPart {
  domain: ContextDomain;
  /** In words, each a fact the row carries or a rule that agreed with the verdict. */
  facts: string[];
  /** Something here is why the verdict came out the way it did. */
  decided: boolean;
}

/** Signals the gate writes outside the context prefixes, each with its part and its words. */
interface KnownSignal {
  domain: ContextDomain;
  said: string;
  /** Loosens rather than holds, so it decided only an allow. */
  loosens?: boolean;
}

const KNOWN_SIGNALS: Readonly<Record<string, KnownSignal>> = {
  [SELF_PROTECTION_SIGNAL]: {
    domain: CONTEXT_DOMAIN.AGENT,
    said: 'it touched what governs the agent, which only a person changes',
  },
  [CONTAINMENT_SIGNAL.PROBATION]: {
    domain: CONTEXT_DOMAIN.AGENT,
    said: 'the agent is on probation',
  },
  [INVESTIGATE_SIGNAL]: {
    domain: CONTEXT_DOMAIN.INTENT,
    said: 'the session was declared an investigation',
  },
  [`${CONTEXT_SIGNAL_PREFIX.SCOPE}${SCOPE_MATCH.IN_SCOPE}`]: {
    domain: CONTEXT_DOMAIN.INTENT,
    said: 'inside the task the session declared',
  },
  [`${CONTEXT_SIGNAL_PREFIX.SCOPE}${SCOPE_MATCH.OUT_OF_SCOPE}`]: {
    domain: CONTEXT_DOMAIN.INTENT,
    said: 'outside the task the session declared',
  },
  [HIDDEN_CODE_SIGNAL]: {
    domain: CONTEXT_DOMAIN.TOOLS,
    said: 'it runs code nobody could read before it ran',
  },
  [CONTAINMENT_SIGNAL.UNTRUSTED]: {
    domain: CONTEXT_DOMAIN.TOOLS,
    said: 'it runs in a repository not yet trusted',
  },
  [CONTAINMENT_SIGNAL.BOUNDARY]: {
    domain: CONTEXT_DOMAIN.SYSTEMS,
    said: 'it lands outside the repository the session started in',
  },
  [`${NOTICE_SIGNAL_PREFIX}${NOTICE_SIGNAL.NOVEL}`]: {
    domain: CONTEXT_DOMAIN.HISTORY,
    said: 'this agent had never done this before',
  },
  [`${NOTICE_SIGNAL_PREFIX}${NOTICE_SIGNAL.CHAIN}`]: {
    domain: CONTEXT_DOMAIN.HISTORY,
    said: 'it sends outward after this session took something worth having',
  },
  [`${NOTICE_SIGNAL_PREFIX}${NOTICE_SIGNAL.TAINT}`]: {
    domain: CONTEXT_DOMAIN.HISTORY,
    said: 'it came after a tool result that read like instructions',
  },
  [`${NOTICE_SIGNAL_PREFIX}${NOTICE_SIGNAL.TURN}`]: {
    domain: CONTEXT_DOMAIN.HISTORY,
    said: 'the first change after a session that had only read',
  },
  [STRAIN_SIGNAL]: {
    domain: CONTEXT_DOMAIN.HISTORY,
    said: 'it came after failures nothing had got past',
  },
  [CONTAINMENT_SIGNAL.CHECKPOINTED]: {
    domain: CONTEXT_DOMAIN.HISTORY,
    said: 'a milestone could put it back',
    loosens: true,
  },
};

/** Rules agreeing with the verdict, by the part of the context each was written about. */
const RULE_PREFIXES: readonly { prefix: string; domain: ContextDomain; said: string }[] =
  [
    {
      prefix: CONTEXT_SIGNAL_PREFIX.PERSON,
      domain: CONTEXT_DOMAIN.PERSON,
      said: 'on who the agent works for',
    },
    {
      prefix: CONTEXT_SIGNAL_PREFIX.AGENT,
      domain: CONTEXT_DOMAIN.AGENT,
      said: 'on this agent or its job',
    },
    {
      prefix: CONTEXT_SIGNAL_PREFIX.INTENT,
      domain: CONTEXT_DOMAIN.INTENT,
      said: 'on what the session was for',
    },
    {
      prefix: CONTEXT_SIGNAL_PREFIX.SYSTEMS,
      domain: CONTEXT_DOMAIN.SYSTEMS,
      said: 'on the action and where it lands',
    },
  ];

const DOMAIN_ORDER: readonly ContextDomain[] = Object.values(CONTEXT_DOMAIN);

/** Every part, in reading order, so a part with nothing recorded says so rather than vanishing. */
export function actionContextOf(event: MemnoxEvent): ContextPart[] {
  const facts = new Map<ContextDomain, string[]>();
  const decided = new Set<ContextDomain>();
  const add = (domain: ContextDomain, fact: string, decides: boolean): void => {
    facts.set(domain, [...(facts.get(domain) ?? []), fact]);
    if (decides) decided.add(domain);
  };
  const held = heldBy(event);

  for (const fact of rowFacts(event)) add(fact.domain, fact.said, false);
  for (const signal of event.signals ?? []) {
    const known = KNOWN_SIGNALS[signal];
    if (known !== undefined) {
      add(known.domain, known.said, known.loosens === true ? !held : held);
      continue;
    }
    if (signal.startsWith(ALLOWANCE_SIGNAL_PREFIX)) {
      add(CONTEXT_DOMAIN.HISTORY, 'a person had allowed this for a while', !held);
      continue;
    }
    const rule = RULE_PREFIXES.find((each) => signal.startsWith(each.prefix));
    if (rule !== undefined) {
      add(rule.domain, `rule ${signal.slice(rule.prefix.length)} ${rule.said}`, true);
    }
  }
  return DOMAIN_ORDER.map((domain) => ({
    domain,
    facts: facts.get(domain) ?? [NOTHING_SAID[domain] ?? 'nothing was recorded'],
    decided: decided.has(domain),
  }));
}

/** A row with no signals was written before they were kept, which is not the same as clear. */
export function hasRecordedContext(event: MemnoxEvent): boolean {
  return event.signals !== undefined;
}

/** Asked or refused, or would have been under enforce. */
function heldBy(event: MemnoxEvent): boolean {
  const effect = event.shadowEffect ?? event.effect;
  return effect !== DECISION_EFFECT.ALLOW;
}

function rowFacts(event: MemnoxEvent): { domain: ContextDomain; said: string }[] {
  const facts: { domain: ContextDomain; said: string }[] = [
    {
      domain: CONTEXT_DOMAIN.PERSON,
      said:
        event.principal === undefined
          ? 'nobody was named, so no person’s authority was checked'
          : `working for ${event.principal}`,
    },
    {
      domain: CONTEXT_DOMAIN.AGENT,
      said:
        event.subagent === undefined
          ? event.agent
          : `${event.agent}, through its helper ${event.subagentType ?? event.subagent}`,
    },
    {
      domain: CONTEXT_DOMAIN.TOOLS,
      said: `${event.operation}, a ${event.class} call`,
    },
  ];
  if (event.target !== undefined) {
    facts.push({ domain: CONTEXT_DOMAIN.SYSTEMS, said: `on ${event.target}` });
  }
  if (event.conditionsInForce !== undefined && event.conditionsInForce.length > 0) {
    facts.push({
      domain: CONTEXT_DOMAIN.SYSTEMS,
      said: `while ${event.conditionsInForce.join(', ')} held`,
    });
  }
  return facts;
}

/** What a part with no fact says, for the parts a row does not always fill. */
const NOTHING_SAID: Partial<Record<ContextDomain, string>> = {
  [CONTEXT_DOMAIN.INTENT]: 'no task was declared, so nothing was compared',
  [CONTEXT_DOMAIN.SYSTEMS]: 'no rule was written about it',
  [CONTEXT_DOMAIN.HISTORY]: 'nothing about it was new',
};
