/**
 * The project's own writing the voice answers from, as repository path to the name it ships
 * under in `dist/knowledge`. One list, read by the build and by the voice, so a document that
 * ships is always one the voice can find. No imports, since `tsup.config.ts` reads it too.
 */
export const KNOWLEDGE_SOURCES: Readonly<Record<string, string>> = {
  'VISION.md': 'vision.md',
  'ARCHITECTURE.md': 'architecture.md',
  'README.md': 'readme.md',
  'CLAUDE.md': 'build-plan.md',
  'packages/cli/CHANGELOG.md': 'changelog.md',
  'docs/commands.md': 'commands.md',
  'docs/onboarding.md': 'onboarding.md',
  'docs/quickstart.md': 'quickstart.md',
  'docs/policies.md': 'policies.md',
  'docs/use-cases.md': 'use-cases.md',
  'docs/harnesses.md': 'harnesses.md',
  'docs/faq.md': 'faq.md',
  'docs/threat-model.md': 'threat-model.md',
  'docs/risk-bands.md': 'risk-bands.md',
  'docs/event-schema.md': 'event-schema.md',
  'docs/adr/0001-windows-support.md': 'adr-windows-support.md',
  'docs/adr/0002-telemetry.md': 'adr-telemetry.md',
};

/** Where the build puts them, beside the bundled code. */
export const KNOWLEDGE_DIR = 'knowledge';
