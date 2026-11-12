import { homedir } from 'node:os';

import type { Command } from 'commander';

import type { BoardGroup, BoardRow } from '@memnox/core';

import type { CliContext } from '../cli-context';
import { TONE } from '../flow';
import { readSessionBoard } from '../session-tools/session-board-read';
import { describeCount } from '../plural';

/**
 * `memnox sessions`: every session on this machine, grouped by what it needs, with what needs
 * a person first. The same board the console, the Mac app and the phone draw.
 */

interface SessionsOptions {
  json?: boolean;
}

export function registerSessionsCommand(
  program: Command,
  context: CliContext,
  home: () => string = homedir,
  now: () => Date = () => new Date(),
): void {
  program
    .command('sessions')
    .description('Every session, grouped by what it needs from you')
    .option('--json', 'machine-readable output')
    .action(async (options: SessionsOptions) => {
      const board = await readSessionBoard(home(), now());
      if (options.json === true) {
        context.out.json(board);
        return;
      }
      render(context, board);
    });
}

function render(context: CliContext, board: readonly BoardGroup[]): void {
  const { flow } = context;
  flow.open('memnox sessions');
  if (board.length === 0) {
    flow.close('No session in the last day.');
    return;
  }
  for (const group of board) {
    flow.list(
      `${group.label} · ${group.rows.length}`,
      group.rows.map((row) => ({
        tone: row.reason === undefined ? TONE.PLAIN : TONE.WARN,
        text: lineOf(row),
        detail: [row.reasonLabel, row.task],
      })),
    );
  }
  const total = board.reduce((sum, group) => sum + group.rows.length, 0);
  flow.close(`${describeCount(total, 'session')}.`);
  const waiting = board.find((group) => group.rows.some((row) => row.waiting > 0));
  if (waiting !== undefined) flow.hint('Answer what is held with "memnox approvals".');
}

function lineOf(row: BoardRow): string {
  const place = row.place === undefined ? '' : `  ${row.place}`;
  return `${row.agent}${place}  ${row.sessionId}`;
}
