import {
  DEVICE_KIND,
  holds,
  type DeviceRecord,
  type RemoteCapability,
  type VoiceHolder,
} from '@memnox/core';

/**
 * Which paired phone a yes waits on. Pairing a phone is enough: the person who paired it may be far
 * from the Mac, so every yes that phone may give is put to its Face ID rather than to Touch ID.
 */

/**
 * The phone that answers a yes needing `needs`: `prefer` when it may, else the one paired last that may,
 * or null when no paired phone may answer it and only the Mac can.
 */
export function answeringPhone(
  devices: readonly DeviceRecord[],
  needs: RemoteCapability | null,
  prefer?: string,
): VoiceHolder | null {
  if (needs === null) return null;
  const able = devices.filter(
    (device) => device.kind === DEVICE_KIND.PHONE && holds(device, needs),
  );
  const chosen =
    able.find((device) => device.id === prefer) ??
    able.reduce<DeviceRecord | null>(
      (latest, device) =>
        latest === null || device.pairedAt > latest.pairedAt ? device : latest,
      null,
    );
  return chosen === null ? null : { deviceId: chosen.id, name: chosen.name };
}

/** The stamp an event carries for that phone, empty when none answers it. */
export function answerOnOf(phone: VoiceHolder | null): { answerOn?: VoiceHolder } {
  return phone === null ? {} : { answerOn: phone };
}
