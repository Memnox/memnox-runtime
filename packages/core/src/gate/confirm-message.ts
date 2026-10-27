/**
 * What gets signed, apart from the key store so a screen that only signs imports it without Node. The subject is a
 * proposal or pending id, so an old signature confirms nothing new. Rewritten words go last and whole, and addresses
 * rewritten on a mail just before them, since an address never holds a colon and words may.
 */
export function confirmationMessage(
  subject: string,
  answer: string,
  edited?: string,
  editedTo?: string,
): string {
  if (editedTo !== undefined)
    return `memnox-confirm:v3:${subject}:${answer}:${editedTo}:${edited ?? ''}`;
  if (edited === undefined) return `memnox-confirm:v1:${subject}:${answer}`;
  return `memnox-confirm:v2:${subject}:${answer}:${edited}`;
}
