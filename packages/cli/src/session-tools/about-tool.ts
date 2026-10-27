import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KNOWLEDGE_DIR, KNOWLEDGE_SOURCES } from '../operator/knowledge-sources';
import { textArg, type ToolArgs } from './read-tools';

/**
 * "What is Memnox for?", "what does section fifteen say?", "how does protect work?": the
 * project's own writing, split at its headings and searched by the words of the question, so
 * the voice answers from what the project says rather than from what a model supposes.
 */

interface KnowledgeDocument {
  name: string;
  text: string;
}

export interface KnowledgeSection {
  document: string;
  /** Every heading above it, outermost first, so "Local Memnox" still reads as part of Memnox Cloud. */
  heading: string;
  text: string;
}

/** Long enough to carry a whole idea, short enough that four of them fit one quick answer. */
const MOST_SECTION_CHARS = 1_800;
const MOST_SECTIONS = 4;
const MOST_INDEX_HEADINGS = 24;
/** A heading names what a section is about, so a word there outweighs the same word in passing. */
const HEADING_WEIGHT = 3;
const DOCUMENT_WEIGHT = 1;

const STOPWORDS = new Set(
  (
    'a an and are as at be but by can do does for from has have how i in is it its me my of on or ' +
    'say says should so than that the their them then there these they this to was what when ' +
    'where which who why will with would you your about tell explain memnox did'
  ).split(' '),
);

const OVERVIEW = 'core vision thesis one sentence';

/** How people ask, against how the documents put it. */
const SPOKEN: Readonly<Record<string, string>> = {
  priced: 'pricing price business model',
  price: 'pricing business model',
  cost: 'pricing business model',
  pay: 'pricing business model',
  competitor: 'competitive position',
  compare: 'competitive position',
  undo: 'rewind rollback',
  roadmap: 'milestone vision',
  model: 'llm model',
  ai: 'llm agent',
};

const SAY =
  'These are the project\'s own words. Answer from them in a sentence or two, in your own spoken words, never reading a heading, a file name or markdown out. Name a section of the vision by its number when it helps, like "section fifteen, the circuit breaker". When none of them answers what was asked, say the project\'s documents do not cover it rather than guessing.';

const SAY_INDEX =
  'This is what the project has written down. Call about again with the words of their question to read the part that answers it.';

export async function aboutTool(args: ToolArgs): Promise<unknown> {
  const sections = await knowledge();
  if (sections.length === 0) {
    return {
      found: false,
      said: 'The project documents are not installed with this copy of Memnox, so answer only from what the other tools read.',
    };
  }
  const question = textArg(args, 'question') ?? '';
  if (question.trim() === '') return { index: knowledgeIndex(sections), said: SAY_INDEX };
  // "What is Memnox?" is all small words, and is the question the overview answers.
  const found = searchKnowledge(
    sections,
    terms(question).length === 0 ? OVERVIEW : question,
  );
  return found.length === 0
    ? {
        found: false,
        said: 'Nothing in the project documents matches that. Say so plainly.',
      }
    : { found: true, sections: found, said: SAY };
}

/** The sections that best answer a question, best first; none when no word of it appears anywhere. */
export function searchKnowledge(
  sections: readonly KnowledgeSection[],
  question: string,
  most = MOST_SECTIONS,
): KnowledgeSection[] {
  const asked = [...new Set(askedTerms(question))];
  const indexed = sections.map((section) => ({
    section,
    body: counts(terms(section.text)),
    heading: new Set(terms(section.heading)),
    document: new Set(terms(section.document)),
  }));
  const rarity = new Map(
    asked.map((term) => {
      const holding = indexed.filter(
        (one) => one.body.has(term) || one.heading.has(term),
      ).length;
      return [term, Math.log(1 + indexed.length / (1 + holding))];
    }),
  );
  return indexed
    .map((one) => ({
      section: one.section,
      score: asked.reduce((sum, term) => {
        const weight = rarity.get(term) ?? 0;
        const seen = one.body.get(term) ?? 0;
        return (
          sum +
          weight *
            ((seen === 0 ? 0 : 1 + Math.log(seen)) +
              (one.heading.has(term) ? HEADING_WEIGHT : 0) +
              (one.document.has(term) ? DOCUMENT_WEIGHT : 0))
        );
      }, 0),
    }))
    .filter((one) => one.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, most)
    .map((one) => one.section);
}

