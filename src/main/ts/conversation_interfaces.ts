import { GameData } from "../../shared/gameData/GameData";
import type { SpokenUtterance, RecipientRendering } from '../language';

export interface Message {
    id?: string;
    role: 'system' | 'user' | 'assistant';
    type?: string;
    name?: string,
    content: string ;
    narrative?: string; // Narrative property
    characterId?: number;
    /** Observed encounter date for this turn; memory must not move old private intentions to a later day. */
    gameDate?: string;
    actions?: ActionResponse[];
    /** Explicit supported choice on ingress; the recorded utterance pins it thereafter. */
    spokenLanguageId?: string;
    /** Explicit backend choice for deliberately unaccommodated native speech. */
    languageAccommodation?: 'none';
    /** Spoken while language routing was disabled; never reinterpret it on re-enable. */
    languageRoutingBypassed?: true;
    speechSpans?: readonly import('../../shared/language/speechSpans').SpeechSpan[];
    /** Explicit source protocol, pinned before generation. Never guess it from old NPC prose. */
    proseEncoding?: 'controls-v1';
    utterance?: SpokenUtterance;
    recipientRenderings?: Record<string, RecipientRendering>;
    /** Canonical backend record. Shared variants, small per-listener references. Never expose in prompts/UI. */
    languageRecord?: import('../language/languageConversation').HearingRecord;
    /** Presence at this turn, including shared physical/action events. */
    observedByCharacterIds?: number[];
    /** A projected receiver copy must never be encoded a second time. */
    perceivedByCharacterId?: number;
    /** Human literary reads may include private narration; character work must use knowledge. */
    perceptionPurpose?: 'knowledge' | 'reader';
    perceivedSpeechSpans?: readonly import('../../shared/language/speechSpans').SpeechSpan[];
    /** Only delivered opaque ranges; never original words, mask owners or eligibility reasons. */
    perceivedOpaqueSpeechSpans?: readonly import('../../shared/language/speechSpans').SpeechSpan[];
    speechComprehension?: 'clear' | 'partial' | 'unintelligible';
    /** Projected mixed speech only: distinguishes the surrounding tongue from an embedded echo. */
    primarySpeechComprehension?: 'clear' | 'partial' | 'unintelligible';
    /** Delivered private ranges available only to their author; prompt framing consumes them. */
    perceivedPrivateSpans?: readonly import('../../shared/language/speechSpans').SpeechSpan[];
    /** Player editor text uses delivered words, never the untranslated source. */
    editableContent?: string;
    comprehensionMode?: import('../language').ComprehensionMode;
}


export interface ErrorMessage {
    text: string,
}

export interface MessageChunk {
    role?: 'system' | 'user' | 'assistant' | 'tool';
    content?: string | null | undefined;
    isFinal?: boolean;
    special?: any;
}

export interface Preset {
    systemPrompt: string;
    inputSequence: string;
    outputSequence: string;
}

export interface Setting {
    mainPrompt: string,
    inputSequence: string,
    outputSequence: string,
    parameters: Object;
}

export interface Summary{
    date: string,
    content: string,
    /** Timeline v2 protocol: checkpoint epoch / node id stamped on summaries written after a close. */
    votcCheckpointEpoch?: number,
    votcTimelineNodeId?: string,
    characterId?: string;
}

export interface ActionArgument{
    name: string;
    type: string;
    desc: string
}

export interface Action{
    signature: string,
    args: ActionArgument[],
    description: string,
    creator?: string,
    check: (gameData: GameData, sourceId: number, targetId: number) => boolean,
    preCheck?: (gameData: GameData, args: string[], sourceId: number, targetId: number) => { success: boolean, message?: string },
    run: (gameData: GameData, runGameEffect: (effect: string) => void, args: string[], sourceId: number, targetId: number) => void,
    chatMessage: (args: string[]) => any,
    chatMessageClass: string
}

export interface ActionResponse{
    actionName: string,
    chatMessage: string,
    chatMessageClass: string
}

export interface PendingAction {
    action: Action;
    args: string[];
    sourceId: number;
    targetId: number;
}
