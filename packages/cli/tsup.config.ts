import { cpSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'tsup';
import { KNOWLEDGE_DIR, KNOWLEDGE_SOURCES } from './src/operator/knowledge-sources';

export default defineConfig({
  // Every binary the plan installs ships from this package: npm exposes the bins of
  // what you installed, never those of its dependencies.
  entry: [
    'src/index.ts',
    'src/bin/mcp-proxy.ts',
    'src/bin/shell.ts',
    'src/bin/intercept.ts',
    'src/bin/git-credential.ts',
    'src/bin/egress.ts',
    'src/bin/edit-hook.ts',
    'src/bin/session.ts',
    'src/bin/operator.ts',
  ],
  format: ['esm'],
  clean: true,
  banner: { js: '#!/usr/bin/env node' },
  // The VS Code extension ships inside memnox, so `protect --vscode` installs the version beside it.
  onSuccess: async () => {
    cpSync('../vscode/dist/extension.js', 'dist/vscode/extension.js');
    // The project's own documents ship too, so the voice answers about Memnox from what it says.
    for (const [source, name] of Object.entries(KNOWLEDGE_SOURCES))
      cpSync(join('../..', source), join('dist', KNOWLEDGE_DIR, name));
    // The plugins written into agents that hook in-process, read beside the bundle at install.
    cpSync('src/protect/agent-plugins', 'dist/agent-plugins', { recursive: true });
    // The native wrapper ships where it was built; without one the shims keep the Node interceptor.
    const native = '../../native/intercept/dist';
    if (existsSync(native)) cpSync(native, 'dist/native', { recursive: true });
  },
});
