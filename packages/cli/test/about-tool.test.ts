import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  aboutTool,
  knowledgeIndex,
  searchKnowledge,
  sectionsOf,
  type KnowledgeSection,
} from '../src/session-tools/about-tool';
import { KNOWLEDGE_SOURCES } from '../src/operator/knowledge-sources';
import { OPERATOR_TOOLS } from '../src/session-tools/operator-tools';

const ROOT = join(import.meta.dirname, '..', '..', '..');

const VISION = [
  '# Memnox',
  'Intro.',
  '# 15. Agent Circuit Breaker',
  'Stops a loop that is burning money.',
  '```sh',
  '# not a heading',
  'memnox paused',
  '```',
  '# 25. Memnox Cloud',
  '### Local Memnox',
  'The laptop half.',
].join('\n');

interface Found {
  found?: boolean;
  sections?: KnowledgeSection[];
  index?: unknown[];
}

describe('the project documents the voice answers from', () => {
  it('splits at headings and keeps the headings above each one', () => {
    const sections = sectionsOf({ name: 'vision.md', text: VISION });
    expect(sections.map((one) => one.heading)).toEqual([
      'Memnox',
      '15. Agent Circuit Breaker',
      '25. Memnox Cloud > Local Memnox',
    ]);
    expect(sections[1]?.text).toContain('# not a heading');
  });

  it('finds a vision section by its number or its words', () => {
    const sections = sectionsOf({ name: 'vision.md', text: VISION });
    expect(searchKnowledge(sections, 'section 15')[0]?.heading).toContain('Circuit');
    expect(
      searchKnowledge(sections, 'what is the circuit breakers')[0]?.heading,
    ).toContain('Circuit');
    expect(searchKnowledge(sections, 'laptop')[0]?.heading).toContain('Local Memnox');
  });

  it('finds nothing rather than something when no word of the question appears', () => {
    const sections = sectionsOf({ name: 'vision.md', text: VISION });
    expect(searchKnowledge(sections, 'kubernetes autoscaler')).toEqual([]);
  });

  it('lists each document by its headings for a question too broad to search', () => {
    const index = knowledgeIndex(sectionsOf({ name: 'vision.md', text: VISION }));
    expect(index).toEqual([
      {
        document: 'vision',
        headings: [
          'Memnox',
          '15. Agent Circuit Breaker',
          '25. Memnox Cloud > Local Memnox',
        ],
      },
    ]);
  });

  it('ships every source it names, so the build copy cannot fail on a moved file', () => {
    for (const source of Object.keys(KNOWLEDGE_SOURCES))
      expect(existsSync(join(ROOT, source)), source).toBe(true);
  });

  it('answers from the real documents', async () => {
    const breaker = (await aboutTool({ question: 'circuit breaker' })) as Found;
    expect(breaker.found).toBe(true);
    expect(breaker.sections?.some((one) => one.heading.includes('Circuit Breaker'))).toBe(
      true,
    );
    const pricing = (await aboutTool({ question: 'business model pricing' })) as Found;
    expect(pricing.sections?.some((one) => one.heading.includes('Business Model'))).toBe(
      true,
    );
    const priced = (await aboutTool({ question: 'how is it priced' })) as Found;
    expect(priced.sections?.[0]?.heading).toContain('Business Model');
    const overview = (await aboutTool({ question: 'what is memnox' })) as Found;
    expect(overview.sections?.some((one) => one.heading.includes('Vision'))).toBe(true);
    const index = (await aboutTool({})) as Found;
    expect(index.index?.length).toBe(Object.keys(KNOWLEDGE_SOURCES).length);
  });

  it('is offered to the voice as a read', () => {
    const about = OPERATOR_TOOLS.find((tool) => tool.name === 'about');
    expect(about?.annotations.readOnlyHint).toBe(true);
  });
});
