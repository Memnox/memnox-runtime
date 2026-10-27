/** Where a workspace lives unless somebody says otherwise, apart from `connect` so a read needs none of it. */
export const DEFAULT_BASE_URL = 'https://api.memnox.com';

/** Names another control plane for a Mac acting with no account, as a test or a self hosted deployment does. */
const CLOUD_URL_VAR = 'MEMNOX_CLOUD_URL';

/** The control plane a personal space registers with when no account names one. */
export function defaultBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const named = env[CLOUD_URL_VAR]?.trim();
  return named === undefined || named === '' ? DEFAULT_BASE_URL : named;
}
