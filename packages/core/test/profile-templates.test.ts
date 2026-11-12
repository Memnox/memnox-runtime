import { describe, expect, it } from 'vitest';
import {
  DISCOVERED_AGENT_KIND,
  draftFromTemplate,
  PROFILE_TEMPLATES,
  templateNamed,
} from '../src/index';

/**
 * A template is a job with no agent behind it: it names only agents a scan can find, carries no
 * activity, and copies its job into a profile with only the skills a person took.
 */

const DETECTABLE: readonly string[] = Object.values(DISCOVERED_AGENT_KIND);

describe('profile templates', () => {
  it('are the seven job descriptions, each naming only agents a scan can find', () => {
    expect(PROFILE_TEMPLATES.map((each) => each.name)).toEqual([
      'Software Development',
      'Code Review',
      'Testing',
      'Documentation',
      'Research',
      'Customer Support',
      'Operations Assistant',
    ]);
    for (const template of PROFILE_TEMPLATES) {
      expect(
        template.suggestedConnections.every((each) => DETECTABLE.includes(each)),
      ).toBe(true);
      expect(Object.keys(template)).not.toContain('connections');
      expect(Object.keys(template)).not.toContain('activity');
    }
  });

  it('copy the job and only the suggested skills a person took', () => {
    const template = templateNamed('Code Review');
    expect(template?.id).toBe('code-review');
    if (template === undefined) return;
    const draft = draftFromTemplate(template, { skills: ['review', 'deploy'] });
    expect(draft).toEqual({
      name: 'Code Review',
      purpose: template.purpose,
      role: 'reviewer',
      responsibilities: template.responsibilities,
      skills: ['review'],
      templateOf: 'code-review',
    });
    expect(draftFromTemplate(template, {}).skills).toEqual([]);
  });
});
