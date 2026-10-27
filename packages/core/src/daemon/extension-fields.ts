import type { AgentQuestionItem } from '../session/agent-questions';
import type { ConnectionsRequestFields, ConnectionsResponseFields } from './connections';
import type { FilesRequestFields, FilesResponseFields } from './files';
import type { HomeResponseFields } from './home';
import type { InterceptRequestFields, InterceptResponseFields } from './intercept';
import type {
  RemoteEventFields,
  RemoteRequestFields,
  RemoteResponseFields,
} from './remote';
import type { SpeechRequestFields, SpeechResponseFields } from './speech';
import type { SpokenRuleRequestFields, SpokenRuleResponseFields } from './spoken-rule';
import type { TeamAnswerBrief, TeamCallBrief } from './team-calls';
import type { SignedIn, ToolSignIn, WorkDraft } from './work-cards';

/**
 * The fields each part of the protocol adds, gathered in one place so the core protocol reads as
 * its own few methods and a new part is one line here rather than a longer list there.
 */

interface TeamRequestFields {
  /** On ASK from a device signed in to its team: the team's questions waiting on the person. */
  teamCalls?: TeamCallBrief[];
}

interface TeamEventFields {
  /** On a PROPOSAL answering a team's question, which the device carries out with the workspace. */
  teamAnswer?: TeamAnswerBrief;
}

interface WorkRequestFields {
  /** On CONFIRM of a draft: the words the person rewrote on its card, which the signature then covers. */
  edited?: string;
  /** On CONFIRM of a mail: the addresses the person typed on its card, joined by commas, which the signature covers too. */
  editedTo?: string;
}

interface QuestionRequestFields {
  /** On CONFIRM of an agent's question: which of its questions the answer is for, from one. */
  questionNumber?: number;
}

interface QuestionEventFields {
  /** On a question NOTICE: what the agent asked with its choices, so a notch or a phone offers them as taps. */
  questions?: AgentQuestionItem[];
  /** On a question NOTICE: what is already picked, by question text, so a surface asks only what is left. */
  answers?: Record<string, string>;
}

interface AccountRequestFields {
  /** On PERSON_SIGN_IN: the Mac app's own waiting device code, so one approval signs both in. */
  companionOf?: string;
}

interface WorkEventFields {
  /** On a PROPOSAL to act in one of the person's tools, what goes out, drawn the way that tool draws it. */
  work?: WorkDraft;
  /** On SIGN_IN, the tools the person asked for and has not signed in to, each with its page. */
  signIn?: ToolSignIn[];
  /** On a PROPOSAL that an account is the person's own, answered from the signed in pill. */
  claim?: { toolkit: string; label: string };
  /** On a SIGNED_IN or SIGN_IN_STALLED notice, which tool, as whom, and what to carry on with. */
  signedIn?: SignedIn;
}

export interface ExtensionRequestFields
  extends
    RemoteRequestFields,
    FilesRequestFields,
    SpeechRequestFields,
    TeamRequestFields,
    WorkRequestFields,
    AccountRequestFields,
    QuestionRequestFields,
    ConnectionsRequestFields,
    InterceptRequestFields,
    SpokenRuleRequestFields {}

export interface ExtensionResponseFields
  extends
    RemoteResponseFields,
    FilesResponseFields,
    SpeechResponseFields,
    HomeResponseFields,
    ConnectionsResponseFields,
    InterceptResponseFields,
    SpokenRuleResponseFields {}

export interface ExtensionEventFields
  extends RemoteEventFields, TeamEventFields, WorkEventFields, QuestionEventFields {}
