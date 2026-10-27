import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { commandTree } from '../src/help';
import { voicePrompt } from '../src/operator/voice-prompts';
import { voiceCommand } from '../src/session-tools/voice-commands';

describe('everything memnox does, by voice', () => {
  it('lists every command and subcommand, one line each, with its flags', () => {
    const program = new Command('memnox');
    const task = program.command('task').description('What an agent was asked');
    task
      .command('set <statement>')
      .description('Declare it')
      .option('--paths <globs>', 'where')
      .option('--json', 'machine-readable output');
    task.command('show').description('The task standing');
    program.command('help').description('help');
    expect(commandTree(program)).toEqual([
      'task: What an agent was asked',
      'task set <statement>: Declare it (--paths)',
      'task show: The task standing',
    ]);
  });

  it('hands the brain the whole catalogue, so it never says it cannot do what a command does', () => {
    const prompt = voicePrompt(
      [],
      undefined,
      'freeze [subject]: Stop external-state actions',
    );
    expect(prompt).toContain('freeze [subject]: Stop external-state actions');
    expect(prompt).toContain('Never say you cannot do something one of these does');
  });

  it('waits for Touch ID on a subcommand that writes under a command that reads', () => {
    expect(voiceCommand('task show')?.run).toBe('now');
    expect(voiceCommand('task set "ship the voice"')?.run).toBe('confirm');
    expect(voiceCommand('task clear')?.run).toBe('confirm');
    expect(voiceCommand('repo list')?.run).toBe('now');
    expect(voiceCommand('repo trust ./clone')?.run).toBe('confirm');
    expect(voiceCommand('budget list')?.run).toBe('now');
    expect(voiceCommand('budget set daily --limit 50')?.run).toBe('confirm');
    expect(voiceCommand('policy check --prune')?.run).toBe('confirm');
    expect(voiceCommand('agents status claude-code')?.run).toBe('now');
    expect(voiceCommand('allow --list')?.run).toBe('now');
    expect(voiceCommand('allow git.push --for 1h')?.run).toBe('confirm');
  });
});

describe('a person correcting themselves as they speak', () => {
  it('has the brain act only on what they kept, and pass the corrected words to an agent', () => {
    const prompt = voicePrompt([], undefined, '');
    expect(prompt).toContain('what they take back is gone');
    expect(prompt).toContain('push to the release branch');
    expect(prompt).toContain('leave out what they took back');
  });
});
