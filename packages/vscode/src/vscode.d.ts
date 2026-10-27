// The few VS Code API types this extension uses, so it needs no @types/vscode dependency.
declare module 'vscode' {
  export interface Uri {
    readonly path: string;
    readonly query: string;
  }
  export interface Disposable {
    dispose(): unknown;
  }
  export interface Terminal {
    readonly processId: PromiseLike<number | undefined>;
    /** Set once the terminal's process has ended. */
    readonly exitStatus: { readonly code: number | undefined } | undefined;
    show(preserveFocus?: boolean): void;
    sendText(text: string, shouldExecute?: boolean): void;
    dispose(): void;
  }
  export interface UriHandler {
    handleUri(uri: Uri): unknown;
  }
  export interface ExtensionContext {
    readonly subscriptions: Disposable[];
  }
  export interface TerminalOptions {
    name?: string;
    cwd?: string;
  }
  export namespace window {
    const terminals: readonly Terminal[];
    function createTerminal(options: TerminalOptions): Terminal;
    function registerUriHandler(handler: UriHandler): Disposable;
  }
}