/** Each document by its title and its main headings, for a question too broad to search. */
export function knowledgeIndex(
  sections: readonly KnowledgeSection[],
): { document: string; headings: string[] }[] {
  const byDocument = new Map<string, string[]>();
  for (const section of sections) {
    const headings = byDocument.get(section.document) ?? [];
    const top = section.heading.split(' > ').slice(0, 2).join(' > ');
    if (top !== '' && !headings.includes(top) && headings.length < MOST_INDEX_HEADINGS)
      headings.push(top);
    byDocument.set(section.document, headings);
  }
  return [...byDocument].map(([document, headings]) => ({ document, headings }));
}

/** Markdown split at its headings, with a long section cut at paragraphs into pieces that each still name it. */
export function sectionsOf(document: KnowledgeDocument): KnowledgeSection[] {
  const name = document.name.replace(/\.md$/, '').replace(/-/g, ' ');
  const sections: KnowledgeSection[] = [];
  const path: string[] = [];
  let body: string[] = [];
  let fenced = false;
  const flush = (): void => {
    for (const text of pieces(body.join('\n').trim()))
      sections.push({ document: name, heading: path.filter(Boolean).join(' > '), text });
    body = [];
  };
  for (const line of document.text.split('\n')) {
    // A `#` inside a code block is a shell comment, never a heading.
    if (line.trimStart().startsWith('```')) fenced = !fenced;
    const heading = fenced ? null : /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading === null) {
      body.push(line);
      continue;
    }
    flush();
    const depth = heading[1]?.length ?? 1;
    path.length = depth - 1;
    path[depth - 1] = (heading[2] ?? '').replace(/`/g, '');
  }
  flush();
  return sections;
}

function pieces(text: string): string[] {
  if (text === '') return [];
  const out: string[] = [];
  let current = '';
  for (const paragraph of text.split(/\n\s*\n/)) {
    if (current !== '' && current.length + paragraph.length > MOST_SECTION_CHARS) {
      out.push(current);
      current = '';
    }
    current = current === '' ? paragraph : `${current}\n\n${paragraph}`;
  }
  if (current !== '') out.push(current);
  // One paragraph longer than a section, such as a big table, is cut rather than sent whole.
  return out.map((piece) => piece.slice(0, MOST_SECTION_CHARS * 2));
}

function terms(text: string): string[] {
  return words(text).map(stem);
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1 && !STOPWORDS.has(word));
}

/** The question's own words and what each is also called, so "how is it priced" finds the business model. */
function askedTerms(question: string): string[] {
  const said = words(question);
  const also = said.flatMap((word) =>
    Object.hasOwn(SPOKEN, word) ? words(SPOKEN[word] ?? '') : [],
  );
  return [...new Set([...said, ...also])].map(stem);
}

/** Plurals only: "agents" finds "agent" and "policies" finds "policy", while "changed" stays apart from "change". */
function stem(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss'))
    return word.slice(0, -1);
  return word;
}

function counts(words: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const word of words) out.set(word, (out.get(word) ?? 0) + 1);
  return out;
}

let loaded: Promise<KnowledgeSection[]> | null = null;

/** Read once per process, since the documents only change with an update. */
function knowledge(): Promise<KnowledgeSection[]> {
  loaded ??= readKnowledge().catch(() => []);
  return loaded;
}

async function readKnowledge(): Promise<KnowledgeSection[]> {
  const files = knowledgeFiles(dirname(fileURLToPath(import.meta.url)));
  const documents = await Promise.all(
    files.map(async ({ name, path }) => ({
      name,
      text: await readFile(path, 'utf8').catch(() => ''),
    })),
  );
  return documents.flatMap(sectionsOf);
}

/**
 * The installed copy beside the bundle, or the repository itself when running from source.
 * Walked upward because the bundler decides which chunk this lands in.
 */
function knowledgeFiles(from: string): { name: string; path: string }[] {
  let dir = from;
  for (let up = 0; up < 6; up += 1) {
    const shipped = join(dir, KNOWLEDGE_DIR);
    if (existsSync(join(shipped, 'vision.md')))
      return Object.values(KNOWLEDGE_SOURCES).map((name) => ({
        name,
        path: join(shipped, name),
      }));
    if (existsSync(join(dir, 'VISION.md')) && existsSync(join(dir, 'packages')))
      return Object.entries(KNOWLEDGE_SOURCES).map(([source, name]) => ({
        name,
        path: join(dir, source),
      }));
    dir = dirname(dir);
  }
  return [];
}
