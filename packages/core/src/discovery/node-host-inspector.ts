import { execFile } from 'node:child_process';
import { open, realpath } from 'node:fs/promises';
import { HOST_SIGNATURE, type HostInspector, type HostSignature } from './agent-host';

/** Long enough for codesign on a cold disk, short enough that a scan never hangs on it. */
const CODESIGN_TIMEOUT_MS = 3_000;

/** `Authority=Developer ID Application: Example Inc (TEAMID)`, the leaf of the chain. */
const AUTHORITY = /^Authority=(.+)$/m;
const AD_HOC = /^Signature=adhoc$/m;
const NOT_SIGNED = /not signed at all/;

/**
 * Asks the platform who signed a binary. Only macOS has a signer to ask here; elsewhere
 * the answer is unknown rather than unsigned, since nothing was checked.
 */
export class NodeHostInspector implements HostInspector {
  constructor(private readonly platform: NodeJS.Platform = process.platform) {}

  async inspect(path: string): Promise<HostSignature> {
    let target: string;
    try {
      // An npm bin is a symlink into the package; the file it points at is what runs.
      target = await realpath(path);
    } catch {
      return { state: HOST_SIGNATURE.UNKNOWN };
    }
    if (await isScript(target)) return { state: HOST_SIGNATURE.SCRIPT };
    if (this.platform !== 'darwin') return { state: HOST_SIGNATURE.UNKNOWN };
    return parseCodesign(await codesignOutput(target));
  }
}

/** What `codesign -dv` printed, which it prints on stderr whether or not it succeeded. */
export function parseCodesign(output: string | null): HostSignature {
  if (output === null) return { state: HOST_SIGNATURE.UNKNOWN };
  if (NOT_SIGNED.test(output)) return { state: HOST_SIGNATURE.UNSIGNED };
  if (AD_HOC.test(output)) return { state: HOST_SIGNATURE.AD_HOC };
  const authority = AUTHORITY.exec(output)?.[1];
  return authority === undefined
    ? { state: HOST_SIGNATURE.UNKNOWN }
    : { state: HOST_SIGNATURE.SIGNED, signer: authority.trim() };
}

function codesignOutput(path: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      '/usr/bin/codesign',
      ['-dv', '--verbose=2', path],
      { timeout: CODESIGN_TIMEOUT_MS },
      (error, stdout, stderr) => {
        const text = `${stdout}${stderr}`;
        // An unsigned binary exits non-zero and still says so, which is an answer.
        resolve(text.trim() === '' && error !== null ? null : text);
      },
    );
  });
}

async function isScript(path: string): Promise<boolean> {
  try {
    const handle = await open(path, 'r');
    try {
      const head = Buffer.alloc(2);
      await handle.read(head, 0, 2, 0);
      return head.toString('latin1') === '#!';
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}
