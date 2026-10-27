import { join } from 'node:path';
import { JsonRecordDir, MEMNOX_HOME } from '@memnox/core';

/**
 * The sign ins the person was offered and has not finished, each with what they asked for, so the
 * voice carries on with it the moment they are signed in rather than making them say it twice.
 */

const SIGN_INS_DIR = 'sign-ins';

export interface PendingSignIn {
  toolkit: string;
  /** What the person said that needed this tool, asked again once they are signed in. */
  said?: string;
  /** Signing in again, after the last sign in reached somebody else's account. */
  again?: boolean;
  at: string;
}

export class PendingSignIns {
  private readonly records: JsonRecordDir<PendingSignIn>;

  constructor(home: string) {
    this.records = new JsonRecordDir(join(home, MEMNOX_HOME, SIGN_INS_DIR));
  }

  /**
   * One per tool. Offering it again keeps the words first asked, since what is said while signing in
   * is about the sign in, and carrying that on would answer the wrong thing.
   */
  async offer(signIn: PendingSignIn): Promise<void> {
    const earlier = await this.records.read(signIn.toolkit);
    const said = earlier?.said ?? signIn.said;
    await this.records.write(signIn.toolkit, {
      ...signIn,
      ...(said === undefined ? {} : { said }),
    });
  }

  read(toolkit: string): Promise<PendingSignIn | null> {
    return this.records.read(toolkit);
  }

  all(): Promise<PendingSignIn[]> {
    return this.records.all();
  }

  async settle(toolkit: string): Promise<void> {
    await this.records.remove(toolkit);
  }
}
