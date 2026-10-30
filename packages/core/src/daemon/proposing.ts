import { AGENTS_METHOD } from './agents-view';
import { BACKUP_METHOD } from './backup';
import { INDEX_METHOD } from './community-index';
import { HOME_METHOD } from './home';
import { LAN_METHOD } from './lan';
import { MCP_HUB_METHOD } from './mcp-hub';
import { MEMORY_METHOD } from './memory';
import { PERSONAL_SYNC_METHOD } from './personal-sync';
import { POLICY_METHOD } from './policies';
import { PROFILES_METHOD } from './profiles';
import { PROJECTS_METHOD } from './projects';
import { SKILLS_METHOD } from './skills-hub';
import { SPOKEN_RULE_METHOD } from './spoken-rule';

/**
 * Every method whose answer can name a proposal, in `proposed`, `packProposed`, `profileApplied.proposed`
 * or `indexInstalled.proposed`, so a screen counts only these as presses and a background read never
 * makes a proposal nobody asked for wait. The daemon's dispatch is checked against it in the CLI's tests.
 */
export const PROPOSING_METHODS: readonly string[] = [
  HOME_METHOD.HAND_OVER,
  SPOKEN_RULE_METHOD.RULE,
  MCP_HUB_METHOD.SERVER_PUT,
  MCP_HUB_METHOD.ASSIGN,
  POLICY_METHOD.RULE_PROPOSE,
  POLICY_METHOD.RULE_REMOVE,
  POLICY_METHOD.RULE_PACK_IMPORT,
  AGENTS_METHOD.AGENT_RESUME,
  AGENTS_METHOD.AGENT_LAUNCH,
  SKILLS_METHOD.SKILL_IMPORT,
  SKILLS_METHOD.SKILL_PUT,
  SKILLS_METHOD.SKILL_ASSIGN,
  SKILLS_METHOD.SKILL_ACCEPT,
  SKILLS_METHOD.SKILL_ROLLBACK,
  PROJECTS_METHOD.PROJECT_OPEN,
  PROJECTS_METHOD.PROJECT_APPLY,
  BACKUP_METHOD.BACKUP_RESTORE,
  MEMORY_METHOD.MEMORY_CONFIRM,
  LAN_METHOD.LAN_SET,
  PERSONAL_SYNC_METHOD.PERSONAL_SYNC_KEY_OFFER,
  PERSONAL_SYNC_METHOD.PERSONAL_SYNC_KEY_ACCEPT,
  PROFILES_METHOD.PROFILE_APPLY,
  INDEX_METHOD.INDEX_INSTALL,
  INDEX_METHOD.INDEX_SOURCE_SET,
];
