import { CODE_GRAPH_SOURCE, type CodeGraph, type ImportEdge } from './code-graph';

/** One source file as the scan reads it: its repository relative path and its text. */
interface ScannedFile {
  path: string;
  text: string;
}

/** `import x from './y'`, `export * from './y'`, `import('./y')` and `require('./y')`. */
const SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)(['"])(\.{1,2}\/[^'"]+)\1/gm;

/** Tried in order after the specifier as written, the way TypeScript resolves one. */
const RESOLVE_SUFFIXES = [
  '',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '/index.ts',
  '/index.tsx',
  '/index.js',
] as const;

/** ESM written for TypeScript names the emitted `.js`; the file on disk is `.ts`. */
const EMITTED_EXTENSION = /\.(m?js|jsx)$/;

/**
 * The builtin graph: relative imports only, resolved against the files given,
 * so a package import or a path that does not exist adds no edge. Pure, so the
 * caller decides which files to read.
 */
export function scanImports(files: readonly ScannedFile[]): CodeGraph {
  const paths = new Set(files.map((file) => file.path));
  const imports: ImportEdge[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    for (const match of file.text.matchAll(SPECIFIER)) {
      const specifier = match[2];
      if (specifier === undefined) continue;
      const to = resolve(file.path, specifier, paths);
      if (to === undefined || to === file.path) continue;
      const key = `${file.path}\n${to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      imports.push({ from: file.path, to });
    }
  }
  return { source: CODE_GRAPH_SOURCE.BUILTIN, files: [...paths], imports };
}

function resolve(
  from: string,
  specifier: string,
  paths: ReadonlySet<string>,
): string | undefined {
  const joined = normalize(`${directoryOf(from)}/${specifier}`);
  if (joined === undefined) return undefined;
  const stems = [joined, joined.replace(EMITTED_EXTENSION, '')];
  for (const stem of stems) {
    for (const suffix of RESOLVE_SUFFIXES) {
      if (paths.has(`${stem}${suffix}`)) return `${stem}${suffix}`;
    }
  }
  return undefined;
}

function directoryOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash);
}

/** Folds `.` and `..`; undefined where a path climbs out of the repository. */
function normalize(path: string): string | undefined {
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) return undefined;
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join('/');
}
