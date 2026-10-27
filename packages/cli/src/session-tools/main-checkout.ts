import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * The checkout a person has open in their editor for a folder an agent worked in: the
 * repository root rather than a subfolder, and the main checkout rather than a worktree an
 * agent made for itself, since opening either of those makes the editor a new empty window.
 */

/** What a worktree's own `.git` file points through on its way back to the main repository. */
const WORKTREES = '/.git/worktrees/';

export function mainCheckoutOf(folder: string): string {
  let current = folder;
  while (true) {
    const marker = join(current, '.git');
    if (existsSync(marker))
      return statSync(marker).isFile() ? throughWorktree(marker, current) : current;
    const parent = dirname(current);
    // Reached the top without a repository, so the folder itself is the best there is.
    if (parent === current) return folder;
    current = parent;
  }
}

/** A worktree's `.git` is a file naming `<main>/.git/worktrees/<name>`, and `<main>` is the checkout. */
function throughWorktree(marker: string, root: string): string {
  const pointer = /^gitdir:\s*(.+)$/m.exec(readFileSync(marker, 'utf8'))?.[1]?.trim();
  if (pointer === undefined) return root;
  const at = pointer.indexOf(WORKTREES);
  return at === -1 ? root : pointer.slice(0, at);
}
