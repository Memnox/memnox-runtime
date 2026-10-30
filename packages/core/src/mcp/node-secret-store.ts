import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { MEMNOX_HOME } from '../config/config';
import { isKeptSecretName } from './secret-ref';

/**
 * MCP credentials in the OS store: the macOS keychain, the Linux Secret Service, or a Windows
 * DPAPI file. A value only ever reaches a tool's stdin, since arguments are readable by every process.
 */

export interface SecretStore {
  get(name: string): Promise<string | undefined>;
  set(name: string, value: string): Promise<void>;
  remove(name: string): Promise<void>;
}

/** The service every secret is filed under, so Memnox's entries are findable and only Memnox's. */
export const SECRET_SERVICE = 'memnox-mcp';

/** Long enough for a keychain unlock prompt, short enough that a server start never hangs on it. */
const STORE_TIMEOUT_MS = 30_000;

const DPAPI_DIR = 'secrets';
const DPAPI_SUFFIX = '.dpapi';

export interface RunResult {
  code: number;
  stdout: string;
}

/** Runs one tool with optional stdin; injected so a test never touches a real keychain. */
export type StoreRunner = (
  command: string,
  args: readonly string[],
  input?: string,
) => Promise<RunResult>;

export function nodeSecretStore(
  home: string,
  platform: NodeJS.Platform = process.platform,
  run: StoreRunner = runTool,
): SecretStore {
  if (platform === 'darwin') return new KeychainStore(run);
  if (platform === 'win32')
    return new DpapiStore(join(home, MEMNOX_HOME, DPAPI_DIR), run);
  return new SecretServiceStore(run);
}

function checked(name: string): string {
  // The name reaches a tool's arguments and, on Windows, a file name, so it is checked first.
  if (!isKeptSecretName(name))
    throw new Error(`${name} is not a secret name Memnox can keep`);
  return name;
}

/** The `security` tool's own quoting, so a value with a quote in it stays one argument. */
function securityQuoted(text: string): string {
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

class KeychainStore implements SecretStore {
  constructor(private readonly run: StoreRunner) {}

  async get(name: string): Promise<string | undefined> {
    const result = await this.run('/usr/bin/security', [
      'find-generic-password',
      '-s',
      SECRET_SERVICE,
      '-a',
      checked(name),
      '-w',
    ]);
    return result.code === 0 ? result.stdout.replace(/\n$/, '') : undefined;
  }

  async set(name: string, value: string): Promise<void> {
    // Interactive mode reads the command from stdin, which keeps the value out of argv.
    const line = `add-generic-password -U -s ${SECRET_SERVICE} -a ${checked(name)} -w ${securityQuoted(value)}\n`;
    const result = await this.run('/usr/bin/security', ['-i'], line);
    if (result.code !== 0) throw new Error(`the keychain did not keep ${name}`);
  }

  async remove(name: string): Promise<void> {
    // Removing what is not there is the outcome asked for, so its exit code is not read.
    await this.run('/usr/bin/security', [
      'delete-generic-password',
      '-s',
      SECRET_SERVICE,
      '-a',
      checked(name),
    ]);
  }
}

class SecretServiceStore implements SecretStore {
  constructor(private readonly run: StoreRunner) {}

  async get(name: string): Promise<string | undefined> {
    const result = await this.run('secret-tool', [
      'lookup',
      'service',
      SECRET_SERVICE,
      'account',
      checked(name),
    ]);
    return result.code === 0 && result.stdout !== ''
      ? result.stdout.replace(/\n$/, '')
      : undefined;
  }

  async set(name: string, value: string): Promise<void> {
    const args = [
      'store',
      `--label=Memnox ${checked(name)}`,
      'service',
      SECRET_SERVICE,
      'account',
      name,
    ];
    const result = await this.run('secret-tool', args, value);
    if (result.code !== 0) throw new Error(`the Secret Service did not keep ${name}`);
  }

  async remove(name: string): Promise<void> {
    await this.run('secret-tool', [
      'clear',
      'service',
      SECRET_SERVICE,
      'account',
      checked(name),
    ]);
  }
}

/** PowerShell reads the path and the value from stdin, one per line, so neither is in argv. */
const DPAPI_WRITE =
  '$p=[Console]::In.ReadLine();$v=[Console]::In.ReadToEnd();' +
  'New-Item -ItemType Directory -Force -Path (Split-Path $p) | Out-Null;' +
  'ConvertTo-SecureString $v -AsPlainText -Force | ConvertFrom-SecureString | Set-Content -Path $p';

const DPAPI_READ =
  '$p=[Console]::In.ReadLine();if(-not(Test-Path $p)){exit 3};' +
  '$s=Get-Content -Path $p | ConvertTo-SecureString;' +
  '[Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))';

const DPAPI_REMOVE =
  '$p=[Console]::In.ReadLine();Remove-Item -Force -ErrorAction SilentlyContinue -Path $p';

const POWERSHELL = ['-NoProfile', '-NonInteractive', '-Command'];

class DpapiStore implements SecretStore {
  constructor(
    private readonly dir: string,
    private readonly run: StoreRunner,
  ) {}

  private pathOf(name: string): string {
    return join(this.dir, `${checked(name)}${DPAPI_SUFFIX}`);
  }

  async get(name: string): Promise<string | undefined> {
    const result = await this.run(
      'powershell.exe',
      [...POWERSHELL, DPAPI_READ],
      `${this.pathOf(name)}\n`,
    );
    return result.code === 0 ? result.stdout.replace(/\r?\n$/, '') : undefined;
  }

  async set(name: string, value: string): Promise<void> {
    const result = await this.run(
      'powershell.exe',
      [...POWERSHELL, DPAPI_WRITE],
      `${this.pathOf(name)}\n${value}`,
    );
    if (result.code !== 0) throw new Error(`Windows did not keep ${name}`);
  }

  async remove(name: string): Promise<void> {
    await this.run(
      'powershell.exe',
      [...POWERSHELL, DPAPI_REMOVE],
      `${this.pathOf(name)}\n`,
    );
  }
}

function runTool(
  command: string,
  args: readonly string[],
  input?: string,
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(command, [...args], {
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: STORE_TIMEOUT_MS,
    });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    // A tool that is not installed is a store that holds nothing, which the caller reports.
    child.on('error', () => resolve({ code: -1, stdout: '' }));
    child.on('close', (code) => resolve({ code: code ?? -1, stdout }));
    child.stdin.end(input ?? '');
  });
}
