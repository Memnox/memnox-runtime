import {
  ENFORCEMENT_MODE,
  loadOrCreateConfig,
  protectionStopped,
  type EnforcementMode,
} from '@memnox/core';

/** The mode every seam here is running: off while `memnox stop` holds, otherwise the configured one. */
export async function runningMode(home: string): Promise<EnforcementMode> {
  if (await protectionStopped(home)) return ENFORCEMENT_MODE.OFF;
  return (await loadOrCreateConfig(home)).mode;
}
