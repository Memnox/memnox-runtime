import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/extension.ts'],
  // VS Code loads an extension with require, and supplies the vscode module itself.
  format: ['cjs'],
  outExtension: () => ({ js: '.js' }),
  external: ['vscode'],
  clean: true,
});
