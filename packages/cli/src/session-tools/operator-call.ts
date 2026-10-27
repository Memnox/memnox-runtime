import type { SessionToolDeps, ToolArgs } from './read-tools';
import type { RewindSeams } from './rewind-tool';

/** One operator tool's handler, handed what every tool is handed, so each module can keep its own. */
export type OperatorCall = (
  deps: SessionToolDeps,
  seams: RewindSeams,
  args: ToolArgs,
) => unknown;
