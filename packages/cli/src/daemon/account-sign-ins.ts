import { MachineSignIns, machineSignInFlow } from './machine-calls';
import { PersonSignIns, personSignInFlow } from './person-calls';

/**
 * The person's sign in and this machine's connection, wired so one approval in the browser gives
 * both: once the person is signed in here, their own credential approves the machine, as any
 * member may approve their own laptop on the console.
 */
export function accountSignIns(
  home: string,
  enrolled: () => void,
): { person: PersonSignIns; machine: MachineSignIns } {
  const machine = new MachineSignIns(machineSignInFlow(home, enrolled));
  const person = new PersonSignIns(personSignInFlow(home), (signedIn, label) =>
    machine.connectAs(signedIn, label),
  );
  return { person, machine };
}
