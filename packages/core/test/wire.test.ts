import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { confirmationMessage as fromKeyStore } from '../src/index';
import { confirmationMessage, DAEMON_METHOD } from '../src/wire';

const entry = fileURLToPath(new URL('../src/wire.ts', import.meta.url));

/** The modules a file loads when it runs; an import of types only is erased and loads nothing. */
function valueImports(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
  );
  const found: string[] = [];
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (clause !== undefined && typesOnly(clause)) continue;
      found.push((statement.moduleSpecifier as ts.StringLiteral).text);
    } else if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier !== undefined
    ) {
      if (statement.isTypeOnly) continue;
      found.push((statement.moduleSpecifier as ts.StringLiteral).text);
    }
  }
  return found;
}

function typesOnly(clause: ts.ImportClause): boolean {
  if (clause.isTypeOnly) return true;
  const bindings = clause.namedBindings;
  if (clause.name !== undefined || bindings === undefined || !ts.isNamedImports(bindings))
    return false;
  return bindings.elements.every((element) => element.isTypeOnly);
}

/** Every module reached from the entry at run time, and every import that is not one of this package's files. */
function reach(start: string): { files: Set<string>; outside: string[] } {
  const files = new Set<string>();
  const outside: string[] = [];
  const queue = [start];
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (files.has(file)) continue;
    files.add(file);
    for (const specifier of valueImports(file)) {
      if (!specifier.startsWith('.')) outside.push(`${file}: ${specifier}`);
      else queue.push(`${resolve(dirname(file), specifier)}.ts`);
    }
  }
  return { files, outside };
}

describe('the wire entry', () => {
  it('loads nothing but this package own pure files, so a webview can bundle it', () => {
    expect(reach(entry).outside).toEqual([]);
  });

  it('signs the same words the daemon verifies', () => {
    expect(confirmationMessage).toBe(fromKeyStore);
    expect(DAEMON_METHOD).toBeDefined();
  });
});
