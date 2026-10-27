import { minutesToMs } from '@memnox/core';
import { readAddress, readOwner } from '../operator/owner';

/**
 * How often the voice may call the person by title or by name. The model is told "not in every
 * reply" and says it in every reply anyway, so once they were addressed, the words are taken out
 * of what the voice says next for a while rather than left to the model.
 */

/** How long one "sir" lasts before another sounds natural rather than scripted. */
const TITLE_GAP_MS = minutesToMs(5);
/** A name said often sounds like a sales call, so it waits far longer than the title. */
const NAME_GAP_MS = minutesToMs(30);

/** One way of addressing them, and how long it rests once said. */
interface AddressForm {
  words: string;
  gapMs: number;
}

export class AddressLimit {
  private readonly saidAt = new Map<string, number>();

  constructor(private readonly home: string) {}

  /** Every way the voice may address them: the title they chose, then their name. */
  async names(): Promise<AddressForm[]> {
    const [title, name] = [await readAddress(this.home), await readOwner(this.home)];
    return addressForms(title, name);
  }

  /** The phrases to take out of the next reply: every form said within its own gap. */
  unsaid(forms: readonly AddressForm[], moment: string): string[] {
    const now = Date.parse(moment);
    return forms
      .filter((form) => now - (this.saidAt.get(form.words) ?? -Infinity) < form.gapMs)
      .flatMap((form) => [`, ${form.words}`, `${form.words}, `]);
  }

  noteSaid(answered: string, forms: readonly AddressForm[], moment: string): void {
    for (const form of forms)
      if (answered.includes(form.words)) this.saidAt.set(form.words, Date.parse(moment));
  }

  /** The Mac answered their call with the title or the name, so the first reply says neither again. */
  noteCalled(forms: readonly AddressForm[], moment: string): void {
    for (const form of forms) this.saidAt.set(form.words, Date.parse(moment));
  }
}

/** A name that matches the title is one form, resting as long as a name does. */
export function addressForms(
  title: string | undefined,
  name: string | undefined,
): AddressForm[] {
  const forms: AddressForm[] = [];
  if (title !== undefined && title !== name)
    forms.push({ words: title, gapMs: TITLE_GAP_MS });
  if (name !== undefined) forms.push({ words: name, gapMs: NAME_GAP_MS });
  return forms;
}
