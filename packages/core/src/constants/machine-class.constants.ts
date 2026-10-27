/**
 * What kind of box this is, so a team can hold its servers to stricter rules than its laptops and
 * hear when a server goes quiet. Said once at enrolment and kept by the control plane.
 */
export const MACHINE_CLASS = {
  /** A laptop or desktop somebody sits at. */
  WORKSTATION: 'workstation',
  /** A box agents run on with nobody at its screen, such as a VPS reached over SSH. */
  SERVER: 'server',
} as const;

export type MachineClass = (typeof MACHINE_CLASS)[keyof typeof MACHINE_CLASS];

const CLASSES: readonly string[] = Object.values(MACHINE_CLASS);

export function isMachineClass(value: string): value is MachineClass {
  return CLASSES.includes(value);
}

/** Linux with no display is a server; anything else is somebody's workstation until they say otherwise. */
export function detectMachineClass(
  platform: string,
  env: Readonly<Record<string, string | undefined>>,
): MachineClass {
  const display = (env['DISPLAY'] ?? '') !== '' || (env['WAYLAND_DISPLAY'] ?? '') !== '';
  return platform === 'linux' && !display
    ? MACHINE_CLASS.SERVER
    : MACHINE_CLASS.WORKSTATION;
}
