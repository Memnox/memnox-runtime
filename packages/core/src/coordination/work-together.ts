/**
 * The workspace found this person's agent and somebody else's on one feature and introduced
 * them, which the person is told once, quietly: the agents already talk, so it needs nobody.
 */

/** What the workspace stream names the event, on the wire. */
export const WORK_TOGETHER_EVENT = 'work.together';

interface Member {
  agent: string;
  ownerName?: string;
  ownerPersonId?: string;
  doing?: string;
}

/** The sentence the notch shows, or null for anything not whole or nobody else on it. */
export function describeTogether(data: unknown, personId: string): string | null {
  if (data === null || typeof data !== 'object') return null;
  // Checked for an object just above; every field is narrowed before use.
  const given = data as Record<string, unknown>;
  const name = given['featureName'];
  const members = Array.isArray(given['members'])
    ? given['members'].flatMap(memberOf)
    : [];
  if (typeof name !== 'string') return null;
  const theirs = members.filter((member) => member.ownerPersonId !== personId);
  const mine = members.filter((member) => member.ownerPersonId === personId);
  if (theirs.length === 0) return null;
  const others = theirs
    .map((member) => {
      const whose = member.ownerName === undefined ? '' : `${member.ownerName}'s `;
      const doing = member.doing === undefined ? '' : `, ${member.doing}`;
      return `${whose}${member.agent}${doing}`;
    })
    .join('; ');
  const yours = mine[0] === undefined ? 'your agent' : `your ${mine[0].agent}`;
  return `${others}: working on ${name} with ${yours}. They are talking to each other directly and will bring you in if they need you.`;
}

function memberOf(value: unknown): Member[] {
  if (value === null || typeof value !== 'object') return [];
  // Checked for an object just above.
  const { agent, ownerName, ownerPersonId, doing } = value as Record<string, unknown>;
  if (typeof agent !== 'string') return [];
  return [
    {
      agent,
      ...(typeof ownerName === 'string' ? { ownerName } : {}),
      ...(typeof ownerPersonId === 'string' ? { ownerPersonId } : {}),
      ...(typeof doing === 'string' ? { doing } : {}),
    },
  ];
}
