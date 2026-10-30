import { platform } from 'node:os';
import { machineWord } from '@memnox/core';

/** What the daemon calls the machine it runs on, read once here so no tool's words read the platform. */
export const MACHINE = machineWord(platform());
