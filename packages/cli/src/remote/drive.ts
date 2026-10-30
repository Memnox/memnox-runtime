import {
  driveMessage,
  holds,
  REMOTE_CAPABILITY,
  REMOTE_OUTCOME,
  verifiesSigned,
  type DaemonRequest,
  type DaemonResponse,
  type DeviceRecord,
  type DrivenBy,
} from '@memnox/core';
import { refused } from './pairings';
import { KEY, MACHINE, THIS_MACHINES_KEY } from '../this-machine';

/** Why a grant to a paired device was refused: only this machine's own key widens what a device may do. */
export const GRANT_UNSIGNED = `Giving a device more needs ${THIS_MACHINES_KEY}.`;

/**
 * A phone driving the Mac: one Face ID over a time at most fifteen minutes ahead, after which that
 * phone's Mac proposals run unsigned. It ends at that time, on a stop, on a close, or when the session drops.
 */

const LONGEST_DRIVE_MS = 15 * 60_000;

/** A phone's clock may run a little ahead of the Mac's, which should not refuse a full fifteen minutes. */
const CLOCK_SLACK_MS = 30_000;

/** Why a drive request does not count, or null when it does. */
export function driveRefusal(
  device: DeviceRecord,
  request: { until: string; signature?: string },
  now: string,
): string | null {
  if (!holds(device, REMOTE_CAPABILITY.MAC)) {
    return `${device.name} may not act on this ${MACHINE}. Allow it from the Mac with ${KEY} first.`;
  }
  const until = Date.parse(request.until);
  const from = Date.parse(now);
  if (Number.isNaN(until) || until <= from)
    return 'Driving needs a time in the future to stop at.';
  if (until - from > LONGEST_DRIVE_MS + CLOCK_SLACK_MS) {
    return 'Driving the Mac lasts at most fifteen minutes at a time.';
  }
  const signed =
    request.signature !== undefined &&
    verifiesSigned(
      device.signingPoint,
      driveMessage(device.id, request.until),
      request.signature,
    );
  return signed ? null : `Driving the Mac needs Face ID on ${device.name}.`;
}

interface Grant extends DrivenBy {
  until: string;
  timer: ReturnType<typeof setTimeout>;
}

export class DriveGrants {
  private readonly grants = new Map<string, Grant>();

  /** Told when a grant starts, with its until, and whenever it ends, without one, so the Mac island shows it the whole time. */
  constructor(
    private readonly now: () => string,
    private readonly changed: (drivenBy: DrivenBy) => void,
  ) {}

  start(device: DeviceRecord, until: string): DrivenBy {
    // A renewal replaces the old timer quietly, so the Mac never hears the drive end and start again.
    const renewed = this.grants.get(device.id);
    if (renewed !== undefined) clearTimeout(renewed.timer);
    const wait = Math.max(0, Date.parse(until) - Date.parse(this.now()));
    const timer = setTimeout(() => this.stop(device.id), wait);
    // A grant running out is never a reason to keep a daemon alive that was asked to stop.
    timer.unref();
    const grant: Grant = { deviceId: device.id, name: device.name, until, timer };
    this.grants.set(device.id, grant);
    const live = { deviceId: device.id, name: device.name, until };
    this.changed(live);
    return live;
  }

  /** A phone's drive request: no until stops it, else a signed until starts or renews it. */
  answer(device: DeviceRecord, request: DaemonRequest): DaemonResponse {
    if (request.until === undefined) {
      this.stop(device.id);
      return { id: request.id, ok: true, outcome: REMOTE_OUTCOME.STOPPED };
    }
    const until = request.until;
    const signed =
      request.signature === undefined ? {} : { signature: request.signature };
    const why = driveRefusal(device, { until, ...signed }, this.now());
    if (why !== null) return refused(request, why);
    this.start(device, until);
    return { id: request.id, ok: true, outcome: REMOTE_OUTCOME.DRIVING, until };
  }

  /** False when that device was not driving. */
  stop(deviceId: string): boolean {
    const grant = this.grants.get(deviceId);
    if (grant === undefined) return false;
    clearTimeout(grant.timer);
    this.grants.delete(deviceId);
    this.changed({ deviceId, name: grant.name });
    return true;
  }

  /** Read against the clock as well as the timer, so a grant is never honoured a moment past its end. */
  driving(deviceId: string): boolean {
    const grant = this.grants.get(deviceId);
    if (grant === undefined) return false;
    if (Date.parse(grant.until) > Date.parse(this.now())) return true;
    this.stop(deviceId);
    return false;
  }

  close(): void {
    for (const grant of this.grants.values()) clearTimeout(grant.timer);
    this.grants.clear();
  }
}
