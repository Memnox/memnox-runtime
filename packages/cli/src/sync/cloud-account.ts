import { MACHINE } from '../this-machine';

/**
 * Connecting an app or working in one through Memnox Cloud needs a signed in Memnox Cloud account,
 * so these are the cloud's code for a caller with none and the words each surface says for it.
 */

/** The cloud's code for a caller signed in to no Memnox Cloud account, which connecting or acting in an app needs. */
export const ACCOUNT_REQUIRED = 'account_required';

/** What the voice and an agent both say first, so the person hears the same reason whoever is asking. */
const NEEDS_AN_ACCOUNT = `Connecting their apps and working in them needs a Memnox Cloud account, and nobody is signed in on this ${MACHINE}.`;

/** For the voice: connecting or acting in their own apps needs a Memnox Cloud account, and nobody is signed in here. */
export const VOICE_SIGN_IN_FIRST = `${NEEDS_AN_ACCOUNT} Say so in a sentence and offer to sign them in; once they say yes, call memnox_sign_in, then ask again once they have approved.`;

/** For a working agent: the same reason, and the person signs in themselves, since an agent signs in nobody. */
export const AGENT_SIGN_IN_FIRST = `${NEEDS_AN_ACCOUNT} Tell your person so in a sentence: they sign in to Memnox Cloud from the Memnox app's Account page, and you call this again once they have. Never connect the app some other way.`;

/** For a screen: the same, as words the person reads beside the sign in button. */
export const SIGN_IN_TO_CONNECT =
  'Sign in to Memnox Cloud to connect your apps. Your account is what connects them and what works in them as you.';
