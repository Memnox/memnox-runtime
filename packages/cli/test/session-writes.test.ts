import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FILE_KIND, kindOf } from '../src/session-tools/session-writes';

describe('what kind of file a session changed', () => {
  it('calls views, styles and images the interface, and tests tests', () => {
    expect(kindOf('/r/apps/web/src/Button.tsx')).toBe(FILE_KIND.INTERFACE);
    expect(kindOf('/r/apps/web/src/theme.css')).toBe(FILE_KIND.INTERFACE);
    expect(kindOf('/r/Support/Logo/mark.png')).toBe(FILE_KIND.INTERFACE);
    expect(kindOf('/r/src/button.test.tsx')).toBe(FILE_KIND.TEST);
    expect(kindOf('/r/Tests/CoreTests/SpeechTests.swift')).toBe(FILE_KIND.TEST);
    expect(kindOf('/r/README.md')).toBe(FILE_KIND.DOCS);
    expect(kindOf('/r/Support/Info.plist')).toBe(FILE_KIND.CONFIG);
  });

  it('reads a source file for the framework it draws with', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'memnox-kinds-'));
    await writeFile(join(dir, 'MenuBar.swift'), 'import AppKit\nimport SwiftUI\n');
    await writeFile(join(dir, 'Speech.swift'), 'import Foundation\n');
    await writeFile(join(dir, 'page.ts'), "import { useState } from 'react';\n");
    expect(kindOf(join(dir, 'MenuBar.swift'))).toBe(FILE_KIND.INTERFACE);
    expect(kindOf(join(dir, 'Speech.swift'))).toBe(FILE_KIND.CODE);
    expect(kindOf(join(dir, 'page.ts'))).toBe(FILE_KIND.INTERFACE);
  });
});
