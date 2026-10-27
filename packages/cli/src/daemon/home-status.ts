import type { DaemonRequest, DaemonResponse } from '@memnox/core';
import { readStatus } from '../commands/status.command';
import { homeAnswer } from './home-answer';
import type { SessionViews } from './session-view';

/**
 * The daemon's door to the home, wired to the status screen here so the home reader itself never
 * imports a command and the status command can read the home without a loop between the two.
 */
export function answerHome(
  home: string,
  request: DaemonRequest,
  views: SessionViews,
): Promise<DaemonResponse> {
  return homeAnswer(home, request, {
    views,
    now: new Date(),
    status: (where) => readStatus(where, where),
  });
}
