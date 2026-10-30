import type { SourcePassage } from './memory-source';

/**
 * Markdown read into passages, one per heading, with Obsidian's wiki links read as the words they
 * show and frontmatter kept as one line of properties. Pure, so every source splits the same way.
 */

/** Longer than any section a person writes by hand; past it the rest is not read. */
export const MOST_PASSAGE_CHARS = 4_000;
/** A document past this many sections is a dump rather than notes. */
export const MOST_PASSAGES_PER_DOCUMENT = 50;

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const WIKI_LINK = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g;
const FENCE = /^(```|~~~)/;

/** `key: value` lines of a frontmatter block; nested YAML is kept as written, never parsed. */
export function frontmatterOf(text: string): {
  properties: Record<string, string>;
  body: string;
} {
  const found = FRONTMATTER.exec(text);
  if (found === null) return { properties: {}, body: text };
  const properties: Record<string, string> = {};
  for (const line of (found[1] ?? '').split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon <= 0 || /^\s/.test(line)) continue;
    const value = line.slice(colon + 1).trim();
    if (value !== '') properties[line.slice(0, colon).trim()] = value;
  }
  return { properties, body: text.slice(found[0].length) };
}

/** `[[Release process|releases]]` reads as `releases`, and `[[Release process]]` as itself. */
export function withoutWikiLinks(text: string): string {
  return text.replace(WIKI_LINK, (_whole, target: string, shown: string | undefined) =>
    (shown ?? target).trim(),
  );
}

/** The notes a document links to, by name, which a vault's reader can follow. */
export function wikiLinksOf(text: string): string[] {
  return [
    ...new Set([...text.matchAll(WIKI_LINK)].map((match) => (match[1] ?? '').trim())),
  ];
}

interface Section {
  heading?: string;
  lines: string[];
}

/** One passage per heading; text before the first heading sits under the document's title, if any. */
export function markdownPassages(
  document: string,
  text: string,
  title?: string,
): SourcePassage[] {
  const { properties, body } = frontmatterOf(text);
  const sections = sectionsOf(withoutWikiLinks(body));
  const named = title ?? properties['title'];
  const first = sections[0];
  if (first !== undefined && first.heading === undefined && named !== undefined)
    first.heading = named;
  const props = Object.entries(properties)
    .map(([key, value]) => `${key}: ${value}`)
    .join('; ');
  if (props !== '' && first !== undefined) first.lines.unshift(`Properties: ${props}`);
  return sections
    .map((section) => passageOf(document, section))
    .filter((passage): passage is SourcePassage => passage !== null)
    .slice(0, MOST_PASSAGES_PER_DOCUMENT);
}

function sectionsOf(body: string): Section[] {
  const sections: Section[] = [{ lines: [] }];
  let fenced = false;
  for (const line of body.split(/\r?\n/)) {
    if (FENCE.test(line.trim())) fenced = !fenced;
    const heading = fenced ? null : HEADING.exec(line);
    if (heading !== null)
      sections.push({ heading: (heading[2] ?? '').trim(), lines: [] });
    else sections[sections.length - 1]?.lines.push(line);
  }
  return sections;
}

function passageOf(document: string, section: Section): SourcePassage | null {
  const text = section.lines.join('\n').trim().slice(0, MOST_PASSAGE_CHARS);
  if (text === '') return null;
  return {
    document,
    ...(section.heading === undefined ? {} : { heading: section.heading }),
    text,
  };
}
