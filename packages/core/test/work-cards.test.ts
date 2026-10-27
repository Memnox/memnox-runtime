import { describe, expect, it } from 'vitest';
import { WORK_DRAFT_KIND, workDraftOf } from '../src/daemon/work-cards';

describe('drawing a draft the way its tool draws it', () => {
  it('lays a calendar event out with its times and its attendees', () => {
    const draft = workDraftOf('googlecalendar', 'GOOGLECALENDAR_CREATE_EVENT', {
      summary: 'Design review',
      start_datetime: '2026-10-24T10:00:00',
      end_datetime: '2026-10-24T10:30:00',
      attendees: ['ana@example.com', 'li@example.com'],
      timezone: 'Europe/Paris',
    });
    expect(draft.kind).toBe(WORK_DRAFT_KIND.EVENT);
    expect(draft.starts).toBe('2026-10-24T10:00:00');
    expect(draft.ends).toBe('2026-10-24T10:30:00');
    expect(draft.to).toEqual(['ana@example.com', 'li@example.com']);
    expect(draft.subject).toBe('Design review');
    expect(draft.fields).toEqual([{ name: 'timezone', value: 'Europe/Paris' }]);
  });

  it('lays a Notion page out as a page, its title and its words', () => {
    const draft = workDraftOf('notion', 'NOTION_CREATE_NOTION_PAGE', {
      title: 'Launch notes',
      markdown: 'Ship on Friday',
      parent_id: 'abc',
    });
    expect(draft.kind).toBe(WORK_DRAFT_KIND.PAGE);
    expect(draft.subject).toBe('Launch notes');
    expect(draft.body).toBe('Ship on Friday');
  });

  it('keeps a start argument among the fields where the draft is no event', () => {
    const draft = workDraftOf('linear', 'LINEAR_CREATE_LINEAR_ISSUE', {
      title: 'Bug',
      start_date: '2026-11-01',
    });
    expect(draft.kind).toBe(WORK_DRAFT_KIND.ISSUE);
    expect(draft.starts).toBeUndefined();
    expect(draft.fields).toEqual([{ name: 'start_date', value: '2026-11-01' }]);
  });
});
