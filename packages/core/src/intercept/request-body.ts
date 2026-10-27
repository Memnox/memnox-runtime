/** What a `curl` or `wget` line sends in its body, read off argv for the sensitive data classifier. */
import { classificationLabel, classifyOutgoingData } from '../domain/sensitive-data';
import { BODY_FLAGS } from './binary-class';

const SENDERS: ReadonlySet<string> = new Set(['curl', 'wget']);

/** The classification of what the line sends, or undefined where it sends nothing sensitive. */
export function bodyClassification(
  binary: string,
  args: readonly string[],
): string | undefined {
  if (!SENDERS.has(binary)) return undefined;
  const parts = bodyParts(args);
  if (parts.length === 0) return undefined;
  // Several `-d` flags are joined with `&` by curl itself, so they are read as one body.
  const body = parts.length === 1 ? parts[0] : parts.join('&');
  const data = classifyOutgoingData(body);
  return data === null ? undefined : classificationLabel(data);
}

function bodyParts(args: readonly string[]): string[] {
  const parts: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    // Inside the bounds the loop checks, so never undefined.
    const arg = args[index] as string;
    if (BODY_FLAGS.includes(arg)) {
      const value = args[index + 1];
      // `@file` names what is sent, which the classifier reads as a file leaving.
      if (value !== undefined) parts.push(value);
      index += 1;
      continue;
    }
    const inline = BODY_FLAGS.find(
      (flag) => flag.startsWith('--') && arg.startsWith(`${flag}=`),
    );
    if (inline !== undefined) parts.push(arg.slice(inline.length + 1));
    else if (arg.length > 2 && arg.startsWith('-d') && !arg.startsWith('--'))
      parts.push(arg.slice(2));
  }
  return parts;
}
