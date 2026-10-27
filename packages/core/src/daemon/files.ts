/**
 * The part of the daemon protocol that lists a folder under the person's home, so a phone browses
 * the Mac by names and sizes without the brain or the screen. Nothing in a file ever travels.
 */

export const ENTRY_KIND = {
  FOLDER: 'folder',
  FILE: 'file',
} as const;

export type EntryKind = (typeof ENTRY_KIND)[keyof typeof ENTRY_KIND];

/** One entry of a folder as FILES_LIST answers it: its name and what it is, never what is in it. */
export interface FileEntry {
  name: string;
  kind: EntryKind;
  /** A file's size; absent on a folder. */
  bytes?: number;
  /** When it last changed, ISO 8601. */
  modified?: string;
}

export interface FilesRequestFields {
  /** On FILES_LIST: the folder relative to the person's home; absent lists the home itself. */
  path?: string;
}

export interface FilesResponseFields {
  /** On FILES_LIST: the folder listed, relative to the person's home and empty for the home itself. */
  path?: string;
  /** On FILES_LIST: folders first and then files, each by name, hidden entries left out. */
  files?: FileEntry[];
}
