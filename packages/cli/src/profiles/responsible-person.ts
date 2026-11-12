import { userInfo } from 'node:os';
import { readPerson } from '../sync/person';

/**
 * Who answers for a job nobody named a person for: the account signed in on this machine, else
 * the operating system user. Accountability only, so nothing that rules on an action reads it.
 */
export async function responsiblePersonHere(home: string): Promise<string> {
  const person = await readPerson(home);
  if (person !== null && typeof person.personId === 'string' && person.personId !== '')
    return person.personId;
  return userInfo().username;
}
