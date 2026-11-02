import { basename } from 'node:path';
import { SessionHosts, SessionTasks, typedAsks, type DaemonEvent } from '@memnox/core';

/** Which session it was, by its task, the last thing asked of it and its folder, so two of one agent are told apart. */
export async function whichSession(
  home: string,
  sessionId: string,
): Promise<Pick<DaemonEvent, 'task' | 'lastAsk' | 'place'>> {
  const [task, host] = await Promise.all([
    new SessionTasks(home).read(sessionId),
    new SessionHosts(home).read(sessionId),
  ]);
  return {
    ...typedAsks(task),
    ...(host?.cwd === undefined ? {} : { place: basename(host.cwd) }),
  };
}
