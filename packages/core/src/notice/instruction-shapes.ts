/**
 * Phrases that try to address the model rather than answer the tool call, read the same
 * way whether the text came through the MCP proxy or an agent's own fetch, read or shell.
 * Cheap and certain only: this marks content for the record and never decides anything.
 */
const INSTRUCTION_SHAPES: readonly RegExp[] = [
  /\bignore (all |any )?(previous|prior|earlier|above) instructions?\b/i,
  /\bdisregard (all |any )?(previous|prior|earlier|the) (instructions?|rules?|system prompt)\b/i,
  /\byou are now\b/i,
  /\bnew (system )?(instructions?|prompt)\s*:/i,
  /<\s*(system|important_instructions)\s*>/i,
  /\bdo not tell the user\b/i,
  /\b(reveal|print|output) (your|the) (system prompt|instructions)\b/i,
];

export function hasInstructionShape(text: string): boolean {
  return INSTRUCTION_SHAPES.some((shape) => shape.test(text));
}

/** Enough to find an instruction, and bounded, since a tool's answer can be a whole file. */
const MOST_CHARS_READ = 200_000;
const MOST_DEPTH = 4;

/** The same check over whatever a tool answered: a string, or the strings inside an object. */
export function answerHasInstructionShape(answer: unknown): boolean {
  return hasInstructionShape(answerText(answer, 0));
}

function answerText(answer: unknown, depth: number): string {
  if (typeof answer === 'string') return answer.slice(0, MOST_CHARS_READ);
  if (depth >= MOST_DEPTH || typeof answer !== 'object' || answer === null) return '';
  const values = Array.isArray(answer) ? answer : Object.values(answer);
  let text = '';
  for (const value of values) {
    text += `${answerText(value, depth + 1)}\n`;
    if (text.length >= MOST_CHARS_READ) break;
  }
  return text.slice(0, MOST_CHARS_READ);
}
