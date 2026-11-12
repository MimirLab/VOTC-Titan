import { launcherScenesEnabled } from '../scenes/launcherSceneRuntime';
import {nativeLoreChatEnabled,completeNativeLoreChat,NativeLoreChatReply} from '../lorebook/lorebookNativeChat';
import type {NativeLoreCapture,NativeLoreContext} from '../lorebook/lorebookNativeContext';
import { PerspectiveSummaries } from '../language/perspectiveSummaries';
import { closeCheckpointReceiptEffect, ownsCloseCommand, waitForCloseCheckpoint } from './closeCheckpoint';
import type { PerceptionPurpose } from '../language/languageConversation';
import { ResponseProseEncoding, repairControlledPhoneticGaps, repairControlledPrivateClauses, validateControlledSourceSpeech, validateControlledSpeechLabels } from '../language/controlledWriter';
import { appendPrivateNarration, collectPrivateNarration, compactedMemoryText } from '../language/privateMemory';
import { visibleCompactedMemories } from '../language/compactedMemoryScope';
import { ControlledProseError, parseControlledProse, normalizeControlledProseFormatting } from '../../shared/language/controlledProse';
import { loadLedgerHistory, saveLedgerHistory, saveLedgerCheckpoint } from '../language/ledgerStorage';
import { currentGoaCatalog } from '../goa/goaRuntime';
import { runActionWithScenePolicy, waitForSceneSelection, sceneUiState } from '../scenes/sceneRuntime';
import { captureRoleplayEncounter, captureCurrentLanguages, prepareRoleplayBackground, beginCultureForeground } from '../culture/cultureRuntime';
import { currentLoreMutationCatalog } from '../lorebook/loreMutationRuntime';
import { currentLoreGameStateCatalog } from '../lorebook/loreGameStateRuntime';
import { ceCommandFile } from '../ceBridge';
import { currentDialogueCaptureCatalog, invalidateDialogueIdentities } from '../dialogue/dialogueRuntime';
import { LanguageConversation, projectRecordedMessage, characterLanguages, markLanguageRoutingBypassed, languageRoutingEnabled,
    bindLanguageSnapshot, defaultLanguageEngine, languageCaptureEnabled, currentLanguageCaptureCatalog, knownLanguages, selectSpokenLanguage,
    clearLanguageObservations, SPEECH_WRITER_INSTRUCTION, ConversationLedger, validateLedger } from '../language';

import { app } from 'electron';
import { GameData } from '../../shared/gameData/GameData.js';
import { Character } from '../../shared/gameData/Character.js';
import { ChatWindow } from '../windows/ChatWindow.js';
import { RunFileManager } from '../RunFileManager.js';
import { SummaryFileWatcher } from './SummaryFileWatcher.js';
import { LetterManager } from '../letter/LetterManager.js';
import { Letter as ILetter } from '../letter/letterInterfaces.js';
import { Config } from '../../shared/Config.js';
import { ApiConnection, isAbortError} from '../../shared/apiConnection.js';
import { checkActions } from './checkActions.js';
import { convertChatToText, buildChatPrompt, buildSummarizeChatPrompt, buildResummarizeChatPrompt, convertChatToTextNoNames, getEffectivePrompts, convertMessagesToString} from './promptBuilder.js';
import { generateSuggestions } from './suggestionBuilder.js';
import { developmentCaptureEnabled, currentDevelopment } from '../development/developmentRuntime';
import { generateSceneDescription } from './sceneDescriptionBuilder.js';
import { generateNarrative } from './generateNarrative.js';
import { cleanMessageContent } from './messageCleaner.js';
import { DiaryGenerator } from '../diary/DiaryGenerator.js';
import { readDiaryFile, saveDiaryFile, readDiarySummaries, saveDiarySummaries } from '../diaryManager.js';
import fs from 'fs';
import path from 'path';
import { generationFailure } from './generationFailure';
import { randomUUID } from 'crypto';
import { cleanAudioMessage, splitAudioMetadata, rememberAudioCues } from '../audio/audioDirections';
import { enqueueConversationAudio, invalidateConversationAudio } from '../audio/AudioRuntime';
import {Message, MessageChunk, ErrorMessage, Summary, Action, ActionResponse, PendingAction} from '../ts/conversation_interfaces.js';
import { parseGameDate } from '../../shared/dateUtils.js';
import { listPromptTranscriptFiles } from '../conversationHistory.js';
// Summaries are filtered by epoch/node at read time (summaryManager.readSummaryFile),
// which is non-destructive: an older save hides later summaries and loading the
// newer save shows them again. Archiving them out of the summary file is
// therefore deliberately NOT wired here — archiveFutureSummaryFilesForPlayer has
// no readopt path yet, so moving records would lose them for good on a
// load-old-then-load-new round trip.
import { getSimilarity } from '../../shared/stringUtils.js';
import { formatActionNotice } from './actionNotice';
import { MemoryCompactor } from './MemoryCompactor.js';
import { compactedMemoryStore } from '../compactedMemoryStore.js';
import { ActionEffectWriter } from './ActionEffectWriter.js';
import { Tiktoken } from "js-tiktoken";
import { readCharacterMap, filterSummariesForCheckpoint } from '../summaryManager.js';
import { conversationHistoryDir as campaignConversationHistoryDir } from '../campaignDataPaths.js';
import {
    TimelineParentNotFoundError,
    TimelineRegistryCorruptError,
    TimelineRegistry,
    buildContextFromGameData,
    isRecordVisibleForContext,
    type CreateChildNodeResult
} from '../timelineManager.js';
import { loadCampaignStore } from '../campaignBusiness.js';
import { UnsupportedTimelineSchemaError } from '../../shared/gameData/timelineProtocol.js';
import { requireCampaignIdentity, CampaignIdentityUnavailableError } from '../campaignIdentityResolver.js';
import { reportCampaignIdentityUnavailable, reportCorruptTimelineRegistry, reportTimelineParentNotFound, reportUnsupportedTimelineSchema } from '../timelineRegistryRecovery.js';
import { runConversationTimelineTransition } from '../timelineBusinessWire.js';

// Fallback close effect used when the timeline transition fails: closes the
// CK3 conversation window WITHOUT advancing checkpoint state. Mirrors the
// 1.x CLOSE_CONVERSATION_ONLY_EFFECT ('trigger_event = talk_event.9002'),
// adapted to the 2CE mod's close event id.
const CLOSE_CONVERSATION_ONLY_EFFECT = 'trigger_event = mcc_event_v2.9002';
import { MemoryManager, Memory } from '../memoryManager.js';
import { CompactedMemory, CompactedMemoryScope } from '../../shared/compactionTypes.js';
import { EmbeddingProvider, getEffectiveEmbeddingDimension } from '../../shared/apiConnection.js';

function getTranslations(lang: string): any {
    const localePath = path.join(app.getAppPath(), 'public', 'locales', `${lang}.json`);
    try {
        if (fs.existsSync(localePath)) {
            return JSON.parse(fs.readFileSync(localePath, 'utf-8'));
        }
    } catch (error) {
        console.error(`Error reading locale file for ${lang}:`, error);
    }
    // Fallback to English
    const fallbackLocalePath = path.join(app.getAppPath(), 'public', 'locales', `en.json`);
    return JSON.parse(fs.readFileSync(fallbackLocalePath, 'utf-8'));
}

export class Conversation{
    votcDataPath: string;
    chatWindow: ChatWindow;
    isOpen: boolean;
    gameData: GameData;
    messages: Message[];
    notSpokenYetText: string;
    description: string;
    config: Config;
    runFileManager!: RunFileManager;
    textGenApiConnection: ApiConnection;
    summarizationApiConnection: ApiConnection;
    diaryGenerator!: DiaryGenerator;
    actionsApiConnection: ApiConnection;
    actions!: Action[];
    summaries: Map<number, Summary[]>;
    currentSummary: string;
    private languageConversation?: LanguageConversation;
    private encounterLedger?: ConversationLedger;
    private perspectiveSummaries?: PerspectiveSummaries;
    private summaryPreparationTimer?: ReturnType<typeof setTimeout>;
    private summaryOperation?: Promise<void>;
    private closingWorkCount = 0;
    private compactorReleaseRequested = false;
    /** Main owns this guard; a superseded close must not write into the next encounter's game scopes. */
    closeEffectAllowed?: () => boolean;
    private recipientCurrentSummaries = new Map<number, string>();
    summaryFileWatcher: SummaryFileWatcher; // 文件监控器
    letterManager: LetterManager;
    letters: Map<number, ILetter[]>;
    consecutiveActionsCount: number; // Track consecutive responses with actions
    lastActionMessageIndex: number; // Track the last message index that had actions
    historicalConversations!: Array<{date: string, scene: string, location: string, characters: string[], messages: Message[]}>; // Store historical conversation metadata
    actionInvolvedCharacterIds: Set<number>;
    translations: any;
    pendingActions: Map<string, PendingAction[]>;
    executedActions: Map<string, ActionResponse[]>;
    currentTurnTriggeredActions: Set<string>;

    npcQueue: Character[];
    customQueue: Character[] | null;
    isPaused: boolean;
    aiToAiTurnLimit: number = 0;
    persistCustomQueue: boolean;
    isGenerating: boolean;
    abortController: AbortController | null;
    isGeneratingScene: boolean;
    pendingPlayerRequest: boolean;
    encoder: Tiktoken | null;

    // §4.1: immutable campaign/player identity captured at conversation start.
    // Undefined when the mod snapshot carries no v2 campaign id (legacy Mod);
    // the conversation window still opens for display, but summarize() fails
    // closed instead of writing timeline records.
    campaignIdentity: import('../../shared/gameData/CampaignIdentity.js').CampaignPlayerIdentity | undefined;

    // Read-time timeline context for branch filtering of summaries and
    // transcripts. Resolved lazily on first use; null marks "resolved to
    // nothing" so we do not retry a failed/costly load every read. Only
    // populated for v2 mod sessions (campaignIdentity present); legacy mod
    // sessions keep the pre-timeline always-visible behavior.
    private timelineReadContext: { registry: TimelineRegistry; currentNodeId?: string } | null | undefined;

    // Characters for which the branch-hidden summary count was already
    // logged, so the visibility message appears once per conversation.
    private branchFilterLogged: Set<number> = new Set();

    // §9.3 P5.4 fix C1: requestKey UUID reused across retries of the same
    // close attempt; cleared when the close reaches terminal state.
    private currentCloseRequestKey: string | undefined;


    memoryManager: MemoryManager;
    embeddingApiConnection!: ApiConnection;

    /** Fired (fire-and-forget) after new memories are inserted into the vector store. */
    public onMemoriesEmbedded?: () => void;


    constructor(gameData: GameData, config: Config, chatWindow: ChatWindow, votcDataPath: string, encoder: Tiktoken | null, memoryManager?: MemoryManager){
        this.encoder = encoder;
        console.log('Conversation initialized.');
        console.log(`[Conversation.ts CONSTRUCTOR] Initializing with scene: '${gameData.scene}'`);
        this.votcDataPath = votcDataPath;
        this.config = config;
        this.chatWindow = chatWindow;
        this.chatWindow.conversation = this;
        this.isOpen = true;
        this.gameData = gameData;
        this.messages = [];
        this.currentSummary = "";
        this.config = config;

        // Load translations
        const lang = this.config.language || 'en';
        this.translations = getTranslations(lang);
        this.notSpokenYetText = this.translations.chat.not_spoken || "Has not spoken yet";

        this.runFileManager = new RunFileManager(this.config.userFolderPath);
        this.description = "";
        this.actions = [];

        this.runFileManager = new RunFileManager(this.config.userFolderPath);
        this.description = "";
        this.actions = [];

        // If character count is greater than 2, create empty messages for all non-player characters.
        if (gameData.characters.size > 2) {
            console.log(`Creating initial messages for ${gameData.characters.size - 1} non-player characters.`);
            gameData.characters.forEach((character) => {
                if (character.id !== gameData.playerID) {
                    const emptyMessage: Message = {
                        role: "assistant",
                        type: 'placeholder',
                        name: character.shortName,
                        content: this.notSpokenYetText,
                        characterId: character.id
                    };
                    this.messages.push(emptyMessage);
                    console.log(`Created empty message for character: ${character.shortName}`);
                }
            });
        }

        this.summaries = new Map<number, Summary[]>();
        this.summaryFileWatcher = new SummaryFileWatcher(); // Initialize file watcher
        this.letterManager = LetterManager.getInstance();
        this.letters = new Map<number, ILetter[]>();
        this.consecutiveActionsCount = 0; // Initialize consecutive actions counter
        this.lastActionMessageIndex = -1; // Initialize last action message index
        this.historicalConversations = []; // Initialize historical conversations array

        this.npcQueue = [];
        this.customQueue = null;
        this.isPaused = false;
        this.persistCustomQueue = false;
        this.actionInvolvedCharacterIds = new Set();
        this.isGenerating = false;
        this.abortController = null;
        this.pendingActions = new Map();
        this.executedActions = new Map();
        this.currentTurnTriggeredActions = new Set<string>();
        this.isGeneratingScene = false;
        this.pendingPlayerRequest = false;

        const diariesBasePath = path.join(this.votcDataPath, 'diary_history');
        if (!fs.existsSync(diariesBasePath)) {
            fs.mkdirSync(diariesBasePath, { recursive: true });
        }
        const playerDiariesPath = path.join(diariesBasePath, this.gameData.playerID.toString());
        if (!fs.existsSync(playerDiariesPath)) {
            fs.mkdirSync(playerDiariesPath, { recursive: true });
        }

        // §4.1, §9: capture immutable identity at conversation start. If the
        // snapshot has a v2 campaign id, timeline writes at close time are
        // possible. If not (legacy Mod), keep the player-only display paths;
        // summarize() will fail closed if a timeline write is attempted.
        try {
            this.campaignIdentity = requireCampaignIdentity({
                playerID: this.gameData.playerID,
                timelineSnapshotResult: this.gameData.timelineSnapshotResult
            });
        } catch (error) {
            if (error instanceof CampaignIdentityUnavailableError) {
                // Report but do not crash the conversation window; the close
                // path falls back to the close-only effect.
                reportCampaignIdentityUnavailable(error);
            } else {
                throw error;
            }
        }

        // Create/Update character map for the current player in the conversation_summaries folder
        // This is the critical fix for the history loading on first run.
        const summaryMapPath = path.join(this.votcDataPath, 'conversation_summaries', this.gameData.playerID.toString(), '_character_map.json');
        let characterMap: { [key: string]: string } = {};
        if (fs.existsSync(summaryMapPath)) {
            try {
                characterMap = JSON.parse(fs.readFileSync(summaryMapPath, 'utf8'));
            } catch (e) {
                console.error(`Error parsing summary character map file, it will be overwritten: ${e}`);
            }
        }
        // Add/update all characters from current gameData, but do not overwrite existing entries.
        // This preserves the original names from when characters were first encountered, which is
        // crucial for parsing historical logs where names/titles may have been different.
        this.gameData.characters.forEach((character) => {
            if (!characterMap[character.id.toString()]) {
                characterMap[character.id.toString()] = character.fullName;
            }
        });
        // Ensure the directory exists before writing
        const summaryDir = path.dirname(summaryMapPath);
        if (!fs.existsSync(summaryDir)) {
            fs.mkdirSync(summaryDir, { recursive: true });
        }
        fs.writeFileSync(summaryMapPath, JSON.stringify(characterMap, null, '\t'));
        console.log(`Character map for summaries updated at ${summaryMapPath}`);

        // Also update the diary character map for consistency
        const diaryMapPath = path.join(playerDiariesPath, '_character_map.json');
        fs.writeFileSync(diaryMapPath, JSON.stringify(characterMap, null, '\t'));
        console.log(`Character map for diaries updated at ${diaryMapPath}`);

        const summariesBasePath = path.join(this.votcDataPath, 'conversation_summaries');
        if (!fs.existsSync(summariesBasePath)){
            fs.mkdirSync(summariesBasePath);
            console.log('Created conversation_summaries directory.');
        }

        const playerSummaryPath = path.join(summariesBasePath, this.gameData.playerID.toString());
        if (!fs.existsSync(playerSummaryPath)){
            fs.mkdirSync(playerSummaryPath);
            console.log(`Created player-specific summary directory for player ID: ${this.gameData.playerID}`);
        }

        // Load summaries for all non-player characters. The full set is kept
        // in memory (and rewritten verbatim when new summaries are appended):
        // this.summaries is the persistence source of truth, so filtering
        // other-branch records out of it would silently erase them from disk
        // on the next save. Branch filtering happens at prompt-consumption
        // time instead — see getBranchVisibleSummaries().
        this.gameData.characters.forEach((character) => {
            if (character.id !== this.gameData.playerID) {
                const summaryFilePath = path.join(playerSummaryPath, `${character.id.toString()}.json`);
                let characterSummaries: Summary[] = [];
                if (fs.existsSync(summaryFilePath)) {
                    try {
                        characterSummaries = JSON.parse(fs.readFileSync(summaryFilePath, 'utf8'));
                        characterSummaries.sort((a: any, b: any) => {
                            const dateA = parseGameDate(a.date)?.getTime() ?? 0;
                            const dateB = parseGameDate(b.date)?.getTime() ?? 0;
                            return dateB - dateA;
                        });
                        console.log(`Loaded and sorted ${characterSummaries.length} prior summaries for AI ID ${character.id} from ${summaryFilePath}.`);
                    } catch (e) {
                        console.error(`Error parsing summary file for AI ID ${character.id}: ${e}`);
                    }
                } else {
                    fs.writeFileSync(summaryFilePath, JSON.stringify([], null, '\t'));
                    console.log(`No prior summaries found for AI ID ${character.id}. Initialized empty summaries file at ${summaryFilePath}.`);
                }
                this.summaries.set(character.id, characterSummaries);

                // Set up file watching to automatically reload when the file changes.
                this.summaryFileWatcher.watchFile(summaryFilePath, (updatedSummaries: Summary[]) => {
                    this.summaries.set(character.id, updatedSummaries);
                    console.log(`Automatically reloaded summaries for character ID ${character.id} due to file change`);
                });

                const characterLetters = this.letterManager.getLetters(String(this.gameData.playerID), String(character.id));
                this.letters.set(character.id, characterLetters);
                console.log(`Loaded ${characterLetters.length} letters for AI ID ${character.id}.`);
            }
        });

        if (languageCaptureEnabled()) {
            const playerSummaryFile = path.join(playerSummaryPath, `${this.gameData.playerID}.json`);
            let playerSummaries: Summary[] = [];
            try { if (fs.existsSync(playerSummaryFile)) playerSummaries = JSON.parse(fs.readFileSync(playerSummaryFile, 'utf8')); }
            catch { /* Keep malformed legacy data untouched. */ }
            this.summaries.set(this.gameData.playerID, playerSummaries);
            this.summaryFileWatcher.watchFile(playerSummaryFile, updated => this.summaries.set(this.gameData.playerID, updated));
        }
        this.config = config;

        this.messages.forEach(msg => {
            if (msg.content === "Has not spoken yet") {
                msg.content = this.notSpokenYetText;
                const character = Array.from(this.gameData.characters.values()).find(c => c.shortName === msg.name);
                if (character) {
                    (msg as any).characterId = character.id;
                }
            }
        });

        this.runFileManager = new RunFileManager(config.userFolderPath);
        this.actions = [];

        // Assign API connections directly to class properties
        if (!this.config.textGenerationApiConnectionConfig) {
            console.error("CRITICAL: textGenerationApiConnectionConfig is missing from config! A dummy object has been created to prevent a crash, but the configuration is likely invalid.");
            this.config.textGenerationApiConnectionConfig = {
                connection: {
                    type: 'custom',
                    baseUrl: '',
                    key: '',
                    model: '',
                    apiKeys: {},
                    forceInstruct: false,
                    overwriteContext: false,
                    customContext: 0,
                } as any,
                parameters: {}
            };
        }
        if (!this.config.summarizationApiConnectionConfig) {
            console.error("CRITICAL: summarizationApiConnectionConfig is missing from config! A dummy object has been created to prevent a crash, but the configuration is likely invalid.");
            this.config.summarizationApiConnectionConfig = {
                connection: {
                    type: 'custom',
                    baseUrl: '',
                    key: '',
                    model: '',
                    apiKeys: {},
                    forceInstruct: false,
                    overwriteContext: false,
                    customContext: 0,
                } as any,
                parameters: {}
            };
        }
        if (!this.config.actionsApiConnectionConfig) {
            console.error("CRITICAL: actionsApiConnectionConfig is missing from config! A dummy object has been created to prevent a crash, but the configuration is likely invalid.");
            this.config.actionsApiConnectionConfig = {
                connection: {
                    type: 'custom',
                    baseUrl: '',
                    key: '',
                    model: '',
                    apiKeys: {},
                    forceInstruct: false,
                    overwriteContext: false,
                    customContext: 0,
                } as any,
                parameters: {}
            };
        }
        this.textGenApiConnection = new ApiConnection(this.config.textGenerationApiConnectionConfig.connection, this.config.textGenerationApiConnectionConfig.parameters, this.encoder);
        this.summarizationApiConnection = this.config.summarizationUseTextGenApi
            ? new ApiConnection(this.config.textGenerationApiConnectionConfig.connection, this.config.summarizationApiConnectionConfig.parameters, this.encoder)
            : new ApiConnection(this.config.summarizationApiConnectionConfig.connection, this.config.summarizationApiConnectionConfig.parameters, this.encoder);
        this.actionsApiConnection = this.config.actionsUseTextGenApi
            ? new ApiConnection(this.config.textGenerationApiConnectionConfig.connection, this.config.actionsApiConnectionConfig.parameters, this.encoder)
            : new ApiConnection(this.config.actionsApiConnectionConfig.connection, this.config.actionsApiConnectionConfig.parameters, this.encoder);


        this.loadConfig();

        // Sanitize messages to remove any historical placeholders that may have leaked in.
        const currentCharacterIds = new Set(Array.from(this.gameData.characters.keys()));
        this.messages = this.messages.filter(msg => {
            const msgCharId = (msg as any).characterId;
            // Keep user messages (no characterId) or messages for characters in the current conversation.
            return !msgCharId || currentCharacterIds.has(msgCharId);
        });
        console.log(`Sanitized messages array. Kept ${this.messages.length} messages for current conversation characters.`);

        this.checkForSummariesFromOtherPlayers();

        // Initialize diary generator
        this.diaryGenerator = new DiaryGenerator(this.config, this.votcDataPath, this.encoder);

        // Initialize Memory Systems.
        // Reuse the shared MemoryManager injected from main.ts (a second instance
        // against the same SQLite file was the VOTC deadlock suspect). The fallback
        // only exists for tests that construct Conversation directly.
        this.memoryManager = memoryManager ?? new MemoryManager(this.votcDataPath, getEffectiveEmbeddingDimension(this.config?.embeddingApiConnectionConfig?.connection));
        this.memoryCompactor = new MemoryCompactor(this.config);
    }



    private sceneRefreshPending = false;
    private sceneRequestAbort: AbortController | null = null;

    private encounterLifetime = new AbortController();
    private encounterCapture: Promise<boolean> = Promise.resolve(false);
    private capturedParticipants = new Set<number>();
    private backgroundWarningShown = false;
    private languageFactRefresh?: Promise<void>;

    /** Current conversion, doctrine and private training facts are read before new dialogue, not remembered as exposure. */
    private async refreshCurrentLanguageFacts(signal: AbortSignal): Promise<void> {
        const refreshLanguages = languageCaptureEnabled() && languageRoutingEnabled(this.config) &&
            (defaultLanguageEngine().relations.practiceRules.length > 0 || !!currentLanguageCaptureCatalog()?.captureStudy);
        if (!currentGoaCatalog() && !refreshLanguages && !currentDialogueCaptureCatalog() && !developmentCaptureEnabled() && !(currentLoreMutationCatalog() || currentLoreGameStateCatalog()) && !launcherScenesEnabled()) return;
        if (this.languageFactRefresh) return this.languageFactRefresh;
        const task = (async () => {
            await this.encounterCapture;
            signal.throwIfAborted();
            const participants = [...this.gameData.characters.values()];
            if (refreshLanguages) {
                clearLanguageObservations();
                for (const participant of participants) { delete participant.languageSnapshot; delete participant.learning; }
            }
            invalidateDialogueIdentities(participants.map(participant => participant.id));
            const complete = await captureCurrentLanguages(participants, signal, this.gameData);
            signal.throwIfAborted();
            if (!languageCaptureEnabled() || !languageRoutingEnabled(this.config)) return;
            if (!complete || participants.some(participant => !bindLanguageSnapshot(participant)))
                throw new Error('Current language and familiarity capture is not available for this dialogue.');
        })();
        this.languageFactRefresh = task;
        try { await task; }
        finally { if (this.languageFactRefresh === task) this.languageFactRefresh = undefined; }
    }

    /** Cancels only this conversation's capture/readiness, retaining anonymous shared profiles. */
    public cancelBackgroundPreparation(): void { this.encounterLifetime.abort(); }

    private async ensureBackgroundReady(character: Character): Promise<void> {
        const signal = this.abortController?.signal
            ? AbortSignal.any([this.abortController.signal, this.encounterLifetime.signal])
            : this.encounterLifetime.signal;
        signal.throwIfAborted();
        const openingCaptured = await this.encounterCapture;
        if (!openingCaptured || !this.capturedParticipants.has(character.id)) {
            await captureRoleplayEncounter([character], signal, this.gameData);
            this.capturedParticipants.add(character.id);
        }
        await this.refreshCurrentLanguageFacts(signal);
        if (languageCaptureEnabled()) {
            const participants = [...this.gameData.characters.values()];
            if (participants.some(participant => !bindLanguageSnapshot(participant)))
                await captureRoleplayEncounter(participants, signal, this.gameData);
            if (participants.some(participant => !bindLanguageSnapshot(participant)))
                throw new Error('Complete native and learned language capture is not available for this encounter.');
        }
        let waiting = false;
        try {
            const result = await prepareRoleplayBackground(character, signal, () => {
                waiting = true;
                this.chatWindow.window.webContents.send('status-update', 'chat.status_preparing_background');
            });
            if (result !== 'ready' && !this.backgroundWarningShown) {
                this.backgroundWarningShown = true;
                this.chatWindow.window.webContents.send('error-message',
                    'Culture or faith context is not ready (' + result + '). This reply will continue with the available character context.');
            }
        } finally {
            if (waiting) this.chatWindow.window.webContents.send('status-update', '');
        }
    }

    private warmBackgroundProfiles(): void {
        // No model calls on cache hits. Errors are surfaced only if an actual reply must wait.
        for (const id of this.capturedParticipants) {
            const character = this.gameData.characters.get(id);
            if (character) void prepareRoleplayBackground(character, this.encounterLifetime.signal, undefined, false).catch(() => {});
        }
    }

    public async initialize(): Promise<void> {
        // Load compacted memories from disk to restore state
        if (this.config.enableMemoryCompaction) {
            await this.memoryCompactor.loadFromDisk(String(this.gameData.playerID), this.gameData.date);
        }

        const participants = [this.gameData.getAi(), this.gameData.getPlayer(), ...this.gameData.characters.values()]
            .filter((character, index, list) => character && list.findIndex(c => c?.id === character.id) === index).slice(0, 16);
        participants.forEach(c => this.capturedParticipants.add(c.id));
        // Reserve the profile lane until the optional narrator has finished its existing prompt.
        const releaseIntro = this.config.generateSceneDescription ? beginCultureForeground() : () => {};
        this.encounterCapture = captureRoleplayEncounter(participants, this.encounterLifetime.signal, this.gameData)
            .catch(error => { if (!isAbortError(error)) console.warn('Encounter capture unavailable.'); return false; });
        if (!this.config.generateSceneDescription) void this.encounterCapture.then(() => this.warmBackgroundProfiles());

        // If scene description generation is enabled, generate it at the start of the conversation.
        // Detached (not awaited) so the chat UI becomes interactive immediately; the renderer
        // already tolerates late 'scene-description' events, and failures degrade gracefully.
        if (this.config.generateSceneDescription) {
            void this.generateSceneDescription(true).finally(() => { releaseIntro(); this.warmBackgroundProfiles(); }).catch(err => {
                console.error('Scene description generation failed (non-fatal):', err);
            });
        }

        // If auto-generate suggestions is enabled, generate them at the start of the conversation.
        if (this.config.autoGenerateSuggestions) {
            // If scene description generation is also enabled, it will trigger suggestion generation after completion.
            if (!this.config.generateSceneDescription) {
                // If scene description generation is not enabled, generate suggestions directly.
                void this.encounterCapture.then(async () => {
                    await prepareRoleplayBackground(this.gameData.getAi(), this.encounterLifetime.signal);
                    if (this.isOpen) await this.generateInitialSuggestions();
                }).catch(err => {
                    console.error('Failed to generate initial suggestions:', err);
                });
            }
        }
        void this.initiateConversation().catch(err => {
            console.error('Failed to initiate conversation:', err);
        });
    }

    /**
     * Branch-filtered view of one character's summaries for prompt feeding.
     * The underlying this.summaries set stays complete (it is rewritten
     * verbatim when new summaries are saved); filtering here means hidden
     * other-branch records survive on disk and reappear when their branch
     * is loaded again. Returns the full set for legacy mod sessions.
     */
    getBranchVisibleSummaries(characterId: number): Summary[] {
        const all = this.summaries.get(characterId) || [];
        const campaignSummaries = all.filter(summary => !summary.votcCampaignId ||
            summary.votcCampaignId === this.campaignIdentity?.campaignId);
        const context = this.resolveTimelineReadContext();
        if (!context) {
            return campaignSummaries;
        }
        const visible = filterSummariesForCheckpoint(campaignSummaries, this.gameData.votcCheckpointEpoch)
            .filter((summary) => isRecordVisibleForContext(
                context.registry,
                context.currentNodeId,
                summary,
                this.gameData.votcCheckpointEpoch
            ));
        const hiddenCount = all.length - visible.length;
        if (hiddenCount > 0 && !this.branchFilterLogged.has(characterId)) {
            this.branchFilterLogged.add(characterId);
            console.log(`Timeline visibility hid ${hiddenCount} of ${all.length} summaries for AI ID ${characterId} (other branches or campaigns).`);
        }
        return visible;
    }

    public getCompactedMemoryScope(): CompactedMemoryScope | undefined {
        if (!this.campaignIdentity) return;
        if (this.campaignIdentity.playerId !== String(this.gameData.playerID)) throw new Error('Compacted-memory campaign owner mismatch');
        return { version: 1, campaignId: this.campaignIdentity.campaignId, encounterId: this.ledger().id };
    }

    /** Complete records stay in the compactor; only the current branch supplies model context. */
    public filterCompactedMemoriesForRead(memories: readonly CompactedMemory[]): CompactedMemory[] {
        const context = memories.some(memory => memory.scope?.timelineNodeId !== undefined) ? this.resolveTimelineReadContext() : null;
        return visibleCompactedMemories(memories, { campaignId: this.campaignIdentity?.campaignId,
            encounterId: this.encounterLedger?.id, gameDate: this.gameData.date,
            registry: context?.registry, currentNodeId: context?.currentNodeId,
            checkpointEpoch: this.gameData.votcCheckpointEpoch });
    }

    public getCompactedMemoriesForRecipient(characterId: number): CompactedMemory[] {
        return this.filterCompactedMemoriesForRead(this.memoryCompactor?.getCompactedMemories(String(characterId)) ?? []);
    }

    /**
     * Resolve the campaign timeline registry + current node for read-time
     * branch filtering (summaries, prompt transcripts). Returns null for
     * legacy mod sessions (no campaignIdentity) and on load failure, where
     * the caller must keep pre-timeline always-visible behavior. The result
     * is cached for the lifetime of the conversation; a null result is also
     * cached so a failed load is not retried on every read.
     */
    private resolveTimelineReadContext(): { registry: TimelineRegistry; currentNodeId?: string } | null {
        if (this.timelineReadContext !== undefined) {
            return this.timelineReadContext;
        }
        if (!this.campaignIdentity) {
            this.timelineReadContext = null;
            return null;
        }
        try {
            const context = buildContextFromGameData(this.gameData);
            const loadResult = loadCampaignStore(app.getPath('userData'), this.campaignIdentity);
            if (loadResult.status === 'found') {
                this.timelineReadContext = { registry: loadResult.store, currentNodeId: context.timelineNodeId };
            } else if (loadResult.status === 'missing') {
                // Fresh campaign: no graph yet. Stamped records cannot belong
                // to this campaign and are hidden; unstamped legacy records
                // stay visible through the epoch/empty-node-id paths.
                this.timelineReadContext = { registry: new TimelineRegistry(String(this.gameData.playerID)), currentNodeId: context.timelineNodeId };
            } else {
                console.error(`[Conversation] Campaign timeline registry corrupt at ${loadResult.filePath}; skipping branch filtering of summaries/transcripts.`);
                this.timelineReadContext = null;
            }
        } catch (error) {
            console.error('[Conversation] Failed to resolve timeline read context; skipping branch filtering:', error);
            this.timelineReadContext = null;
        }
        return this.timelineReadContext;
    }

    public async loadHistory(): Promise<void> {
        if (!this.config.showPreviousConversations || this.config.disableHistoricalConversations) {
            console.log('Historical conversation loading is disabled.');
            return;
        }

        const historyDir = path.join(this.votcDataPath, 'conversation_history', this.gameData.playerID.toString());
        if (!fs.existsSync(historyDir)) {
            return;
        }

        const allCharacterIds = Array.from(this.gameData.characters.keys());
        // Load up to the history-window limit: the window renders all of
        // these, while the prompt path re-slices to maxHistoricalConversations
        // in withLimitedHistory(). The timeline read context scopes tagged
        // transcripts to the current branch (sibling-branch conversations are
        // hidden, exactly like the history viewer).
        const timelineReadContext = this.resolveTimelineReadContext();
        const historyFiles = await listPromptTranscriptFiles(
            this.gameData.playerID.toString(),
            allCharacterIds,
            this.config.maxConversationsInHistoryWindow,
            this.gameData.votcCheckpointEpoch,
            this.campaignIdentity,
            timelineReadContext?.registry,
            timelineReadContext?.currentNodeId
        );

        this.chatWindow.window.webContents.send('historical-conversations-loading', true);

        const globalCharacterMap = await readCharacterMap(this.votcDataPath, this.gameData.playerID.toString());
        const initialBatch: any[] = [];
        const remainingFiles: any[] = [];
        const INITIAL_BATCH_SIZE = 3; // Using 3 as requested for the initial synchronous load.
        let validConversationsFound = 0;

        for (const fileInfo of historyFiles) {
            // This loop correctly stops collecting files once the total number of *valid* conversations
            // (those with actual dialogue) reaches the user's configured limit.
            if (validConversationsFound >= this.config.maxConversationsInHistoryWindow) {
                console.log(`Reached window history limit of ${this.config.maxConversationsInHistoryWindow}. Stopping file processing.`);
                break;
            }

            // Each file is parsed to check for content *before* it is counted.
            const parsedConv = await this._parseHistoryFile(fileInfo, historyDir, globalCharacterMap);

            if (parsedConv) {
                // This is a valid conversation. It will be added to either the initial sync batch
                // or the async batch.
                if (initialBatch.length < INITIAL_BATCH_SIZE) {
                    initialBatch.push(parsedConv);
                } else {
                    // Files for async loading are collected here.
                    remainingFiles.push(fileInfo);
                }
                validConversationsFound++;
            }
        }

        // The initial batch is newest-to-oldest.
        this.historicalConversations = initialBatch;
        console.log(`Loaded initial batch of ${this.historicalConversations.length} historical conversations.`);

        // This will be sent to the renderer in the main 'chat-start' payload.
        // Now, start loading the rest in the background.
        this._loadRemainingHistory(remainingFiles, historyDir, globalCharacterMap);
    }

    private _loadRemainingHistory(files: any[], historyDir: string, globalCharacterMap: Map<string, string>): void {
        console.log(`Starting to load ${files.length} remaining historical conversations in the background.`);
        if (files.length === 0) {
            this.chatWindow.window.webContents.send('historical-conversations-loading', false);
            return;
        }

        const BATCH_SIZE = 3;
        let fileIndex = 0;

        const processNextBatch = async () => {
            if (fileIndex >= files.length) {
                this.chatWindow.window.webContents.send('historical-conversations-loading', false);
                console.log('Finished loading all remaining historical conversations.');
                return;
            }

            const batchFiles = files.slice(fileIndex, fileIndex + BATCH_SIZE);
            fileIndex += BATCH_SIZE;

            const loadedConvs: any[] = [];
            for (const fileInfo of batchFiles) {
                const parsedConv = await this._parseHistoryFile(fileInfo, historyDir, globalCharacterMap);
                if (parsedConv) {
                    loadedConvs.push(parsedConv);
                }
            }

            if (loadedConvs.length > 0) {
                // Append the older conversations to the main history array
                this.historicalConversations.push(...loadedConvs);
                // Send the newly loaded conversations to the UI to be prepended.
                this.chatWindow.window.webContents.send('historical-conversations-update', loadedConvs);
                console.log(`Asynchronously loaded and sent a batch of ${loadedConvs.length} historical conversations.`);
            }

            // Schedule the next batch without blocking the main thread
            setTimeout(processNextBatch, 1000);
        };

        // Start the process
        processNextBatch();
    }

    private async _parseHistoryFile(fileInfo: { fileName: string; sourceDir?: string }, historyDir: string, globalCharacterMap: Map<string, string>): Promise<any | null> {
        const filePath = path.join(fileInfo.sourceDir ?? historyDir, fileInfo.fileName);
        try {
            const canonical = loadLedgerHistory(fileInfo.sourceDir ?? historyDir, path.basename(filePath, '.txt'), this.gameData.playerID, historyDir, 'reader');
            if (canonical) return { date: canonical.date, scene: canonical.scene ?? '', location: canonical.location ?? '',
                characters: [...new Set(canonical.messages.map(message => message.name).filter(Boolean))], messages: canonical.messages };
            const content = fs.readFileSync(filePath, 'utf8');
            const lines = content.split('\n');

            let currentDate = this.gameData.date;
            let currentScene = "";
            let currentLocation = "";
            const fileMessages: Message[] = [];
            const characterNames: string[] = [];
            let currentMessage: Message | null = null;

            const narrativeLabels = { en: "[Narrative]:", zh: "[旁白]:", ru: "[Повествование]:", fr: "[Récit]:", es: "[Narrativa]:", de: "[Erzählung]:", ja: "[ナラティブ]:", ko: "[내레이션]:", pl: "[Narracja]:", pt: "[Narrativa]:" };
            const narrativeRegex = new RegExp(`^(${Object.values(narrativeLabels).map(v => v.replace(/[\[\]:]/g, '\\$&')).join('|')})`);
            const actionLabel = getEffectivePrompts(this.config, this.votcDataPath, this.gameData)?.actionTriggeredPrompt || "\\[Action Triggered\\]:";
            const actionRegex = new RegExp(`^${actionLabel.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\s*(.*)`);

            const historyCharacterIds = fileInfo.fileName.split('_').slice(0, -1);
            const historicalSpeakerNames = new Set<string>();
            historyCharacterIds.forEach((id: string) => {
                const charFromCurrentData = this.gameData.characters.get(parseInt(id, 10));
                if (charFromCurrentData) {
                    historicalSpeakerNames.add(charFromCurrentData.fullName);
                    historicalSpeakerNames.add(charFromCurrentData.shortName);
                }
                const historicalName = globalCharacterMap.get(id);
                if (historicalName) historicalSpeakerNames.add(historicalName);
            });
            historicalSpeakerNames.add(this.gameData.playerName);
            const uniqueSpeakerNames = [...historicalSpeakerNames].filter(Boolean);
            const speakerRegex = new RegExp(`^(${uniqueSpeakerNames.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}):`);

            for (let line of lines) {
                if (line.startsWith('Date:')) { currentDate = line.replace('Date:', '').trim(); continue; }
                if (line.startsWith('Scene:')) { currentScene = line.replace('Scene:', '').trim(); continue; }
                if (line.startsWith('Location:')) { currentLocation = line.replace('Location:', '').trim(); continue; }

                const narrativeMatch = line.match(narrativeRegex);
                if (narrativeMatch) {
                    if (currentMessage) {
                        const narrative = line.substring(narrativeMatch[0].length).trim();
                        if (!currentMessage.narrative) currentMessage.narrative = "";
                        currentMessage.narrative += narrative + "\n";
                    }
                    continue;
                }

                const actionMatch = line.match(actionRegex);
                if (actionMatch) {
                    if (currentMessage) {
                        if (!(currentMessage as any).actions) (currentMessage as any).actions = [];
                        (currentMessage as any).actions.push({ actionName: '', chatMessage: actionMatch[1].trim(), chatMessageClass: 'neutral-action-message' });
                    }
                    continue;
                }

                const speakerMatch = line.match(speakerRegex);
                if (speakerMatch) {
                    if (currentMessage) fileMessages.push({ ...currentMessage, content: currentMessage.content.trim() });
                    const name = speakerMatch[1].trim();
                    if (!characterNames.includes(name)) characterNames.push(name);
                    currentMessage = {
                        role: (name === this.gameData.playerName.replace(/\s+/g, '')) ? 'user' : 'assistant',
                        name: name,
                        content: line.substring(speakerMatch[0].length).trim()
                    };
                } else if (line.trim()) {
                    if (currentMessage) {
                        currentMessage.content += '\n' + line;
                    } else {
                        fileMessages.push({ role: 'system', name: '', content: line.trim() });
                    }
                }
            }
            if (currentMessage) fileMessages.push({ ...currentMessage, content: currentMessage.content.trim() });

            if (fileMessages.length > 0) {
                return { date: currentDate, scene: currentScene, location: currentLocation, characters: characterNames, messages: fileMessages };
            }
            return null;
        } catch (error) {
            console.error(`Error parsing history file ${fileInfo.fileName}: ${error}`);
            return null;
        }
    }

    private async withLimitedHistory<T>(callback: () => Promise<T>): Promise<T> {
        // The displayed archive also owns historical replay. Prompt builders use
        // recipient ledger views and summaries; never swap this shared collection.
        return await callback();
    }

    pushMessage(message: Message): void{
        if (this.isOpen === false) return; // Closing fixes the encounter boundary for pending callbacks.
        message.gameDate ??= this.gameData.date;
        if (!message.id) {
            message.id = randomUUID();
        }

        // If the user provides bracketed instructions, replace pronouns to avoid LLM confusion.
        if (message.role === 'user' && message.content.includes('[') && message.content.includes(']')) {
            const player = this.gameData.getPlayer();
            if (player) {
                const originalContent = message.content;

                message.content = originalContent.replace(/\[([^\]]*)\]/g, (match, insideBrackets) => {
                    let processedText = insideBrackets;

                    // Replace "I", "me", "my" with player's name
                    processedText = processedText.replace(/\bmy\b/gi, player.fullName + "'s");
                    processedText = processedText.replace(/\b(I|me)\b/gi, player.fullName);

                    // Determine the target for "you"
                    let targetCharacter: Character | undefined;
                    const otherCharacters = Array.from(this.gameData.characters.values()).filter(c => c.id !== this.gameData.playerID);
                    const targetIds = (message as any).targetCharacterIds as number[] | undefined;

                    if (targetIds && targetIds.length === 1) {
                        // If there's an explicit single target from the UI
                        targetCharacter = this.gameData.getCharacterById(targetIds[0]);
                    } else if (otherCharacters.length === 1) {
                        // If there's only one other character in the conversation
                        targetCharacter = otherCharacters[0];
                    }
                    // If multiple other characters and no explicit target, "you" is ambiguous. We won't replace it.

                    if (targetCharacter) {
                        // Replace "you", "your" with target character's name
                        processedText = processedText.replace(/\byour\b/gi, targetCharacter.fullName + "'s");
                        processedText = processedText.replace(/\byou\b/gi, targetCharacter.fullName);
                    }

                    return `[${processedText}]`;
                });

                if (originalContent !== message.content) {
                    console.log(`Replaced pronouns in user instruction. Original: "${originalContent}", New: "${message.content}"`);
                }
            }
        }

        // If this is an AI message, try to remove a placeholder
        if (message.role === 'assistant' && (message as any).characterId) {
            const characterId = (message as any).characterId;
            const placeholderIndex = this.messages.findIndex(
                msg => (msg as any).characterId === characterId && msg.content === this.notSpokenYetText
            );

            if (placeholderIndex !== -1) {
                this.messages.splice(placeholderIndex, 1); // Remove the placeholder
                console.log(`Removed placeholder for character ID ${characterId}.`);
            }
        }

        if (message.role === 'user' && languageRoutingEnabled(this.config) && !message.languageRoutingBypassed &&
            !message.utterance && /(^|[^\\])(?:""|~~)/.test(message.content)) {
            parseControlledProse(message.content);
            message.proseEncoding = 'controls-v1';
        }

        // Materialize prior working turns before the new turn looks up an audible echo.
        const ledger = this.ledger();
        if (!languageRoutingEnabled(this.config)) markLanguageRoutingBypassed(message);
        else if ([...this.gameData.characters.values()].some(character => character.languageSnapshot)) {
            const targets = (message as any).targetCharacterIds as number[] | undefined;
            this.languageView().record(message, targets?.length === 1 ? targets[0] : undefined);
        }
        ledger.append(message, this.gameData.characters.values());
        this.messages.push(message); // Working context; ledger survives compaction.
        this.persistLedger();
        this.schedulePerspectiveSummaries();
        enqueueConversationAudio(this, message);
        if (message.role === 'user' && message.proseEncoding)
            this.chatWindow.window.webContents.send('conversation-history', this.getHistory());

        console.log(`Message processed for conversation. Role: ${message.role}, Name: ${message.name}, Content length: ${message.content.length}`);

        // Reset consecutive actions counter when player sends a message
        if (message.role === "user") {
            this.consecutiveActionsCount = 0;
            this.currentTurnTriggeredActions.clear();
            console.log('Player message sent, resetting consecutive actions count and duplicate action check.');
        }
    }


    async generateAIsMessages() {
        if (this.isGeneratingScene) {
            console.log('Scene is currently generating. Queuing player request to be processed after.');
            this.pendingPlayerRequest = true;
            // We do NOT send 'generation-finished' here. The input is already disabled by the renderer
            // when the user sent their message. The 'finally' block of generateSceneDescription will
            // process this pending request, and the subsequent call to generateAIsMessages will
            // correctly re-enable the input upon completion.
            return;
        }
        if (this.isGenerating) {
            console.log('Already generating AI messages. Queuing request to run after current generation finishes.');
            this.pendingPlayerRequest = true;
            // Do NOT send 'generation-finished' here: generation is still in progress,
            // and the renderer should keep showing loading dots / status until it completes.
            return;
        }

        // Proactive compaction check
        if (this.memoryCompactor && this.config.enableMemoryCompaction) {
            const tokenCount = await this.calculateBasePromptTokens();
            const contextSize = this.textGenApiConnection.context || 8192;
            if (this.memoryCompactor.shouldTriggerCompaction(this.messages, tokenCount, contextSize)) {
                console.log('Context usage is over the threshold, triggering pre-emptive compaction.');
                await this.resummarize(true);
            }
        }

        this.isGenerating = true;
        this.abortController = new AbortController();
        let generationPhase = 'encounter';
        const inPhase = async <T>(phase: string, operation: () => Promise<T>): Promise<T> => {
            generationPhase = phase;
            return await operation();
        };
        try {
            await this.encounterCapture;
            this.abortController?.signal.throwIfAborted();
            this.encounterLifetime.signal.throwIfAborted();
            // Ensure NPC queue is filled before determining targets.
            this.fillNpcQueue();
            const targetedCharacters = await inPhase('targeting', () => this.determineTargetedCharacters());

            const lastMessage = this.messages.length > 0 ? this.messages[this.messages.length - 1] : null;

            // Determine if we should check for actions immediately, before an AI's conversational reply.
            const userMessages = this.messages.filter(m => m.role === 'user');
            const isFirstUserTurn = userMessages.length === 1 && lastMessage?.role === 'user';
            const isDirectActionSyntax = lastMessage?.role === 'user' && (/\[(.*?)\]/.test(lastMessage.content) || /\*(.*?)\*/.test(lastMessage.content));

            let playerActionsAlreadyChecked = false;

            if (lastMessage && lastMessage.role === 'user' && (isFirstUserTurn || isDirectActionSyntax)) {
                const reason = isFirstUserTurn ? "first user turn" : "direct action syntax";
                console.log(`Performing immediate action check due to: ${reason}.`);

                // If multiple targets, pick the first. If none, fallback to main AI.
                const targetId = targetedCharacters.length > 0 ? targetedCharacters[0].id : this.gameData.aiID;
                const sourceId = this.gameData.playerID;

                const checkedContent = lastMessage.content;
                const collectedActions = await inPhase('action_check', () => checkActions(this, sourceId, targetId));
                // A pending proposal completes this check; a changed message needs its own check.
                playerActionsAlreadyChecked = this.messages[this.messages.length - 1] === lastMessage && lastMessage.content === checkedContent;

                // If actions were found, we treat that as the "response" and bypass the normal AI chat reply.
                if (collectedActions.length > 0) {
                    console.log('Actions triggered on immediate check. Bypassing conversational reply.');
                    this.executedActions.set(lastMessage.id!, collectedActions);
                    this.actionInvolvedCharacterIds.add(sourceId);
                    this.actionInvolvedCharacterIds.add(targetId);
                    this.consecutiveActionsCount++;
                    this.lastActionMessageIndex = this.messages.length - 1;

                    let playerNarrative: Message | null = null;
                    if (this.config.narrativeEnable) {
                        playerNarrative = await inPhase('narrative', () => generateNarrative(this, collectedActions));
                    }

                    if (playerNarrative) {
                        this.pushMessage(playerNarrative);
                    }
                    this.chatWindow.window.webContents.send('actions-receive', collectedActions, playerNarrative, false);

                    // End generation here since we handled the direct action.
                    this.isGenerating = false;
                    return;
                } else {
                    console.log('No actions triggered on immediate check. Proceeding with normal AI response.');
                }
            }

            this.aiToAiTurnLimit = 0;
            console.log('Starting generation of AI messages for all characters.');

            const isNowSelfTalk = this.gameData.characters.size === 1 && this.gameData.characters.has(this.gameData.playerID);

            // Special case for self-talk (player character is the AI character)
            if (isNowSelfTalk) {
                console.log('Self-talk session detected. Generating internal monologue for player character.');
                const playerCharacter = this.gameData.getPlayer();
                const messages = await inPhase('npc_reply', () => this.processCharacterList([playerCharacter], false));
                for (const message of messages.messages) {
                    if (message) {
                        this.pushMessage(message);
                        this.chatWindow.window.webContents.send('message-receive', this.messageForPlayer(message), false);
                    }
                }
                this.chatWindow.window.webContents.send('actions-receive', [], "");
                console.log('Finished generating self-talk message.');
                return;
            }

            const respondedCharacterIds = new Set<number>();
            const allGeneratedMessages: Message[] = [];
            const allTurnActions: ActionResponse[] = [];

            // If the player's message contains action syntax, check for actions before the AI responds.
            // This ensures detection even if AI generation produces no messages, and avoids the old
            // problem of skipping the AI response entirely when actions were found.
            if (!playerActionsAlreadyChecked && this.config.actionsEnableAll && this.gameData.playerID !== this.gameData.aiID) {
                const lastMessage = this.messages.length > 0 ? this.messages[this.messages.length - 1] : null;
                if (lastMessage && lastMessage.role === 'user' &&
                    (/\[(.*?)\]/.test(lastMessage.content) || /\*(.*?)\*/.test(lastMessage.content))) {
                    console.log('Direct action detected in player message. Checking actions before AI responds.');
                    const targetId = targetedCharacters.length > 0 ? targetedCharacters[0].id : this.gameData.aiID;
                    const sourceId = this.gameData.playerID;

                    if (this.consecutiveActionsCount < this.config.maxConsecutiveActions) {
                        const collectedActions = await inPhase('action_check', () => checkActions(this, sourceId, targetId));
                        if (collectedActions.length > 0) {
                            this.executedActions.set(lastMessage.id!, collectedActions);
                            allTurnActions.push(...collectedActions);
                            this.actionInvolvedCharacterIds.add(sourceId);
                            this.actionInvolvedCharacterIds.add(targetId);
                            this.consecutiveActionsCount++;
                            this.lastActionMessageIndex = this.messages.length - 1;
                        }
                    }
                    playerActionsAlreadyChecked = true;
                }
            }

            // Step 1: Get and process targeted characters
            if (targetedCharacters.length > 0) {
                const { messages, actions } = await inPhase('npc_reply', () => this.processCharacterList(targetedCharacters, false, playerActionsAlreadyChecked));
                allGeneratedMessages.push(...messages.filter(m => m !== null) as Message[]);
                allTurnActions.push(...actions);
                messages.forEach(msg => {
                    if (msg) {
                        respondedCharacterIds.add((msg as any).characterId);
                    }
                });
            } else {
                // If no one is targeted, one random character responds
                console.log('No specific targets. Processing one random character from the queue.');
                const shuffledQueue = [...this.npcQueue].sort(() => Math.random() - 0.5);
                if (shuffledQueue.length > 0) {
                    const { messages, actions } = await inPhase('npc_reply', () => this.processCharacterList([shuffledQueue[0]], false, playerActionsAlreadyChecked));
                    allGeneratedMessages.push(...messages.filter(m => m !== null) as Message[]);
                    allTurnActions.push(...actions);
                    messages.forEach(msg => {
                        if (msg) {
                            respondedCharacterIds.add((msg as any).characterId);
                        }
                    });
                }
            }

            // Step 2: Get and process non-targeted characters
            const nonTargetedCharacters = this.npcQueue.filter(c => !respondedCharacterIds.has(c.id));
            const respondingCharacters: Character[] = [];

            // Decide if ANY non-targeted character should respond
            const willAnyRespond = Math.random() < (this.config.nonTargetedCharacterResponseChance / 100);

            if (willAnyRespond && nonTargetedCharacters.length > 0) {
                console.log(`A non-targeted character will respond based on chance.`);
                // Select one random character from the available non-targeted characters
                const randomIndex = Math.floor(Math.random() * nonTargetedCharacters.length);
                const selectedCharacter = nonTargetedCharacters[randomIndex];
                respondingCharacters.push(selectedCharacter);
                console.log(`Selected non-targeted character to respond: ${selectedCharacter.shortName}`);
            } else {
                console.log(`No non-targeted character will respond this turn.`);
            }

            if (respondingCharacters.length > 0) {
                const { messages, actions } = await inPhase('npc_reply', () => this.processCharacterList(respondingCharacters, true, playerActionsAlreadyChecked));
                allGeneratedMessages.push(...messages.filter(m => m !== null) as Message[]);
                allTurnActions.push(...actions);
            }

            // Clear queue display after all characters in this turn have been processed
            this.chatWindow.window.webContents.send('queue-update', [], null);

            // Immediately re-enable the user's input before generating narrative
            this.chatWindow.window.webContents.send('generation-finished', true);

            // Send actions for player-directed part to re-enable user input
            let playerNarrative: Message | null = null;
            if (allTurnActions.length > 0 && this.config.narrativeEnable) {
                playerNarrative = await inPhase('narrative', () => generateNarrative(this, allTurnActions));
                if (playerNarrative) {
                    this.pushMessage(playerNarrative);
                }
            }
            this.chatWindow.window.webContents.send('actions-receive', allTurnActions, playerNarrative, false);

            // --- AI-to-AI conversation starts here, in the background ---
            this.handleAiToAiConversation(allGeneratedMessages).catch(err => {
                console.error("Error in background AI-to-AI conversation:", err);
            });

            console.log('Finished generating and sending all AI messages to player.');

            // If suggestions are enabled, generate them now.
            if (this.config.autoGenerateSuggestions) {
                await inPhase('suggestions', () => this.generateInitialSuggestions());
            }
        } catch (error) {
            if (isAbortError(error)) {
                console.log('generateAIsMessages was cancelled.');
                // The UI notification is handled in cancelGeneration(), so we do nothing here.
            } else {
                console.error('An error occurred during AI message generation:', error);
                const failure = generationFailure(error);
                console.info('[Generation diagnostic] ' + JSON.stringify({ phase: generationPhase, code: failure.code,
                    ...(failure.status ? { status: failure.status } : {}) }));
                this.chatWindow.window.webContents.send('error-message', failure.message);
            }
        }
        finally {
            this.isGenerating = false;
            this.abortController = null;

            if (this.sceneRefreshPending && this.isOpen) {
                setTimeout(() => this.generateSceneDescription(), 0);
            } else if (this.pendingPlayerRequest) {
                console.log('Processing queued player request after generation finished.');
                this.pendingPlayerRequest = false;
                // do not send 'generation-finished' yet
                setTimeout(() => this.generateAIsMessages(), 0);
            } else {
                // Notify the frontend that generation is complete to re-enable the input field.
                this.chatWindow.window.webContents.send('generation-finished', true);

                // After the turn, calculate the new base prompt size and send it to the UI
                const newBaseTokens = await this.calculateBasePromptTokens();
                this.chatWindow.window.webContents.send('update-base-tokens', newBaseTokens);
            }
        }
    }


    fillNpcQueue(): void {
        // Silenced characters are excluded so they never respond when spoken to
        // or get picked as random responders (covers the AI-starts-conversation path).
        this.npcQueue = Array.from(this.gameData.characters.values()).filter(
            (character) => character.id !== this.gameData.playerID &&
                !this.gameData.silencedCharacterIds?.has(character.id)
        );
        console.log(`NPC queue filled with ${this.npcQueue.length} characters.`);
    }

    async determineTargetedCharacters(): Promise<Character[]> {
        console.log('Determining targeted characters...');
        // Find the last message sent by the user to ensure we don't analyze a system message.
        const lastMessage = [...this.messages].reverse().find(m => m.role === 'user');

        // Only check for targets if a user message was found.
        if (!lastMessage) {
            console.log('No user message found in history, skipping targeting.');
            return [];
        }
        console.log(`Analyzing user message for targets: "${lastMessage.content}"`);

        // 1. Prioritize explicit targets from UI (passed as targetCharacterIds)
        const targetIds = (lastMessage as any).targetCharacterIds as number[] | undefined;
        if (targetIds && targetIds.length > 0 && targetIds.some(id => !isNaN(id))) { // Check if there are actual numbers
            const explicitTargets = new Set<Character>();
            targetIds.forEach(id => {
                const char = this.npcQueue.find(c => c.id === id);
                if (char) {
                    explicitTargets.add(char);
                }
            });
            if (explicitTargets.size > 0) {
                console.log(`UI targeted characters identified: ${Array.from(explicitTargets).map(c => c.shortName).join(', ')}`);
                return Array.from(explicitTargets);
            }
        }

        // 2. If no UI target, perform automatic detection
        console.log('No UI target found. Performing automatic detection...');
        const messageContent = lastMessage.content.toLowerCase();
        const words = messageContent.replace(/[.,!?;:]/g, '').split(/\s+/).filter(w => w.length > 2); // Clean punctuation and split into words
        console.log(`Words from message to check: [${words.join(', ')}]`);

        const potentialTargets = new Map<Character, number>(); // Map of Character to confidence score
        const FUZZY_MATCH_THRESHOLD = 0.75; // Lowered threshold slightly to catch more matches
        const SUBSTRING_CONFIDENCE = 0.9;
        const STOPWORDS = new Set(['the', 'of', 'a', 'an', 'in', 'on', 'at', 'for', 'to', 'and', 'le', 'la', 'de', 'my', 'your']);

        for (const character of this.npcQueue) {
            let highestConfidence = 0;
            console.log(`\nChecking character: ${character.shortName} (ID: ${character.id})`);

            const checkables = [
                character.fullName,
                character.shortName,
                character.firstName,
                character.primaryTitle,
                character.titleRankConcept
            ].filter(Boolean).map(n => n.toLowerCase());

            const player = this.gameData.getPlayer();
            if (player && player.relatives) {
                const relationshipToPlayer = player.relatives.find(m => m.id === character.id);
                if (relationshipToPlayer && relationshipToPlayer.relationship) {
                    const relationship = relationshipToPlayer.relationship.toLowerCase();
                    checkables.push(relationship);
                    if (relationship === 'child') {
                        // The character object from gameData should have gender info.
                        // We assume 'sheHe' property exists based on its usage elsewhere.
                        if (character.sheHe.toLowerCase() === 'he') {
                            checkables.push('son');
                        } else if (character.sheHe.toLowerCase() === 'she') {
                            checkables.push('daughter');
                        }
                    }
                }
            }

            console.log(`... against checkables: [${checkables.join(', ')}]`);

            for (const checkable of checkables) {
                const parts = checkable.split(/\s+/);
                for (const part of parts) {
                    const cleanPart = part.replace(/[.,!?;:]/g, '');
                    if (cleanPart.length < 3 || STOPWORDS.has(cleanPart)) continue;

                    for (const word of words) {
                        if (STOPWORDS.has(word)) continue;

                        // Substring match (high confidence)
                        if (cleanPart.includes(word)) {
                            if (SUBSTRING_CONFIDENCE > highestConfidence) {
                                highestConfidence = SUBSTRING_CONFIDENCE;
                                console.log(`... new highest confidence ${SUBSTRING_CONFIDENCE} from substring match: "${cleanPart}" includes "${word}"`);
                            }
                        }

                        // Fuzzy match (lower confidence)
                        const confidence = getSimilarity(cleanPart, word);
                        if (confidence > highestConfidence) {
                            highestConfidence = confidence;
                            console.log(`... new highest confidence ${confidence.toFixed(2)} from fuzzy match: "${cleanPart}" vs "${word}"`);
                        }
                    }
                }
            }

            if (highestConfidence > FUZZY_MATCH_THRESHOLD) {
                console.log(`---> Match found for ${character.shortName} with confidence ${highestConfidence.toFixed(2)} (Threshold: ${FUZZY_MATCH_THRESHOLD})`);
                const existingConfidence = potentialTargets.get(character) || 0;
                if (highestConfidence > existingConfidence) {
                    potentialTargets.set(character, highestConfidence);
                }
            }
        }

        if (potentialTargets.size > 0) {
            const sortedTargets = [...potentialTargets.entries()].sort((a, b) => b[1] - a[1]);
            const topConfidence = sortedTargets[0][1];

            // Return all targets with a confidence score close to the top score
            const highConfidenceTargets = sortedTargets
                .filter(t => t[1] >= topConfidence - 0.05) // Allow for small confidence differences
                .map(t => t[0]);

            if (highConfidenceTargets.length > 0) {
                console.log(`\nFinal targeted characters determined by automatic detection: ${highConfidenceTargets.map(c => `${c.shortName} (Confidence: ${potentialTargets.get(c)?.toFixed(2)})`).join(', ')}`);
                return highConfidenceTargets;
            }
        }

        console.log('\nNo specific character targeted after automatic detection.');
        return [];
    }

    async determineActionTarget(messageContent: string, speakerId: number): Promise<Character | null> {
        console.log(`Determining action target from message: "${messageContent}"`);
        const otherCharacters = Array.from(this.gameData.characters.values()).filter(c => c.id !== speakerId && c.id !== this.gameData.playerID);
        if (otherCharacters.length === 0) {
            return null; // No other AIs to target
        }

        const content = messageContent.toLowerCase();
        const words = content.replace(/[.,!?;:]/g, '').split(/\s+/);

        let bestMatch: Character | null = null;
        let highestConfidence = 0.75; // Start with a threshold

        for (const char of otherCharacters) {
            const checkables = [char.fullName, char.shortName, char.firstName].filter(Boolean).map(n => n.toLowerCase());
            for (const checkable of checkables) {
                for (const word of words) {
                    const confidence = getSimilarity(checkable, word);
                    if (confidence > highestConfidence) {
                        highestConfidence = confidence;
                        bestMatch = char;
                    }
                }
            }
        }

        if (bestMatch) {
            console.log(`Inferred action target: ${bestMatch.shortName} with confidence ${highestConfidence}`);
        } else {
            console.log('No specific AI action target inferred. Defaulting to player.');
        }

        return bestMatch;
    }

    async processCharacterList(characterList: Character[], isNonTargeted: boolean, playerActionsAlreadyChecked: boolean = false, performActionCheck: boolean = true): Promise<{ messages: (Message | null)[], actions: ActionResponse[] }> {
        const generatedMessages: (Message | null)[] = [];

        for (const character of characterList) {
            if (this.isPaused) {
                console.log('Conversation paused. Queue processing will stop.');
                break;
            }

            // Update UI to show who is speaking
            const queueUpdate = characterList.filter(c => c.id !== character.id).map(c => ({ name: c.shortName, id: c.id }));
            const speakerUpdate = { name: character.shortName, id: character.id };
            this.chatWindow.window.webContents.send('queue-update', queueUpdate, speakerUpdate);

            console.log(`Processing character: ${character.shortName}`);

            // Generate message but don't send it to the UI yet
            const message = await this.generateNewAIMessage(character, false, isNonTargeted);

            if (message) {
                generatedMessages.push(message);
                this.pushMessage(message);
                this.chatWindow.window.webContents.send('message-receive', this.messageForPlayer(message), this.config.actionsEnableAll, false);

                // Check for actions initiated by the AI character's response.
                if (performActionCheck && this.config.actionsEnableAll) {
                    const sourceId = character.id; // The AI is the source.
                    this.determineActionTarget(message.content, sourceId).then(actionTarget => {
                        const targetId = actionTarget ? actionTarget.id : this.gameData.playerID; // Target is player or another AI.

                        if (sourceId !== targetId) {
                            console.log(`[processCharacterList] Checking for AI-initiated actions in background. Source: ${sourceId}, Target: ${targetId}`);
                            // Don't await this. Let it run in the background so the UI isn't blocked.
                            checkActions(this, sourceId, targetId).then(async (collectedActions) => {
                                if (collectedActions.length > 0) {
                                    const existingActions = this.executedActions.get(message.id!) || [];
                                    this.executedActions.set(message.id!, [...existingActions, ...collectedActions]);
                                    this.actionInvolvedCharacterIds.add(sourceId);
                                    this.actionInvolvedCharacterIds.add(targetId);

                                    // Generate narrative here since we have the actions.
                                    let narrativeMessage: Message | null = null;
                                    if (this.config.narrativeEnable) {
                                        narrativeMessage = await generateNarrative(this, collectedActions);
                                        if (narrativeMessage) {
                                            this.pushMessage(narrativeMessage);
                                        }
                                    }
                                    this.chatWindow.window.webContents.send('actions-receive', collectedActions, narrativeMessage, false);
                                }
                            }).catch(err => {
                                console.error(`Error during background action check for message ${message.id}:`, err);
                            });
                        }
                    });
                }
            }
        }

        // Actions are now handled async, so we return an empty array.
        // Player-initiated actions are handled separately in generateAIsMessages.
        return { messages: generatedMessages, actions: [] };
    }

    pause(): void {
        this.isPaused = true;
        console.log('Conversation has been paused.');
    }

    resume(): void {
        if (!this.isPaused) {
            console.log('Conversation is not paused.');
            return;
        }
        this.isPaused = false;
        console.log('Conversation is resuming. Next user message will trigger AI responses.');
    }

    async generateAiToAiMessage(source: Character, target: Character): Promise<Message | null> {
        return this.withLimitedHistory(async () => {
            // Update UI to show who is speaking
            this.chatWindow.window.webContents.send('queue-update', [], { name: source.shortName, id: source.id });

            // buildChatPrompt will correctly set the target and use the right instruction.
            // Language-aware continuations need the source actor's observed exchange, including overheard speech.
            await this.ensureBackgroundReady(source);
            const spokenLanguageId = this.plannedLanguage(source, target);
            const proseEncoding = this.plannedProseEncoding(spokenLanguageId);
            const deliver = this.generatedDelivery();
            let prompt = await buildChatPrompt(this, source, this.hasLanguageMessages() ? this.messages : [], target, false, spokenLanguageId, proseEncoding);

            let currentTokens = this.textGenApiConnection.calculateTokensFromChat(prompt);
        console.log(`Current prompt token count for AI-to-AI: ${currentTokens}`);

        if(currentTokens > this.textGenApiConnection.context){
            console.log(`Context limit hit (${currentTokens}/${this.textGenApiConnection.context} tokens), resummarizing conversation!`);
            await this.resummarize(true);
            // Rebuild prompt after summarization
            prompt = await buildChatPrompt(this, source, this.hasLanguageMessages() ? this.messages : [], target, false, spokenLanguageId, proseEncoding);
        }

        if (proseEncoding === 'controls-v1') return this.completeControlledMessage(prompt, source, spokenLanguageId!, deliver,
            { max_tokens: this.config.maxTokens }, [target.id]);

        const content = await this.textGenApiConnection.complete(prompt, false, {
            max_tokens: this.config.maxTokens,
        }, undefined, this.abortController?.signal);

        if (content) {
            const message: Message = {
                role: 'assistant',
                name: source.fullName,
                spokenLanguageId,
                content: typeof content === 'string' ? content.trim() : content.content?.trim() ?? ''
            };
            // Add target information for the UI
            (message as any).targetCharacterIds = [target.id];
            (message as any).characterId = source.id;
            return deliver(message);
        }
        return null;
        });
    }

    async generateNewAIMessage(character: Character, sendMessageToChat: boolean = true, isNonTargeted: boolean = false): Promise<Message | null> {
        return this.withLimitedHistory(async () => {
            await this.ensureBackgroundReady(character);
            const spokenLanguageId = this.plannedLanguage(character);
            const proseEncoding = this.plannedProseEncoding(spokenLanguageId);
            const nativeMode=nativeLoreChatEnabled(this);
            let nativeReply:NativeLoreChatReply|undefined;
            try{
            const deliver = this.generatedDelivery();
            const shouldStream = this.config.stream && !this.config.audio?.enabled && sendMessageToChat && (!spokenLanguageId ||
                knownLanguages(characterLanguages(this.gameData.getPlayer())).includes(spokenLanguageId));
            console.log(`Generating AI message for character: ${character.fullName}`);

        const isSelfTalk = this.gameData.characters.size === 1 && this.gameData.characters.has(this.gameData.playerID);
        const characterNameForResponse = isSelfTalk ? character.shortName : character.fullName;

        // Check if we should question player actions
        const questioningChance = this.calculateQuestioningChance(character);
        if (questioningChance > 0 && Math.random() < (questioningChance / 100)) {
            const questionMessage = await this.generateActionQuestioningMessage(character, spokenLanguageId, proseEncoding,
                proseEncoding === 'controls-v1' ? deliver : undefined);
            if (questionMessage) {
                questionMessage.spokenLanguageId = spokenLanguageId;
                if (!deliver(questionMessage)) return null;
            }
            if (questionMessage) {
                if (sendMessageToChat) {
                    this.pushMessage(questionMessage);
                    this.chatWindow.window.webContents.send('message-receive', this.messageForPlayer(questionMessage), this.config.actionsEnableAll);
                }
                return questionMessage;
            }
            if (proseEncoding === 'controls-v1') return null;
        }

        if (proseEncoding === 'controls-v1') {
            const nativeCapture:NativeLoreCapture|undefined=nativeMode?{preparing:true}:undefined;
            const prompt = await buildChatPrompt(this, character, undefined, undefined, isNonTargeted, spokenLanguageId, proseEncoding,nativeCapture);
            const message = await this.completeControlledMessage(prompt, character, spokenLanguageId!, deliver,
                { max_tokens: this.config.maxTokens }, undefined, characterNameForResponse,nativeCapture?.value,nativeMode?async()=>{
                    await buildChatPrompt(this,character,undefined,undefined,isNonTargeted,spokenLanguageId,proseEncoding,nativeCapture);
                    return nativeCapture?.value;
                }:undefined);
            if (message && sendMessageToChat) {
                this.pushMessage(message);
                this.chatWindow.window.webContents.send('message-receive', this.messageForPlayer(message), this.config.actionsEnableAll);
            }
            return message;
        }

        let responseMessage: Message;

        if(shouldStream){
            this.chatWindow.window.webContents.send('stream-start');
            console.log('Stream started for AI message generation.');
        }

        let currentTokens = this.textGenApiConnection.calculateTokensFromChat(await buildChatPrompt(this, character, undefined, undefined, isNonTargeted, spokenLanguageId,proseEncoding,nativeMode?{preview:true}:undefined));
        //let currentTokens = 500;
        console.log(`Current prompt token count: ${currentTokens}`);

        let streamMessage: any = {
            role: "assistant",
            name: characterNameForResponse,//this.gameData.aiName,
            content: "",
            characterId: character.id,
                spokenLanguageId
        }
        let cw = this.chatWindow;
        function streamRelay(msgChunk: MessageChunk): void{
            streamMessage.content += msgChunk.content;
            const messageToSend = JSON.parse(JSON.stringify(streamMessage));

            if (isSelfTalk) {
                messageToSend.content = `*${messageToSend.content}`;
            }
            cw.window.webContents.send('stream-message', messageToSend);
        }


        if(this.textGenApiConnection.isChat()){
            console.log('Using chat API for AI message completion.');
            const nativeCapture:NativeLoreCapture|undefined=nativeMode?{preparing:true}:undefined;
            const prompt=await buildChatPrompt(this,character,undefined,undefined,isNonTargeted,spokenLanguageId,proseEncoding,nativeCapture);
            if(nativeMode)nativeReply=await completeNativeLoreChat(this,character,nativeCapture?.value,{max_tokens:this.config.maxTokens},this.abortController?.signal);
            const chatResult=nativeReply?nativeReply.reply:await this.textGenApiConnection.complete(prompt,shouldStream,{max_tokens:this.config.maxTokens},
                shouldStream?streamRelay:undefined,this.abortController?.signal);
            const contentFromResult = typeof chatResult === 'string' ? chatResult : (chatResult as any)?.content;
            responseMessage = {
                role: "assistant",
                name: characterNameForResponse,//this.gameData.aiName,
                content: contentFromResult ?? '',
                characterId: character.id,
                spokenLanguageId
            };

        }
        //instruct
        else{
            console.log('Using completion API for AI message completion.');
            const completionResult = await this.textGenApiConnection.complete(convertChatToText(await buildChatPrompt(this, character, undefined, undefined, isNonTargeted, spokenLanguageId), this.config, character.fullName), shouldStream, {
                stop: [this.config.inputSequence, this.config.outputSequence],
                max_tokens: this.config.maxTokens,
            },
            shouldStream ? streamRelay : undefined, this.abortController?.signal);
            const contentFromCompletion = typeof completionResult === 'string' ? completionResult : (completionResult as any)?.content;
            responseMessage = {
                role: "assistant",
                name: characterNameForResponse,
                content: contentFromCompletion ?? '',
                characterId: character.id,
                spokenLanguageId
            };

        }

        if (this.config.audio?.enabled) cleanAudioMessage(responseMessage);
        if(this.config.cleanMessages){
            console.log('Cleaning AI message content.');
            responseMessage.content = cleanMessageContent(responseMessage.content);
        }

        let content = responseMessage.content.trim();

        // Stage 1: Look for explicit phrases that terminate a preamble.
        const preambleTerminators = [
            "Time to write the reply.",
            "Here is the reply.",
            "Here's the reply.",
            "Now for the reply.",
            "Now, I will write the reply."
        ];

        let splitIndex = -1;
        let terminatorLength = 0;

        for (const terminator of preambleTerminators) {
            const index = content.lastIndexOf(terminator);
            if (index > splitIndex) {
                splitIndex = index;
                terminatorLength = terminator.length;
            }
        }

        const PREAMBLE_MIN_LENGTH = 100; // A safety check for all stripping operations.

        // If a terminator was found and it's preceded by a long preamble, strip it.
        if (splitIndex > PREAMBLE_MIN_LENGTH) {
            console.log(`Preamble terminator found. Stripping preamble from AI response.`);
            content = content.substring(splitIndex + terminatorLength).trim();
        }
        // Stage 2: Fallback for cases without a clear terminator phrase.
        // This looks for the last instance of "Character Name:"
        else {
            const markers = [`${character.fullName}:`, `${character.shortName}:`];
            let fallbackSplitIndex = -1;
            for (const marker of markers) {
                const index = content.lastIndexOf(marker);
                if (index > fallbackSplitIndex) {
                    fallbackSplitIndex = index;
                }
            }

            if (fallbackSplitIndex > PREAMBLE_MIN_LENGTH) {
                console.log(`Preamble detected via fallback. Stripping preamble from AI response.`);
                content = content.substring(fallbackSplitIndex);
            }
        }

        // Final cleanup: After stripping the preamble, remove the character name prefix from the start of the actual response.
        const characterNames = [character.fullName, character.shortName].filter(Boolean);
        if (characterNames.length > 0) {
            // Escape names for regex and join with |
            const namePattern = characterNames.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');

            // Regex to find name at the start, followed by any characters up to a comma or colon.
            // This is to strip prefixes like "Name:", "Name,", or "Name, doing something:".
            const prefixRegex = new RegExp(`^\\s*\\b(${namePattern})\\b.*?[,:]`, 'i');

            const match = content.match(prefixRegex);
            if (match) {
                console.log(`Found and stripping prefix: "${match[0]}"`);
                content = content.substring(match[0].length).trim();
            }
        }

        responseMessage.content = content;

        // The AI should not generate a response for the player.
        const player = this.gameData.getPlayer();
        const playerPrefixes = [`${player.fullName}:`, `${player.shortName}:`];
        for (const prefix of playerPrefixes) {
            if (responseMessage.content.trim().startsWith(prefix)) {
                const errorMsg = `Error: The AI attempted to generate a response for the player character (${player.shortName}). This action has been blocked.`;
                console.error(errorMsg + `\nOriginal AI response: "${responseMessage.content}"`);
                this.chatWindow.window.webContents.send('error-message', errorMsg);
                return null; // Stop processing this message
            }
        }

        // If the response is empty after cleaning, don't send it.
        if (!responseMessage.content.trim()) {
            console.log(`AI response for ${character.fullName} was empty after cleaning. Skipping.`);
            return null;
        }

        if (isSelfTalk) {
            // First, remove any leading or trailing asterisks from the raw response to prevent doubling them up.
            let cleanedContent = responseMessage.content.replace(/^\*+|\*+$/g, '').trim();
            responseMessage.content = `*${cleanedContent}*`;
        }

        nativeReply?.validate();
        if (!deliver(responseMessage)) return null;
        nativeReply?.finish(true,responseMessage);
        // Only add the message to the message array and send to the chat window if sendMessageToChat is true.
        if (sendMessageToChat) {
            this.pushMessage(responseMessage);
            const messageIndex = this.messages.length - 1; // 获取刚添加的消息索引

            if (shouldStream) {
                // The stream is over, send the final, cleaned, and formatted message
                // to replace the streaming content in the UI.
                streamMessage.content = this.messageForPlayer(responseMessage).content;
                this.chatWindow.window.webContents.send('stream-message', streamMessage);
                console.log('Sent final stream message to chat window.');
            } else {
                this.chatWindow.window.webContents.send('message-receive', this.messageForPlayer(responseMessage), this.config.actionsEnableAll);
                console.log('Sent AI message to chat window (non-streaming).');
            }

        } else {
            console.log(`Message generated but not sent to chat window due to sendMessageToChat=false`);
        }

        // If sendMessageToChat is false, return the generated message.
        if (!sendMessageToChat) {
            return responseMessage;
        }

        return null;
            }finally{nativeReply?.finish(false);}
        });
    }

    /**
     * Validate if the generated message matches the character's identity.
     * @param character - The character who should be speaking.
     * @param messageContent - The generated message content.
     * @returns Returns true if the message matches the character identity, otherwise returns false.
     */
    async validateCharacterIdentity(character: Character, messageContent: string): Promise<boolean> {
        console.log(`Validating if message content matches character identity for: ${character.fullName}`);

        const validationTranslations = this.translations.character_validation || getTranslations('en').character_validation;

        // Get recent conversation history to provide context.
        const recentMessages = this.getMessagesForRecipient(character.id).slice(-5); // Get recent 5 messages as context.
        const conversationHistory = recentMessages.map(msg =>
            `${msg.name}: ${msg.content}`
        ).join('\n');

        // Get age description, adding a suffix based on the age group.
        let ageDescription = `${character.age}`;
        if (character.age >= 0 && character.age <= 3) {
            ageDescription += ` ${validationTranslations.age_suffix.infant}`;
        } else if (character.age >= 4 && character.age <= 5) {
            ageDescription += ` ${validationTranslations.age_suffix.toddler}`;
        } else if (character.age >= 6 && character.age <= 12) {
            ageDescription += ` ${validationTranslations.age_suffix.child}`;
        } else if (character.age >= 13 && character.age <= 16) {
            ageDescription += ` ${validationTranslations.age_suffix.teenager}`;
        }

        // Build validation prompt.
        const prompt: Message[] = [
            {
                role: "user",
                content: `${validationTranslations.prompt_assistant_role}

${validationTranslations.character_info}
- ${validationTranslations.name}: ${character.fullName}
- ${validationTranslations.short_name}: ${character.shortName}
- ${validationTranslations.title}: ${character.primaryTitle}
- ${validationTranslations.gender}: ${character.sheHe}
- ${validationTranslations.age}: ${ageDescription}
- ${validationTranslations.culture}: ${character.culture}
- ${validationTranslations.faith}: ${character.faith}
- ${validationTranslations.is_ruler}: ${character.isRuler ? validationTranslations.yes : validationTranslations.no}
- ${validationTranslations.is_independent_ruler}: ${character.isIndependentRuler ? validationTranslations.yes : validationTranslations.no}

${validationTranslations.recent_history}
${conversationHistory}

${validationTranslations.current_speaker}

${validationTranslations.message_content}
"${messageContent}"

${validationTranslations.instruction}`
            }
        ];

        try {
            // Call LLM API for validation.
            const response = await this.textGenApiConnection.complete(prompt, false, {
                max_tokens: 10,
                temperature: 0.1 // Use low temperature for consistency.
            }, undefined, this.abortController?.signal);

            const responseText = (response as any)?.trim() ?? '';
            console.log(`[DEBUG] Parsed response: ${responseText}`);

            // Stricter validation logic: explicitly check if it is "conforming".
            const isValid = responseText === validationTranslations.valid;
            console.log(`Character identity validation result for ${character.fullName}: ${isValid ? 'Valid' : 'Invalid'}`);
            return isValid;
        } catch (error) {
            console.error(`Error during character identity validation: ${error}. Defaulting to valid.`);
            // If an error occurs during validation, default to valid.
            return true;
        }
    }

    /**
     * Generate AI message with identity validation.
     * @param character - The character who should be speaking.
     */
    async generateNewAIMessageWithValidation(character: Character, isNonTargeted: boolean = false): Promise<Message | null> {
        console.log(`Generating AI message with identity validation for character: ${character.fullName}`);

        // Check if identity validation conditions are met: streaming disabled and character count greater than 2.
        const shouldValidate = !this.config.stream && this.gameData.characters.size > 2;

        if (!shouldValidate) {
            console.log(`Identity validation conditions not met (stream: ${this.config.stream}, character count: ${this.gameData.characters.size}). Generating message without validation.`);
            return await this.generateNewAIMessage(character, false, isNonTargeted);
        }

        let attempts = 0;
        const maxAttempts = 3;
        let validMessageGenerated = false;
        let validMessage: Message | null = null;

        while (attempts < maxAttempts && !validMessageGenerated) {
            attempts++;
            console.log(`Attempt ${attempts} to generate valid message for ${character.fullName}`);

            try {
                let generatedMessage: Message | null = null;

                // First attempt using normal generation method.
                if (attempts === 1) {
                    generatedMessage = await this.generateNewAIMessage(character, false, isNonTargeted);
                } else {
                    // Subsequent attempts use specific prompts to generate the message.
                    generatedMessage = await this.generateMessageWithValidationPrompt(character);
                }

                if (generatedMessage) {
                    // Validate if the message matches the character identity.
                    const isValid = await this.validateCharacterIdentity(character, generatedMessage.content);

                    if (isValid) {
                        console.log(`Generated valid message for ${character.fullName} on attempt ${attempts}`);
                        validMessage = generatedMessage;
                        validMessageGenerated = true;
                    } else {
                        console.log(`Generated invalid message for ${character.fullName} on attempt ${attempts}. Retrying.`);
                    }
                } else {
                    console.warn(`No valid message found for ${character.fullName} after generation.`);
                }
            } catch (error) {
                console.error(`Error generating message for ${character.fullName} on attempt ${attempts}: ${error}`);
                if (isAbortError(error)) {
                    throw error; // Re-throw cancellation error
                }
            }
        }

        if (validMessageGenerated && validMessage) {
            return validMessage;
        } else {
            console.warn(`Failed to generate valid message for ${character.fullName} after ${maxAttempts} attempts. Skipping this character.`);
            // Optionally send a notification to the user.
            this.chatWindow.window.webContents.send('error-message', ` ${character.fullName} did not speak.`);
            return null;
        }
    }

    /**
     * Use a specific prompt to generate the message (for retries after validation failure).
     * @param character - The character who should be speaking.
     * @returns Returns the generated message object.
     */
    async generateMessageWithValidationPrompt(character: Character): Promise<Message | null> {
        await this.ensureBackgroundReady(character);
        const spokenLanguageId = this.plannedLanguage(character);
        const proseEncoding = this.plannedProseEncoding(spokenLanguageId);
        const deliver = this.generatedDelivery();
        console.log(`Generating message with validation prompt for character: ${character.fullName}`);

        // Recovery must preserve the same persona, lore, backgrounds, scene and perception as the normal writer.
        const prompt = await buildChatPrompt(this, character, undefined, undefined, false, spokenLanguageId, proseEncoding);
        prompt.push({ role: 'system', content: 'Write a fresh reply for the established acting character using the complete context above. ' +
            'Keep the current speaker and addressee distinct, and return only the in-character reply.' });

        try {
            if (proseEncoding === 'controls-v1') return await this.completeControlledMessage(prompt, character, spokenLanguageId!, deliver,
                { max_tokens: this.config.maxTokens, temperature: this.config.textGenerationApiConnectionConfig.parameters.temperature });
            // 调用LLM API生成消息
            const response = await this.textGenApiConnection.complete(prompt, false, {
                max_tokens: this.config.maxTokens,
                temperature: this.config.textGenerationApiConnectionConfig.parameters.temperature
            }, undefined, this.abortController?.signal);

            if (!response || (response as any).trim?.() === '') {
                console.warn(`Empty response from LLM for character ${character.fullName}`);
                return null;
            }

            // 创建消息对象
            const isSelfTalk = this.gameData.characters.size === 1 && this.gameData.characters.has(this.gameData.playerID);
            const characterNameForResponse = isSelfTalk ? character.shortName : character.fullName;

            const message: Message = {
                role: "assistant",
                name: characterNameForResponse,
                characterId: character.id,
                spokenLanguageId,
                content: typeof response === 'string' ? response.trim() : response.content?.trim() ?? ''
            };

            console.log(`Generated message with validation prompt for ${character.fullName}: ${message.content.substring(0, 50)}...`);
            return deliver(message);
        } catch (error) {
            console.error(`Error generating message with validation prompt for ${character.fullName}: ${error}`);
            return null;
        }
    }

    async executeApprovedAction(messageId: string, actionName: string) {
        if (this.isOpen === false) return;
        const pending = this.pendingActions.get(messageId);
        if (!pending) {
            console.error(`No pending actions found for message ID ${messageId}`);
            return;
        }

        // Old callers may use a signature only when it identifies exactly one proposal.
        const byId = pending.filter(p => p.proposalId === actionName);
        const matches = byId.length ? byId : pending.filter(p => p.action.signature === actionName);
        const actionToExecute = matches.length === 1 ? matches[0] : undefined;
        if (!actionToExecute) {
            console.error(`Action ${actionName} not found in pending actions for message ID ${messageId}`);
            return;
        }

        const { action, args, sourceId, targetId } = actionToExecute;

        try {
            const chatMessage = action.chatMessageClass != null ?
                formatActionNotice(action, args, this.gameData, sourceId, targetId, this.config.language) : '';
            let effectBody = "";
            runActionWithScenePolicy(action, this.gameData, (text: string) => { effectBody += text; }, args, sourceId, targetId);
            ActionEffectWriter.appendEffect(
                this.runFileManager,
                this.gameData,
                sourceId,
                targetId,
                effectBody
            );

            if (action.signature === 'changeLocation' && this.gameData.sceneSnapshot) {
                if (effectBody) this.runFileManager.append('root = { trigger_event = mcc_event_v2.9003 }');
                await waitForSceneSelection(this.gameData);
            }

            // Hardcoded effect for leaveConversation
            if (action.signature === 'leaveConversation' || action.signature === 'killCharacter') {
                if (targetId === this.gameData.playerID) {
                    console.log(`Player is leaving or was killed. Ending session. Action: ${action.signature}`);
                    this.chatWindow.window.webContents.send('chat-hide');
                    this.chatWindow.hide();
                    if (this.isOpen) {
                        this.saveHistoryAndTriggerSummarization();
                    }
                } else {
                    this.removeCharacter(targetId);
                }
            }

            // Regenerate scene description if location changes
            if (action.signature === 'changeLocation' && !this.gameData.sceneSnapshot) {
                this.generateSceneDescription();
            }

            if (action.signature !== 'changeLocation' || !this.gameData.sceneSnapshot) this.runFileManager.append(`
                root = {trigger_event = mcc_event_v2.9003}                `
            );

            if (action.chatMessageClass != null) {
                const actionResponse: ActionResponse = {
                    actionName: action.signature,
                    chatMessage,
                    chatMessageClass: action.chatMessageClass
                };

                const existingActions = this.executedActions.get(messageId) || [];
                existingActions.push(actionResponse);
                this.executedActions.set(messageId, existingActions);

                this.chatWindow.window.webContents.send('actions-receive', [actionResponse], "");
            }

            console.log(`Action "${action.signature}" successfully executed after approval.`);
        } catch (e) {
            let errMsg = `Action error: failure in run function for action: ${action.signature}; details: `+e;
            console.error(errMsg);
            this.chatWindow.window.webContents.send('error-message', errMsg);
        }

        // Remove the executed action from pending
        const updatedPending = pending.filter(p => p !== actionToExecute);
        if (updatedPending.length === 0) {
            this.pendingActions.delete(messageId);
        } else {
            this.pendingActions.set(messageId, updatedPending);
        }
    }
    clearCachedSummaries(): void {
        this.summaries.clear();
        this.summaryFileWatcher.unwatchAll();
    }
    public memoryCompactor: MemoryCompactor;

    async resummarize(preservePendingInput = false): Promise<void> {
        if (this.summaryOperation) return this.summaryOperation;
        this.summaryOperation = this.performResummarize(preservePendingInput);
        try { await this.summaryOperation; } finally { this.summaryOperation = undefined; }
    }

    private async performResummarize(preservePendingInput = false){
        this.ledger();
        if (this.config.enableMemoryCompaction) {
            console.log('Starting agentic memory compaction due to context limit.');
            try {
                const result = await this.memoryCompactor.compact(this, { preservePendingInput });

                // After compaction, vectorize the new memories and insert them into the vector store.
                if (result.newlyCompactedMemories && result.newlyCompactedMemories.length > 0) {
                    await this.vectorizeCompactedMemories(result.newlyCompactedMemories);
                }
                if (result.phase1Run) {
                    console.log(`Compaction Phase 1 complete. Accuracy: ${((result.accuracyScore ?? 0) * 100).toFixed(1)}%`);
                    if (result.metrics) {
                        console.log(`Compaction metrics: memory ${(result.metrics.memoryBeforeBytes / 1024 / 1024).toFixed(1)}MB → ${(result.metrics.memoryAfterBytes / 1024 / 1024).toFixed(1)}MB, duration ${result.metrics.totalDurationMs}ms (P1: ${result.metrics.phase1DurationMs}ms, P2: ${result.metrics.phase2DurationMs}ms), serialization ${result.metrics.serializationTimeMs}ms, accuracy ${(result.metrics.accuracyScore * 100).toFixed(1)}%`);
                    }
                    // Messages are already removed from conv.messages by MemoryCompactor.compact()
                }
                if (result.phase2Run) {
                    console.log('Compaction Phase 2 complete.');
                }

                // After compaction, recalculate the new base prompt size and send it to the UI
                const newBaseTokens = await this.calculateBasePromptTokens();
                this.chatWindow.window.webContents.send('update-base-tokens', newBaseTokens);
                console.log(`Recalculated and updated base tokens after compaction: ${newBaseTokens}`);
                return;
            } catch (error) {
                console.error('Memory compaction failed:', error);
                // Fall through to the legacy resummarize logic below as a safety net.
                // The compaction lock is already cleared by MemoryCompactor.compact()'s finally block.
            }
        }
        {
            const messagesToSummarize = this.rollingSummaryRange();
            if (!messagesToSummarize.length) return;
            const revision = this.ledger().revision;
            const owners = this.hasLanguageMessages() ? [...this.gameData.characters.keys()] : [this.gameData.aiID];
            const results = new Map<number, string>();
            for (const owner of owners) {
                if (!this.getMessagesForRecipient(owner, messagesToSummarize).length) continue;
                results.set(owner, await this.summaryCache().generate(this.summarizationApiConnection,
                    this.rollingSummaryPrompt(messagesToSummarize, owner), false, this.abortController?.signal));
            }
            if (revision !== this.ledger().revision) throw new Error('Conversation changed during summarization; history was retained');
            for (const [owner, content] of results) this.recipientCurrentSummaries.set(owner, content);
            this.currentSummary = results.get(this.gameData.aiID) ?? this.currentSummary;
            const ids = new Set(messagesToSummarize.map(message => message.id));
            this.messages = this.messages.filter(message => !ids.has(message.id));

        }
    }

    /**
     * §9.3 P5.4 fix C1: returns the requestKey UUID for the current
     * close-request lifecycle. Generates a UUID on the first call and reuses
     * it on any subsequent call within the same close so journal rule 1
     * "same-close reuse" can fire if a retry path is ever added; today
     * summarize() performs exactly one attempt per close, so the reuse branch
     * is reserved for future retries only. Cleared by clearCloseRequestKey()
     * when the attempt reaches terminal state.
     */
    private getOrCreateCloseRequestKey(): string {
        if (!this.currentCloseRequestKey) {
            this.currentCloseRequestKey = `conv:${randomUUID()}`;
        }
        return this.currentCloseRequestKey;
    }

    /**
     * §9.3 P5.4 fix C1: clears the stored close-request requestKey. Called
     * when the current close-request's attempt reaches terminal state so the
     * next close generates a fresh UUID. Idempotent (no-op if no key was set).
     */
    private clearCloseRequestKey(): void {
        this.currentCloseRequestKey = undefined;
    }

    /**
     * Vectorizes newly compacted memories and inserts them into the shared vector
     * store so they become semantically searchable. Used after memory compaction
     * (automatic via resummarize, or manual via the Memories tab button).
     */
    public async vectorizeCompactedMemories(memories: CompactedMemory[]): Promise<void> {
        if (!memories || memories.length === 0 || !this.config.embeddingApiConnectionConfig) {
            return;
        }
        console.log(`Vectorizing ${memories.length} new compacted memories.`);
        await this.embedAndInsertMemories(memories.map(m => ({
            id: m.id,
            characterId: m.characterIds[0]?.toString() || '', // Primary character
            text: compactedMemoryText(m, m.characterIds[0], undefined, this.getCompactedMemoriesForRecipient(m.characterIds[0])),
            timestamp: m.creationTimestamp,
            gameDate: m.gameDate,
            perspectiveOwned: m.recipientPerspectiveId !== undefined
        })));
    }

    /**
     * Shared helper: embeds texts with the configured embedding provider and
     * batch-inserts them into the shared MemoryManager, then runs decay and
     * consolidation upkeep for every affected character. Never throws —
     * individual embedding failures are logged and skipped. Returns the number
     * actually inserted so a partial batch is not reported as a full success.
     */
    private async embedAndInsertMemories(items: { id?: string; characterId: string; text: string; timestamp?: number; gameDate?: string; scene?: string; perspectiveOwned?: boolean }[]): Promise<number> {
        // ponytail: letter and diary memories are not currently vectorized into the
        // memory DB (only conversation summaries + compacted memories are), so the
        // UI 'Letter'/'Diary' location labels have no producer yet. Upgrade path:
        // call embedAndInsertMemories with scene='letter'/'diary' and gameDate from
        // LetterManager/diaryManager when letter/diary memory embedding is wired.
        if (items.length === 0 || !this.config.embeddingApiConnectionConfig) {
            return 0;
        }
        const { connection } = this.config.embeddingApiConnectionConfig;
        const embeddingProvider = new EmbeddingProvider(connection.type as any, connection.model, connection.baseUrl, connection.key, getEffectiveEmbeddingDimension(connection), connection.embeddingInputType);

        const sourceRevision = items.some(item => item.perspectiveOwned) ? this.ledger().revision : undefined;
        const memoriesToInsert: Memory[] = [];
        for (const item of items) {
            try {
                const embedding = await embeddingProvider.embed(item.text);
                memoriesToInsert.push({
                    id: item.id ?? randomUUID(),
                    characterId: item.characterId,
                    playerId: this.gameData.playerID.toString(),
                    scene: item.scene ?? (this.gameData.scene || ''),
                    text: item.text,
                    vector: embedding,
                    timestamp: item.timestamp ?? Date.now(),
                    emotion: 'neutral', // TODO: Derive emotion from content
                    decay: 0,
                    accessCount: 0,
                    lastAccessed: Date.now(),
                    gameDate: item.gameDate || ''
                });
            } catch (e) {
                console.error(`Failed to generate embedding for memory ${item.id ?? item.characterId}:`, e);
            }
        }

        if (sourceRevision !== undefined && sourceRevision !== this.ledger().revision) return 0;
        if (memoriesToInsert.length > 0) {
            this.memoryManager.batchInsertMemories(memoriesToInsert);
            // Fire-and-forget: lets main broadcast a Memories-tab refresh without blocking.
            this.onMemoriesEmbedded?.();

            // Automatic upkeep: decay stale memories and consolidate near-duplicates
            // for every character that just received new memories.
            const charIds = new Set(memoriesToInsert.map(m => m.characterId).filter(Boolean));
            for (const cid of charIds) {
                try {
                    this.memoryManager.applyDecay(cid, 0.01, 1, String(this.gameData.playerID));
                    // Keep retractable language-derived vectors under their source IDs.
                    if (!items.some(item => item.characterId === cid && item.perspectiveOwned))
                        this.memoryManager.consolidateMemories(cid, 0.85, String(this.gameData.playerID));
                } catch (e) {
                    console.error(`Memory upkeep (decay/consolidation) failed for character ${cid}:`, e);
                }
            }
        }
        return memoriesToInsert.length;
    }

    private buildCloseConversationEffect(checkpointEpoch: number, timeline?: CreateChildNodeResult, receiptNonce?: string): string {
        let timelineLines = '';
        let nodeLogSegment = '';
        const checkpointToken = timeline?.context.checkpointToken;
        const checkpointTokenLines = typeof checkpointToken === 'number' && Number.isInteger(checkpointToken) && checkpointToken > 0
            ? [
                `    set_variable = { name = votc_checkpoint_token value = ${checkpointToken} }`,
                '    remove_variable ?= votc_checkpoint_pending_token'
            ].join('\n')
            : '';
        if (timeline) {
            const [na, nb] = timeline.nodeId.split('-');
            const [pa, pb] = (timeline.parentId ?? '0-0').split('-');
            timelineLines = [
                `    set_variable = { name = votc_timeline_node_a value = ${na} }`,
                `    set_variable = { name = votc_timeline_node_b value = ${nb} }`,
                `    set_variable = { name = votc_timeline_parent_a value = ${pa} }`,
                `    set_variable = { name = votc_timeline_parent_b value = ${pb} }`,
                `    set_variable = { name = votc_timeline_schema value = 1 }`
            ].join('\n');
            nodeLogSegment = `/;/${na}/;/${nb}/;/${pa}/;/${pb}`;
        }
        // CE2's console run is rooted at the player, as in EncounterCapture and
        // ActionEffectWriter. The old single-chat talk_first_scope is not set by
        // its multi-character encounter and cannot receive this checkpoint.
        return `root = {
    set_variable = { name = votc_checkpoint_epoch value = ${checkpointEpoch} }
    set_variable = { name = votc_checkpoint_day value = current_date }
${checkpointTokenLines}
${timelineLines}
    debug_log = "VOTC:CHECKPOINT/;/set/;/[THIS.Char.GetID]/;/${checkpointEpoch}${nodeLogSegment}/;/[GetCurrentDate.GetStringShort]"
}
${receiptNonce ? closeCheckpointReceiptEffect(receiptNonce) : ''}
          trigger_event = mcc_event_v2.9002
          trigger_event = mcc_event_v2.9003`;
    }

    public async saveHistoryAndTriggerSummarization(): Promise<void> {
        this.closingWorkCount++;
        try {
        console.log('Saving conversation history and triggering background summarization.');
        this.isOpen = false;
        this.cancelBackgroundPreparation();
        const nextCheckpointEpoch = this.gameData.votcCheckpointEpoch + 1;
        this.cancelGeneration(); // Cancel any ongoing generation.

        // Node/epoch this close commits, used to stamp the summaries written
        // below. Stays undefined when the close could not advance the
        // checkpoint (legacy mod, timeline failure): those summaries are then
        // unlabelled and visible everywhere, exactly like pre-timeline data.
        let closeStamp: { checkpointEpoch: number, timelineNodeId: string } | undefined;

        // §9.3 P5.4 fix C1: wrap the close-request lifecycle in try/finally so
        // the stored requestKey UUID is cleared regardless of outcome (success,
        // fail-closed identity error, or unexpected throw). Idempotent.
        try {
            // §4.1: capture the campaign identity captured at conversation
            // start; §9: fail closed when it is missing (legacy Mod) - do NOT
            // fall back to a player-only timeline write.
            let timeline: CreateChildNodeResult | undefined;
            try {
                if (!this.campaignIdentity) {
                    throw new CampaignIdentityUnavailableError(
                        'legacy-mod',
                        'Campaign identity unavailable: the mod does not emit a v2 campaign id. Update the mod to a matching version.'
                    );
                }
                const requestKey = this.getOrCreateCloseRequestKey();
                const eventSignature = `conv:${this.gameData.playerID}_${this.gameData.aiID}_${this.gameData.date}_${nextCheckpointEpoch}`;
                const transition = await runConversationTimelineTransition({
                    userDataDir: app.getPath('userData'),
                    gameData: this.gameData,
                    identity: this.campaignIdentity,
                    requestKey,
                    eventSignature,
                    targetEpoch: nextCheckpointEpoch,
                    scopeVar: 'talk_first_scope'
                });
                // Adapt SourceTransitionResult -> CreateChildNodeResult so the
                // existing buildCloseConversationEffect + downstream callers
                // continue to work without churn.
                timeline = {
                    nodeId: transition.targetNodeId,
                    parentId: transition.context.timelineParentId ?? null,
                    script: transition.script,
                    context: transition.context,
                    createdNewRoot: false
                };
                console.log(`Timeline node created: ${timeline.nodeId} (parent: ${timeline.parentId ?? 'null'}, attempt: ${transition.attemptId}, reused: ${transition.reused})`);
            } catch (error) {
                if (error instanceof CampaignIdentityUnavailableError) {
                    reportCampaignIdentityUnavailable(error);
                } else if (error instanceof TimelineRegistryCorruptError) {
                    reportCorruptTimelineRegistry(error);
                } else if (error instanceof TimelineParentNotFoundError) {
                    reportTimelineParentNotFound(error);
                } else if (error instanceof UnsupportedTimelineSchemaError) {
                    reportUnsupportedTimelineSchema(error.schema);
                }
                // Closing the CK3 event window is a UI safety operation and
                // must not depend on timeline persistence succeeding. Keep the
                // failure visible in the log, then fall back to a close-only
                // run script that does not advance checkpoint state.
                console.error('[Conversation] Timeline transition failed while closing; sending the CK3 close event without a checkpoint update:', error);
            }

            // Write a trigger event to the game (e.g., trigger conversation end event)
            if (this.closeEffectAllowed?.() !== false) {
            const receiptNonce = timeline ? randomUUID() : undefined;
            const command = timeline
                ? this.buildCloseConversationEffect(nextCheckpointEpoch, timeline, receiptNonce)
                : CLOSE_CONVERSATION_ONLY_EFFECT;
            const gameLogPath = path.join(this.config.userFolderPath, 'logs', 'debug.log');
            const runFilePath = path.join(this.config.userFolderPath, 'run', ceCommandFile(this.config.userFolderPath, 'votc.txt'));
            let offset = 0;
            try { offset = fs.statSync(gameLogPath).size; } catch { /* The receipt watcher reports unavailable. */ }
            const published = await this.runFileManager.writeAfterPending(command, () => this.closeEffectAllowed?.() !== false)
                .catch(error => { console.error('Could not publish conversation close:', error); return false; });
            if (!published) console.warn('Conversation close withheld: the pending command was not consumed or this encounter was superseded.');
            if (published && timeline) {
                closeStamp = {checkpointEpoch: nextCheckpointEpoch, timelineNodeId: timeline.nodeId};
                const started = Date.now();
                const allowed = () => this.closeEffectAllowed?.() !== false;
                const clearOwnedCommand = () => {
                    // Superseding a lease can leave its old command on disk. Exact
                    // ownership permits retracting it without clearing a newer command.
                    if (!ownsCloseCommand(runFilePath, command, () => true)) return;
                    this.runFileManager.clear();
                    console.log('Owned conversation close command cleared.');
                };
                // History is saved immediately below. Its node remains hidden on any
                // game branch that has not observed the corresponding checkpoint.
                // Receipt waiting neither delays the window nor adds a model pass.
                void waitForCloseCheckpoint({ gameLogPath, runFilePath, command, offset, allowed,
                    expected: { nonce: receiptNonce!, playerId: this.gameData.playerID,
                        epoch: nextCheckpointEpoch, nodeId: timeline.nodeId } }).then(result => {
                    if (result === 'superseded') { clearOwnedCommand(); return; }
                    if (result === 'confirmed') {
                        console.log('CK3 confirmed the player conversation checkpoint.');
                        clearOwnedCommand();
                    } else {
                        console.warn('CK3 conversation checkpoint was not confirmed (' + result +
                            '); saved records remain scoped to the unobserved node.');
                        const remaining = Math.max(0, 4000 - (Date.now() - started));
                        if (remaining) setTimeout(clearOwnedCommand, remaining);
                        else clearOwnedCommand();
                    }
                }).catch(error => console.error('Conversation close receipt check failed:', error));
            } else if (published) {
                setTimeout(() => {
                    if (!ownsCloseCommand(runFilePath, command, () => this.closeEffectAllowed?.() !== false)) return;
                    this.runFileManager.clear();
                    console.log('Run file cleared after conversation end event.');
                }, 500);
            }
            }
        } finally {
            this.clearCloseRequestKey();
        }

        // --- Part 1: Synchronous History Saving ---
        // Pass the committed node so the transcript file carries the _tl_ tag;
        // when the timeline commit failed but the mod is v2, fall back to the
        // current-epoch ckpt tag (legacy "VOTC checkpoint: N" semantics).
        this._saveHistoryToFile(
            closeStamp ?? (this.campaignIdentity
                ? { checkpointEpoch: this.gameData.votcCheckpointEpoch }
                : undefined)
        );

        // --- Part 2: Asynchronous Summarization (no await, runs in background) ---
        this.closingWorkCount++;
        this._generateSummariesAndDiariesInBackground(closeStamp).catch(err => {
            console.error("Error during background summarization and diary generation:", err);
        }).finally(() => {
            this.closingWorkCount--;
            this.releaseCompactorAfterClose();
        });
        } finally {
            this.closingWorkCount--;
            this.releaseCompactorAfterClose();
        }
    }

    private _saveHistoryToFile(stamp?: { timelineNodeId?: string; checkpointEpoch?: number }): void {
        try {
            // Ensure the conversation_history directory exists
            const historyDir = path.join(this.votcDataPath, 'conversation_history' ,this.gameData.playerID.toString());

            if (!fs.existsSync(historyDir)) {
              fs.mkdirSync(historyDir, { recursive: true });
              console.log(`Created conversation history directory: ${historyDir}`);
            }

            const ledger = this.ledger();
            for (const message of ledger.messages) {
                const actions = this.executedActions.get(message.id!);
                if (actions?.length) message.actions = actions.map(action => ({ ...action }));
            }
            // Compatibility player export uses the complete perspective, including compacted turns.
            const messagesToSave = this.getHistory().filter(msg => (msg.role === 'user' || msg.role === 'assistant' || msg.role === 'system') && msg.content !== this.notSpokenYetText);
            const processedMessages = messagesToSave.map((msg, index) => {
              const messageData: any = {
                id: msg.id,
                name: msg.name,
                content: msg.content,
                type: (msg as any).type
              };

              return messageData;
            });

            // Build the text content to be saved
            let textContent = `Date: ${this.gameData.date}\n`;
            if (this.gameData.scene && this.gameData.scene.trim()) {
                textContent += `Scene: ${this.gameData.scene}\n`;
            }
            if (this.gameData.location && this.gameData.location.trim()) {
                textContent += `Location: ${this.gameData.location}\n`;
            }
            textContent += '\n';

            const narrativeLabels = {
                en: "[Narrative]:",
                zh: "[旁白]:",
                ru: "[Повествование]:",
                fr: "[Récit]:",
                es: "[Narrativa]:",
                de: "[Erzählung]:",
                ja: "[ナラティブ]:",
                ko: "[내레이션]:",
                pl: "[Narracja]:",
                pt: "[Narrativa]:"
            };
            const narrativeLabel = narrativeLabels[this.config.language] || narrativeLabels.en;

            processedMessages.forEach((msg, index) => {
                if (msg.type === 'narrative' || msg.name === 'Narrator') {
                    textContent += `${narrativeLabel} ${msg.content}\n`;
                } else if (msg.type === 'scene') {
                    textContent += `[Scene]: ${msg.content}\n`;
                } else if (msg.name) {
                    textContent += `${msg.name}: ${msg.content}\n`;
                } else {
                    textContent += `${msg.content}\n`;
                }

                const actions = this.executedActions.get(msg.id);
                if (actions && actions.length > 0) {
                    const actionLabel = getEffectivePrompts(this.config, this.votcDataPath, this.gameData)?.actionTriggeredPrompt || "[Action Triggered]:";
                    actions.forEach(action => {
                        textContent += `${actionLabel} ${action.chatMessage}\n`;
                    });
                }

              textContent += '\n';
            });

            // Store the message text for generating summaries in txt format.
            // Timeline-tagged names (_tl_<nodeA>-<nodeB>_) let history reads
            // filter by branch graph visibility; the _ckptN_ fallback keeps
            // epoch filtering alive when no node committed (timeline failure
            // with a v2 mod). Untagged stays the legacy always-visible shape.
            const allCharacterIds = this.ledger().characters.map(character => character.id);
            const characterIdsString = allCharacterIds.join('_');
            const stampSegment = stamp?.timelineNodeId
                ? `_tl_${stamp.timelineNodeId}`
                : stamp?.checkpointEpoch !== undefined
                    ? `_ckpt${stamp.checkpointEpoch}`
                    : '';
            const historyFile = path.join(
                this.votcDataPath,
                'conversation_history',
                this.gameData.playerID.toString(),
                `${characterIdsString}${stampSegment}_${new Date().getTime()}.txt`
            );
            fs.writeFileSync(historyFile, textContent);
            const snapshot = validateLedger(ledger.snapshot(this.gameData.date, this.gameData.playerID, { scene: this.gameData.scene, location: this.gameData.location }));
            saveLedgerHistory(historyDir, path.basename(historyFile, '.txt'), snapshot);
            console.log(`Conversation history saved to: ${historyFile}`);

            // Mirror the transcript into the campaign store so identity-aware
            // history reads see new saves without a migration pass.
            if (this.campaignIdentity) {
                try {
                    const campaignHistoryDir = campaignConversationHistoryDir(app.getPath('userData'), this.campaignIdentity);
                    fs.mkdirSync(campaignHistoryDir, { recursive: true });
                    const campaignHistoryFile = path.join(campaignHistoryDir, path.basename(historyFile));
                    fs.writeFileSync(campaignHistoryFile, textContent);
                    // Both indexes refer to the same authoritative record, never duplicate recipient transcripts.
                    saveLedgerHistory(campaignHistoryDir, path.basename(historyFile, '.txt'), snapshot, historyDir);
                    console.log(`Conversation history mirrored to campaign store: ${campaignHistoryFile}`);
                } catch (mirrorError) {
                    console.error('Failed to mirror conversation history to the campaign store:', mirrorError);
                }
            }
        } catch (error) {
            console.error("Failed to save conversation history synchronously:", error);
        }
    }

    private async generateEncounterSummary(character: Character, prompt: Message[]): Promise<string> {
        const api = this.summarizationApiConnection;
        const budget = api.context ? api.context * 0.7 : Infinity;
        const count = (messages: Message[]) => api.calculateTokensFromChat?.(messages) ?? 0;
        const complete = async (messages: Message[]) => {
            const input = api.isChat() ? messages : convertChatToTextNoNames(messages, this.config);
            const result = await api.complete(input, false, {}, undefined, undefined, 300_000, 'background-resumable');
            const content = typeof result === 'string' ? result : result?.content ?? '';
            if (!content.trim()) throw new Error('Empty encounter summary');
            return content;
        };
        const heard = this.getEncounterMessagesForRecipient(character.id);
        const retain = (content: string) => appendPrivateNarration(content, collectPrivateNarration(heard, character.id, this.gameData.date));
        if (count(prompt) <= budget) return retain(await complete(prompt));
        let previous = '', batch: Message[] = [];
        for (const message of heard) {
            const candidate = buildResummarizeChatPrompt(this, [...batch, message], character.id, previous);
            if (batch.length && count(candidate) > budget) {
                previous = await complete(buildResummarizeChatPrompt(this, batch, character.id, previous));
                batch = [];
            }
            batch.push(message);
            if (count(buildResummarizeChatPrompt(this, batch, character.id, previous)) > budget)
                throw new Error('A single turn exceeds the summary context; full history remains archived');
        }
        return retain(batch.length ? await complete(buildResummarizeChatPrompt(this, batch, character.id, previous)) : previous);
    }

    private async _generateSummariesAndDiariesInBackground(closeStamp?: { checkpointEpoch: number, timelineNodeId: string }) {
        const memoryScope = this.getCompactedMemoryScope();
        if (memoryScope && closeStamp && this.memoryCompactor) {
            try { await this.memoryCompactor.finalizeEncounterScope(String(this.gameData.playerID), memoryScope, closeStamp); }
            catch (error) { console.error('Encounter compacted memories remain provisional after close:', error); }
        }
        const hasDialogue = this.ledger().messages.some(
            msg => (msg.role === 'user' || msg.role === 'assistant') && msg.content !== this.notSpokenYetText
        );

        if (!hasDialogue) {
            console.log("No actual dialogue occurred. Skipping summary and diary generation.");
            return;
        }

        const closeRevision = this.ledger().revision;
        const verifyCloseRevision = () => {
            if (closeRevision !== this.ledger().revision) throw new Error('Encounter changed; stale background memory was discarded');
        };
        console.log('Starting background diary and summary generation.');
        try {
            // Generate and save diary entries for each character
            for (const character of this.ledger().characters) {
                // @ts-ignore - diaryGenerationChance is a custom property we added
                const diaryChance = this.config.diaryGenerationChance / 100;
                const wasInvolvedInAction = this.actionInvolvedCharacterIds.has(character.id);

                if (diaryChance > 0 && (wasInvolvedInAction || Math.random() < diaryChance)) {
                    if (wasInvolvedInAction) {
                        console.log(`Forcing diary entry for ${character.shortName} due to action involvement.`);
                    }
                    const newDiaryEntry = await this.diaryGenerator.generateDiaryEntry(this.gameData, this, character.id.toString(), 'background-resumable');
                    if (newDiaryEntry) {
                        verifyCloseRevision();
                        const diaryStamp = { ...(this.campaignIdentity ? { votcCampaignId: this.campaignIdentity.campaignId } : {}),
                            votcCheckpointEpoch: closeStamp?.checkpointEpoch ?? this.gameData.votcCheckpointEpoch,
                            ...(closeStamp ? { votcTimelineNodeId: closeStamp.timelineNodeId } : {}) };
                        Object.assign(newDiaryEntry, diaryStamp);
                        await saveDiaryFile(this.gameData.playerID.toString(), character.id.toString(), newDiaryEntry);

                        // Re-summarize the diary with the new entry
                        const summaryResult = await this.diaryGenerator.summarizeDiaryEntry(newDiaryEntry, this.gameData, 'background-resumable');
                        if (summaryResult) {
                            const summaries = await readDiarySummaries(this.gameData.playerID.toString(), character.id.toString());
                            verifyCloseRevision();
                            summaries.unshift({ id: randomUUID(), ...summaryResult, ...diaryStamp });
                            await saveDiarySummaries(this.gameData.playerID.toString(), character.id.toString(), summaries);
                        }
                    }
                }
            }

            // Do not generate a summary if there are not enough messages
            if (this.ledger().messages.length < 2) {
                console.log("Not enough messages to generate a summary (less than 2). Skipping summary generation.");
                return;
            }

            const summaryDirForMap = path.join(this.votcDataPath, 'conversation_summaries', this.gameData.playerID.toString());
            fs.mkdirSync(summaryDirForMap, { recursive: true });
            const characterMapPath = path.join(summaryDirForMap, '_character_map.json');
            let characterMap: {[key: number]: string} = {};
            if (fs.existsSync(characterMapPath)) {
                try {
                    characterMap = JSON.parse(fs.readFileSync(characterMapPath, 'utf8'));
                } catch (e) {
                    console.error('Error reading existing character map:', e);
                }
            }
            for (const char of this.ledger().characters) {
                if (!characterMap[char.id]) {
                    characterMap[char.id] = char.shortName;
                }
            }
            fs.writeFileSync(characterMapPath, JSON.stringify(characterMap, null, '\t'));
            console.log(`Updated character map at: ${characterMapPath}`);

            const newSummariesToEmbed: { characterId: string; content: string }[] = [];
            for (const character of this.ledger().characters) {
                const isPlayerSummary = character.id === this.gameData.playerID;
                if (isPlayerSummary && !this.hasLanguageMessages()) continue;

                // Build a character-specific prompt
                const prompt = buildSummarizeChatPrompt(this, character);

                // Generate summary from this character's perspective
                const result = await this.generateEncounterSummary(character, prompt);
                verifyCloseRevision();
                const summaryContent = result;

                const newSummary: Summary = {
                    date: this.gameData.date,
                    content: summaryContent,
                    ...(this.campaignIdentity ? { votcCampaignId: this.campaignIdentity.campaignId } : {}),
                    ...(closeStamp
                        ? {
                            votcCheckpointEpoch: closeStamp.checkpointEpoch,
                            votcTimelineNodeId: closeStamp.timelineNodeId
                        }
                        : {})
                };
                console.log(`ursation from ${character.fullName}'s perspective: ${newSummary.content.substring(0, 100)}...`);

                const summaryDir = path.join(this.votcDataPath, 'conversation_summaries', this.gameData.playerID.toString());
                const summaryFile = path.join(summaryDir, `${character.id.toString()}.json`);

                this.summaryFileWatcher.pauseWatcher(summaryFile);

                fs.mkdirSync(summaryDir, { recursive: true });
                const existingSummaries: Summary[] = fs.existsSync(summaryFile) ? JSON.parse(fs.readFileSync(summaryFile, 'utf8')) : [];
                if (!Array.isArray(existingSummaries)) throw new Error('Invalid summary file.');

                const isErrorText = /low balance|not enough credits|top up|api error|too many requests|rate limit/i.test(newSummary.content);
                if (isErrorText) {
                    console.warn(`Summary content looks like an API/billing error for character ${character.id}, skipping save and vectorization: ${newSummary.content.substring(0, 100)}...`);
                    this.summaryFileWatcher.resumeWatcher(summaryFile);
                    continue;
                }

                if (newSummary.content.trim()) {
                    existingSummaries.unshift(newSummary);
                    if (!isPlayerSummary) newSummariesToEmbed.push({ characterId: character.id.toString(), content: newSummary.content });
                    fs.writeFileSync(summaryFile, JSON.stringify(existingSummaries, null, '\t'));
                    console.log(`Saved updated summaries for AI ID ${character.id} to ${summaryFile}. Total summaries: ${existingSummaries.length}`);
                } else {
                    console.log(`Skipping saving empty summary for AI ID ${character.id}.`);
                }

                this.summaryFileWatcher.resumeWatcher(summaryFile);
            }

            // Fire-and-forget: embed the new conversation summaries into the vector
            // store so they become semantically searchable. Never blocks teardown.
            if (newSummariesToEmbed.length > 0 && this.config.embeddingApiConnectionConfig) {
                void this.embedAndInsertMemories(
                    newSummariesToEmbed.map(s => ({ characterId: s.characterId, text: s.content, gameDate: this.gameData.date, scene: this.gameData.scene || '' }))
                ).then(inserted => {
                    console.log(`Inserted ${inserted} of ${newSummariesToEmbed.length} summary memories into the vector store.`);
                }).catch(err => {
                    console.error('Failed to embed conversation summaries into the vector store:', err);
                });
            }
        } catch (error) {
            if (isAbortError(error)) {
                console.warn('Background summarization request timed out or was aborted; summaries for this conversation were not generated.');
            } else {
                console.error("Error in background summary/diary generation process:", error);
            }
        }
    }

    // Generate recommended input statements
    public async generateSuggestions(): Promise<string[]> {
        await this.refreshCurrentLanguageFacts(this.encounterLifetime.signal);
        return generateSuggestions(this);
    }

    /**
     * Cleanup resources and stop file watching.
     */
    public cleanup(): void {
        if (this.summaryPreparationTimer) clearTimeout(this.summaryPreparationTimer);
        this.perspectiveSummaries?.clear();
        if (this.summaryFileWatcher) {
            this.summaryFileWatcher.unwatchAll();
            // Ensure all paused watchers are cleaned up.
            this.summaryFileWatcher.clearPausedWatchers();
            console.log('Cleaned up summary file watchers and paused watchers');
        }
        // Clean up memory compactor resources
        this.compactorReleaseRequested = true;
        this.releaseCompactorAfterClose();
    }

    /** A replacement or lost game target cancels work without issuing a close effect to another game encounter. */
    public retireWithoutGame(): void {
        if (this.isOpen === false) { this.cleanup(); return; }
        try { this.persistLedger(); } catch (error) { console.error('Could not retain the interrupted encounter checkpoint:', error); }
        this.isOpen = false;
        this.ledger().changed(); // Pending compaction/summary results can no longer publish against this revision.
        this.cancelBackgroundPreparation();
        this.cancelGeneration();
        this.cleanup();
    }

    private releaseCompactorAfterClose(): void {
        if (!this.compactorReleaseRequested || this.closingWorkCount) return;
        this.compactorReleaseRequested = false;
        this.memoryCompactor?.cleanup();
    }

    updateConfig(config: Config){
        console.log("Config updated! Reloading conversation configuration.");
        this.config = config;
        this.loadConfig();
        if (this.memoryCompactor) this.memoryCompactor.initialize(this.config);
    }

    loadConfig(){
        console.log('Loading conversation configuration.');
        console.log('Current config (safe version):', this.config.toSafeConfig());

        // Configuration changes cannot erase an effect awaiting CK3's receipt.
        this.runFileManager = new RunFileManager(this.config.userFolderPath);

        // Re-initialize API connections with the new config
        if (!this.config.textGenerationApiConnectionConfig) {
            console.error("CRITICAL: textGenerationApiConnectionConfig is missing from config in loadConfig! A dummy object has been created to prevent a crash, but the configuration is likely invalid.");
            this.config.textGenerationApiConnectionConfig = {
                connection: {
                    type: 'custom',
                    baseUrl: '',
                    key: '',
                    model: '',
                    apiKeys: {},
                    forceInstruct: false,
                    overwriteContext: false,
                    customContext: 0,
                } as any,
                parameters: {}
            };
        }
        if (!this.config.summarizationApiConnectionConfig) {
            console.error("CRITICAL: summarizationApiConnectionConfig is missing from config in loadConfig! A dummy object has been created to prevent a crash, but the configuration is likely invalid.");
            this.config.summarizationApiConnectionConfig = {
                connection: {
                    type: 'custom',
                    baseUrl: '',
                    key: '',
                    model: '',
                    apiKeys: {},
                    forceInstruct: false,
                    overwriteContext: false,
                    customContext: 0,
                } as any,
                parameters: {}
            };
        }
        if (!this.config.actionsApiConnectionConfig) {
            console.error("CRITICAL: actionsApiConnectionConfig is missing from config in loadConfig! A dummy object has been created to prevent a crash, but the configuration is likely invalid.");
            this.config.actionsApiConnectionConfig = {
                connection: {
                    type: 'custom',
                    baseUrl: '',
                    key: '',
                    model: '',
                    apiKeys: {},
                    forceInstruct: false,
                    overwriteContext: false,
                    customContext: 0,
                } as any,
                parameters: {}
            };
        }
        this.textGenApiConnection = new ApiConnection(this.config.textGenerationApiConnectionConfig.connection, this.config.textGenerationApiConnectionConfig.parameters, this.encoder);
        this.summarizationApiConnection = this.config.summarizationUseTextGenApi
            ? new ApiConnection(this.config.textGenerationApiConnectionConfig.connection, this.config.summarizationApiConnectionConfig.parameters, this.encoder)
            : new ApiConnection(this.config.summarizationApiConnectionConfig.connection, this.config.summarizationApiConnectionConfig.parameters, this.encoder);
        this.actionsApiConnection = this.config.actionsUseTextGenApi
            ? new ApiConnection(this.config.textGenerationApiConnectionConfig.connection, this.config.actionsApiConnectionConfig.parameters, this.encoder)
            : new ApiConnection(this.config.actionsApiConnectionConfig.connection, this.config.actionsApiConnectionConfig.parameters, this.encoder);

        // Safely initialize embedding connection
        if (this.config.embeddingApiConnectionConfig) {
            this.embeddingApiConnection = new ApiConnection(this.config.embeddingApiConnectionConfig.connection, this.config.embeddingApiConnectionConfig.parameters, this.encoder);
        } else {
            console.warn("Embedding API connection config not found. Using text generation API as a fallback for embeddings.");
            this.embeddingApiConnection = this.textGenApiConnection;
        }

        this.loadActions();
    }

    getApiConnections() {
        this.textGenApiConnection = new ApiConnection(this.config.textGenerationApiConnectionConfig.connection, this.config.textGenerationApiConnectionConfig.parameters, this.encoder);
        console.log('Text generation API connection configured.');

        if(this.config.summarizationUseTextGenApi){
            this.summarizationApiConnection = new ApiConnection(this.config.textGenerationApiConnectionConfig.connection, this.config.summarizationApiConnectionConfig.parameters, this.encoder);
            console.log('Summarization API connection configured (using text generation API).');
        } else {
            this.summarizationApiConnection = new ApiConnection(this.config.summarizationApiConnectionConfig.connection, this.config.summarizationApiConnectionConfig.parameters, this.encoder);
            console.log('Summarization API connection configured (using dedicated summarization API).');
        }

        if(this.config.actionsUseTextGenApi){
            this.actionsApiConnection = new ApiConnection(this.config.textGenerationApiConnectionConfig.connection, this.config.actionsApiConnectionConfig.parameters, this.encoder);
            console.log('Actions API connection configured (using text generation API).');
        } else {
            this.actionsApiConnection = new ApiConnection(this.config.actionsApiConnectionConfig.connection, this.config.actionsApiConnectionConfig.parameters, this.encoder);
            console.log('Actions API connection configured (using dedicated actions API).');
        }

        console.log('Compaction API connection configured.');
    }

    loadActions(){
        console.log('Loading actions from scripts.');
        this.actions = [];

        const actionsPath = path.join(this.votcDataPath, 'scripts', 'actions');
        let standardActionFiles = fs.readdirSync(path.join(actionsPath, 'standard')).filter(file => path.extname(file) === ".js");
        let customActionFiles = fs.readdirSync(path.join(actionsPath, 'custom')).filter(file => path.extname(file) === ".js");

        for(const file of standardActionFiles) {
            const actionName = path.basename(file).split(".")[0];
            if(this.config.disabledActions.includes(actionName)){
                console.log(`Skipping disabled standard action: ${actionName}`);
                continue;
            }

            const filePath = path.join(actionsPath, 'standard', file);
            delete require.cache[require.resolve(filePath)];
            const actionModule = require(filePath);

            if (!actionModule || !actionModule.signature) {
                console.warn(`Action file ${file} is invalid or missing a signature.`);
                continue;
            }

            if (actionModule.run) {
                const runFunctionString = actionModule.run.toString();
                (actionModule as any).usesSource = runFunctionString.includes('votcce_action_source');
                (actionModule as any).usesTarget = runFunctionString.includes('votcce_action_target');
            } else {
                console.warn(`Action file ${file} is missing the 'run' function.`);
            }
            this.actions.push(actionModule);
            console.log(`Loaded standard action: ${file}`);
        }

        for(const file of customActionFiles) {
            const actionName = path.basename(file).split(".")[0];
            if(this.config.disabledActions.includes(actionName)){
                console.log(`Skipping disabled custom action: ${actionName}`);
                continue;
            }

            const filePath = path.join(actionsPath, 'custom', file);
            delete require.cache[require.resolve(filePath)];
            const actionModule = require(filePath);

            if (!actionModule || !actionModule.signature) {
                console.warn(`Action file ${file} is invalid or missing a signature.`);
                continue;
            }

            if (actionModule.run) {
                const runFunctionString = actionModule.run.toString();
                (actionModule as any).usesSource = runFunctionString.includes('votcce_action_source');
                (actionModule as any).usesTarget = runFunctionString.includes('votcce_action_target');
            } else {
                console.warn(`Action file ${file} is missing the 'run' function.`);
            }
            this.actions.push(actionModule);
            console.log(`Loaded custom action: ${file}`);
        }
        console.log(`Finished loading actions. Total actions loaded: ${this.actions.length}`);
        console.log(`Loaded action signatures: ${this.actions.map(a => a.signature).join(', ')}`);
    }

    /**
     * Generate scene description.
     * isInitial determines if it's for the start of the conversation or a mid-conversation update.
     */
    /** Called only after a complete, changed engine scene observation was applied. */
    public sceneContextChanged(): void {
        if (!this.isOpen) return;
        this.chatWindow.window.webContents.send('scene-context-update', sceneUiState(this.gameData, this.actions));
        // Retain the dialogue lock until its own finally finishes. Narration then runs first.
        if (!this.isGeneratingScene) this.abortController?.abort();
        void this.generateSceneDescription().catch(error => console.error('Scene refresh failed:', error));
    }

    public async generateSceneDescription(isInitial: boolean = false): Promise<void> {
        if (!this.isOpen) return;
        if (this.isGeneratingScene) {
            if (!isInitial) {
                this.sceneRefreshPending = true;
                this.sceneRequestAbort?.abort();
            }
            return;
        }
        if (this.isGenerating) {
            this.sceneRefreshPending = true;
            return;
        }
        const lastMessage = this.messages[this.messages.length - 1];
        if (isInitial && lastMessage?.role === 'system' && (lastMessage as any).type === 'scene') {
            if (this.pendingPlayerRequest) {
                this.pendingPlayerRequest = false;
                setTimeout(() => this.generateAIsMessages(), 0);
            }
            return;
        }

        this.isGeneratingScene = true;
        this.isGenerating = true;
        const controller = new AbortController();
        this.abortController = controller;
        let first = true;
        try {
            do {
                const initialPass = first && isInitial;
                first = false;
                this.sceneRefreshPending = false;
                this.sceneRequestAbort = new AbortController();
                const signal = AbortSignal.any([controller.signal, this.encounterLifetime.signal,
                    this.sceneRequestAbort.signal]);
                this.chatWindow.window.webContents.send('status-update', 'chat.status_generating_scene');
                console.log(`Starting scene description generation. Initial: ${initialPass}`);
                try {
                    if (initialPass) await this.encounterCapture;
                    signal.throwIfAborted();
                    await waitForSceneSelection(this.gameData);
                    signal.throwIfAborted();
                    const revision = this.gameData.resolvedSceneContext?.revision;
                    const description = await generateSceneDescription(this, signal);
                    signal.throwIfAborted();
                    if (revision !== this.gameData.resolvedSceneContext?.revision) {
                        this.sceneRefreshPending = true;
                        continue;
                    }
                    if (description?.trim()) {
                        const message: Message = { id: randomUUID(), role: 'system', name: '',
                            content: description, ...{ type: 'scene' } };
                        if (initialPass) {
                            const historicalCount = this.historicalConversations?.reduce((n, c) => n + c.messages.length, 0) ?? 0;
                            this.messages.splice(historicalCount, 0, message);
                        } else this.messages.push(message);
                        this.ledger().append(message, this.gameData.characters.values());
                        this.persistLedger();
                        this.chatWindow.window.webContents.send('scene-description', message);
                        enqueueConversationAudio(this, message);
                        console.log(`Scene description generated and sent. Initial: ${initialPass}.`);
                    } else this.chatWindow.window.webContents.send('scene-description', null);
                } catch (error) {
                    if (isAbortError(error)) {
                        if (this.sceneRefreshPending && !controller.signal.aborted && !this.encounterLifetime.signal.aborted) {
                            console.log('Scene description superseded by a newly confirmed venue.');
                        } else this.chatWindow.window.webContents.send('scene-description', null);
                    } else {
                        console.error('Error generating scene description:', error);
                        this.chatWindow.window.webContents.send('error-message', 'Failed to generate scene description.');
                        this.chatWindow.window.webContents.send('scene-description', null);
                    }
                } finally {
                    this.sceneRequestAbort = null;
                }
            } while (this.sceneRefreshPending && this.isOpen && !controller.signal.aborted &&
                !this.encounterLifetime.signal.aborted);
        } finally {
            const refresh = this.sceneRefreshPending && this.isOpen && !this.encounterLifetime.signal.aborted;
            this.sceneRefreshPending = false;
            this.isGeneratingScene = false;
            this.isGenerating = false;
            if (this.abortController === controller) this.abortController = null;
            this.chatWindow.window.webContents.send('status-update', '');
            if (refresh) {
                setTimeout(() => this.generateSceneDescription(), 0);
            } else if (this.pendingPlayerRequest && this.isOpen) {
                this.pendingPlayerRequest = false;
                setTimeout(() => this.generateAIsMessages(), 0);
            } else this.chatWindow.window.webContents.send('generation-finished', true);
        }

        if (isInitial && this.config.autoGenerateSuggestions && this.isOpen && !controller.signal.aborted) {
            void this.encounterCapture.then(async () => {
                await prepareRoleplayBackground(this.gameData.getAi(), this.encounterLifetime.signal);
                if (this.isOpen) await this.generateInitialSuggestions();
            }).catch(() => {});
        }
    }

    /**
     * Generate initial suggestions.
     * Provides input suggestions for the user at the start of the conversation.
     */
    private async generateInitialSuggestions(): Promise<void> {
        console.log('Starting initial suggestions generation.');

        try {
            // Generate suggestions.
            const suggestions = await this.generateSuggestions();

            if (suggestions && suggestions.length > 0) {
                // Send suggestions to the chat window.
                this.chatWindow.window.webContents.send('suggestions-response', suggestions);

                console.log(`Initial suggestions generated and sent to chat window: ${suggestions.length} suggestions`);
            } else {
                console.log('No suggestions were generated or suggestions array was empty.');
            }
        } catch (error) {
            console.error('Error generating initial suggestions:', error);
            // If generation fails, it does not affect the normal flow of the conversation.
        }
    }

    public getHistory(): Message[] {
        const ledger = this.ledger();
        return ledger.read(this.gameData.playerID, undefined, ledger.revision, 'reader');
    }

    private ledger(): ConversationLedger {
        this.encounterLedger ??= new ConversationLedger(this.gameData.playerID);
        for (const message of this.messages) {
            if (message.type === 'placeholder' || message.content === this.notSpokenYetText) continue;
            if (!message.languageRoutingBypassed && !message.languageRecord && !message.utterance)
                this.getMessagesForRecipient(this.gameData.playerID, [message]);
            this.encounterLedger.append(message, this.gameData.characters.values());
        }
        return this.encounterLedger;
    }

    public getEncounterRevision(): number { return this.ledger().revision; }

    /** Backend lore receipts read canonical publications, independent of model context compaction. */
    public getCanonicalEncounterMessagesForLore(): readonly Message[] {
        return this.encounterLedger?.messages ?? this.ledger().messages;
    }

    public getEncounterMessagesForRecipient(characterId: number): Message[] {
        return this.ledger().read(characterId);
    }

    public getEncounterCharacter(characterId: number): Character | undefined {
        return this.gameData.characters.get(characterId) ?? this.ledger().characters.find(character => character.id === characterId);
    }

    /** Names for summary scope come only from attendance this recipient actually observed. */
    public getEncounterParticipantsForRecipient(characterId: number): Character[] {
        const ledger = this.ledger();
        const ids = new Set(ledger.messages.filter(message => message.observedByCharacterIds?.includes(characterId))
            .flatMap(message => message.observedByCharacterIds ?? []));
        return [...ids].flatMap(id => {
            const character = this.getEncounterCharacter(id);
            return character ? [character] : [];
        });
    }

    /** Await the same bounded capture bridge before a turn is delivered to any listener. */
    public async prepareMessageIngress(): Promise<void> {
        if ((!languageCaptureEnabled() || !languageRoutingEnabled(this.config)) && !currentDialogueCaptureCatalog()) return;
        await this.refreshCurrentLanguageFacts(this.encounterLifetime.signal);
        if (!languageCaptureEnabled() || !languageRoutingEnabled(this.config)) return;
        await this.encounterCapture;
        const participants = [...this.gameData.characters.values()];
        if (participants.some(character => !bindLanguageSnapshot(character)))
            await captureRoleplayEncounter(participants, this.encounterLifetime.signal, this.gameData);
        if (participants.some(character => !bindLanguageSnapshot(character)))
            throw new Error('Complete language capture is required before delivering this message.');
    }

    private persistLedger(): void {
        if (!this.votcDataPath || this.isOpen === false) return;
        const ledger = this.ledger();
        saveLedgerCheckpoint(path.join(this.votcDataPath, 'conversation_history', String(this.gameData.playerID)),
            ledger.snapshot(this.gameData.date, this.gameData.playerID, { scene: this.gameData.scene, location: this.gameData.location }));
    }

    private summaryCache(): PerspectiveSummaries { return this.perspectiveSummaries ??= new PerspectiveSummaries(); }
    private rollingSummaryRange(): Message[] {
        let tokens = 0;
        const result: Message[] = [];
        const target = this.textGenApiConnection.context * this.config.percentOfContextToSummarize / 100;
        for (const message of this.messages) {
            if (tokens >= target) break;
            result.push(message); tokens += this.textGenApiConnection.calculateTokensFromMessage(message);
        }
        return result;
    }
    private rollingSummaryPrompt(messages: Message[], owner: number): Message[] | string {
        const prompt = buildResummarizeChatPrompt(this, messages, owner);
        return this.summarizationApiConnection.isChat() ? prompt : convertChatToTextNoNames(prompt, this.config);
    }
    /** Owned compaction uses the same complete provider summary and request cache as rolling memory. */
    public summarizeForCompaction(messages: readonly Message[], ownerId: number, previousSummary?: string): Promise<string> {
        const prompt = buildResummarizeChatPrompt(this, [...messages], ownerId, previousSummary);
        const request = this.summarizationApiConnection.isChat() ? prompt : convertChatToTextNoNames(prompt, this.config);
        return this.summaryCache().generate(this.summarizationApiConnection, request, false, this.abortController?.signal);
    }

    private schedulePerspectiveSummaries(): void {
        if (this.summaryPreparationTimer) clearTimeout(this.summaryPreparationTimer);
        if (!this.hasLanguageMessages() || this.config.enableMemoryCompaction || !this.summarizationApiConnection) return;
        const tokens = this.messages.reduce((sum, message) => sum + this.textGenApiConnection.calculateTokensFromMessage(message), 0);
        if (tokens < this.textGenApiConnection.context * 0.6) return;
        this.summaryPreparationTimer = setTimeout(() => {
            this.summaryPreparationTimer = undefined;
            if (!this.isOpen || this.isGenerating) { if (this.isOpen) this.schedulePerspectiveSummaries(); return; }
            void (async () => {
                const range = this.rollingSummaryRange();
                for (const owner of this.gameData.characters.keys()) {
                    if (!this.isOpen || this.isGenerating) break;
                    if (this.getMessagesForRecipient(owner, range).length)
                        await this.summaryCache().generate(this.summarizationApiConnection, this.rollingSummaryPrompt(range, owner), true);
                }
            })().catch(() => {}); // cancellation/error: foreground recomputes, full history remains.
        }, 1500);
        this.summaryPreparationTimer.unref?.();
    }
    private invalidateDerivedViews(): void {
        invalidateConversationAudio(this);
        this.summaryCache().clear();
        this.memoryCompactor?.invalidateSourceMessages?.(this.ledger().messages.map(message => message.id!),
            String(this.gameData.playerID), id => this.memoryManager?.deleteMemory(id));
        this.recipientCurrentSummaries.clear(); this.currentSummary = '';
        // Rebuild prompt context from the revised canonical record rather than retaining a stale summary.
        this.messages = [...this.ledger().messages];
        this.persistLedger();
    }

    private languageView(): LanguageConversation {
        if (languageRoutingEnabled(this.config))
            for (const character of this.gameData.characters.values()) bindLanguageSnapshot(character);
        if (!this.languageConversation) this.languageConversation = new LanguageConversation(
            this.gameData, defaultLanguageEngine().renderer, this.config.language || 'en', languageCaptureEnabled(),
            () => languageRoutingEnabled(this.config), () => this.encounterLedger?.messages ?? []);
        return this.languageConversation;
    }

    public getMessagesForRecipient(characterId: number, messages: readonly Message[] = this.messages, purpose: PerceptionPurpose = 'knowledge'): Message[] {
        // ledger() sets its identity before projecting raw turns; nested reads then use its committed prefix.
        if (!this.encounterLedger) this.ledger();
        if (!languageRoutingEnabled(this.config) &&
            !messages.some(message => message.utterance || message.perceivedByCharacterId !== undefined))
            return messages.flatMap(message => { markLanguageRoutingBypassed(message);
                const view = projectRecordedMessage(message, characterId, this.gameData.playerID, purpose); return view ? [view] : []; });
        if (!languageCaptureEnabled() && !messages.some(message => message.utterance) &&
            ![...this.gameData.characters.values()].some(character => character.languageSnapshot))
            return messages.flatMap(message => { const view = projectRecordedMessage(message, characterId, this.gameData.playerID, purpose); return view ? [view] : []; });
        return this.languageView().messagesForRecipient(messages, characterId, purpose);
    }

    public getCurrentSummaryForRecipient(characterId: number): string {
        if (!this.hasLanguageMessages() && !(languageCaptureEnabled() && languageRoutingEnabled(this.config))) return this.currentSummary;
        const summary = this.recipientCurrentSummaries.get(characterId) ?? '';
        if (!summary) return summary;
        const workingIds = new Set(this.messages.map(message => message.id));
        const earlier = this.getEncounterMessagesForRecipient(characterId).filter(message => !workingIds.has(message.id));
        return appendPrivateNarration(summary, collectPrivateNarration(earlier, characterId, this.gameData.date));
    }

    public hasLanguageMessages(): boolean {
        return (languageRoutingEnabled(this.config) && [...this.gameData.characters.values()].some(character => !!character.languageSnapshot)) ||
            this.messages.some(message => !!message.utterance) || !!this.encounterLedger?.messages.some(message => !!message.utterance);
    }

    public messageForPlayer(message: Message): Message {
        return this.getMessagesForRecipient(this.gameData.playerID, [message], 'reader')[0];
    }

    /** Pin the delivery policy before streaming; toggling during a reply cannot leak or reinterpret it. */
    private generatedDelivery(): (message: Message) => Message | null {
        const audioEnabled = this.config.audio?.enabled === true;
        const stripAudio = (message: Message): Message => audioEnabled && /<titan_audio\b/i.test(message.content) ? cleanAudioMessage(message) : message;
        if (!languageRoutingEnabled(this.config)) return message => {
            if (this.isOpen === false) return null; stripAudio(message); markLanguageRoutingBypassed(message); return message;
        };
        if (![...this.gameData.characters.values()].some(character => character.languageSnapshot)) return message => {
            if (this.isOpen === false) return null;
            stripAudio(message);
            if (audioEnabled && message.proseEncoding === 'controls-v1') markLanguageRoutingBypassed(message);
            return message;
        };
        const characters = new Map([...this.gameData.characters].map(([id, character]) => [id,
            Object.assign(Object.create(Object.getPrototypeOf(character)), character,
                { languageSnapshot: structuredClone(character.languageSnapshot) })]));
        const game = Object.assign(Object.create(Object.getPrototypeOf(this.gameData)), this.gameData, { characters });
        const priorHearingSource = structuredClone([...this.ledger().messages]);
        const view = new LanguageConversation(game, defaultLanguageEngine().renderer, this.config.language || 'en', true,
            () => true, () => priorHearingSource);
        return message => {
            if (this.isOpen === false) return null;
            if (message.characterId !== undefined && !this.gameData.characters.has(message.characterId)) return null;
            message.gameDate ??= game.date;
            stripAudio(message); view.record(message); return message;
        };
    }

    private plannedTarget(source: Character, target?: Character): Character | undefined {
        if (!target) {
            const last = this.messages[this.messages.length - 1];
            target = last?.role === 'assistant' && last.characterId !== source.id
                ? this.gameData.characters.get(last.characterId!) : this.gameData.getPlayer();
        }
        return target;
    }

    private plannedLanguage(source: Character, target?: Character): string | undefined {
        if (!languageRoutingEnabled(this.config) || !source.languageSnapshot) return;
        target = this.plannedTarget(source, target);
        return selectSpokenLanguage(characterLanguages(source), target ? characterLanguages(target) : undefined,
            undefined, [], defaultLanguageEngine().relations);
    }

    private plannedProseEncoding(spokenLanguageId?: string): ResponseProseEncoding {
        return spokenLanguageId === undefined && !this.config.audio?.enabled ? 'legacy' : 'controls-v1';
    }

    /** One ordinary writer request. A failed format/completion gets one full-context recovery, never a parsing-model pass. */
    private async completeControlledMessage(prompt: Message[], character: Character, spokenLanguageId: string,
        deliver: (message: Message) => Message | null, parameters: object, targetIds?: number[], name = character.fullName,nativeContext?:NativeLoreContext,rebuildNative?:()=>Promise<NativeLoreContext|undefined>): Promise<Message | null> {
        targetIds ??= this.plannedTarget(character) ? [this.plannedTarget(character)!.id] : [];
        const audioRequested = prompt.some(message => message.content.includes('Audio delivery metadata:'));
        let failure: ControlledProseError | undefined;
        for (let attempt = 0; attempt < 2; attempt++) {
            if(attempt&&nativeContext&&rebuildNative){
                if(!nativeContext.isCurrent())throw new Error('Character sources changed during controlled-prose recovery.');
                nativeContext=await rebuildNative();
            }
            const request = (nativeContext?.original??prompt).map(message => ({ ...message }));
            if (attempt) request.push({ role: 'system', content: (failure?.reason === 'length'
                ? 'The previous request reached its response limit before producing a complete answer. Write a concise complete reply within the same response budget, retaining emotional depth and natural woven paragraphs. '
                : failure?.reason === 'source'
                    ? 'The previous reply copied foreign sound tokens into its source speech. Write the spoken meaning in the configured prose language. '
                    : failure?.reason === 'echo'
                        ? 'The previous reply marked a sound that was not available in your audible history. Repeat only an exact sound you actually heard, or answer using your own words and observable gestures. Its unknown meaning must stay unknown. '
                    : failure?.reason === 'speech-label'
                        ? 'The previous reply placed attributed spoken words inside action controls. Keep voice tone and attribution in **...**, and actual uttered words in ""..."". An entirely nonverbal reply is valid. '
                    : 'The previous reply was incomplete or had invalid host delimiters. ') +
                'Write a complete fresh reply using **observable narration**, ""speech"" and ~~private narration~~ throughout. ' +
                'Keep the established speaker, addressee, full persona and literary style. Give spoken words their clear meaning in the configured prose language; ' +
                'An exact sound actually heard may be repeated inside <<...>> within your speech, without inventing its translation. ' +
                'Do not replay other participants\' foreign sentences. Return only that reply.' });
            let finishReason: string | null | undefined;
            const input = this.textGenApiConnection.isChat() ? request : convertChatToText(request, this.config, character.fullName);
            let nativeReply:NativeLoreChatReply|undefined;
            try{
            if(nativeContext)nativeReply=await completeNativeLoreChat(this,character,nativeContext,{...parameters},this.abortController?.signal,request,true);
            if(nativeReply)finishReason=nativeReply.finishReason;
            const result = nativeReply?nativeReply.reply:await this.textGenApiConnection.complete(input, false, parameters, undefined, this.abortController?.signal,
                undefined, undefined, metadata => { finishReason = metadata.finishReason; });
            if (this.isOpen === false) return null;
            if (finishReason === 'content_filter') throw new Error('The provider did not return a complete character reply');
            let content = typeof result === 'string' ? result.trim() : result?.content?.trim() ?? '';
            const rawContent = content;
            const audio = audioRequested ? splitAudioMetadata(content) : undefined;
            if (audio) content = audio.prose;
            if (this.config.cleanMessages) content = cleanMessageContent(content);
            try {
                if (['length', 'max_tokens', 'MAX_TOKENS'].includes(finishReason ?? '') &&
                    !(audio && audio.prose !== rawContent))
                    throw new ControlledProseError('The provider truncated the controlled reply', 'length');
                if (!content) throw new ControlledProseError('The provider returned no controlled prose', 'empty');
                content = normalizeControlledProseFormatting(content, this.config.language || 'en');
                content = repairControlledPhoneticGaps(content);
                validateControlledSpeechLabels(content, this.config.language || 'en');
                content = repairControlledPrivateClauses(content);
                validateControlledSourceSpeech(content, this.config.language || 'en');
                const message: Message = { role: 'assistant', name, characterId: character.id, spokenLanguageId,
                    proseEncoding: 'controls-v1', content };
                if (targetIds) (message as any).targetCharacterIds = targetIds;
                if (audio) rememberAudioCues(message, audio.cues);
                nativeReply?.validate();
                const delivered=deliver(message);nativeReply?.finish(!!delivered,delivered??undefined);return delivered;
            } catch (error) {
                if (!(error instanceof ControlledProseError)) throw error;
                failure = error;
            }
            }finally{nativeReply?.finish(false);}
        }
        this.chatWindow.window.webContents.send('error-message', `${character.shortName}'s reply could not be completed: ${failure!.message}. Please retry.`);
        return null;
    }

    public clearHistory(): void {
        invalidateConversationAudio(this);
        console.log("Clearing conversation history.");
        this.memoryCompactor?.invalidateSourceMessages?.(this.ledger().messages.map(message => message.id!),
            String(this.gameData.playerID), id => this.memoryManager?.deleteMemory(id));
        this.encounterLedger?.clear();
        this.messages = [];
        this.persistLedger();
        this.summaryCache().clear();
        this.currentSummary = "";
        this.recipientCurrentSummaries.clear();
        this.consecutiveActionsCount = 0;
        this.lastActionMessageIndex = -1;
    }

    public cancelGeneration(): void {
        invalidateConversationAudio(this);
        this.sceneRefreshPending = false;
        this.sceneRequestAbort?.abort();
        if (this.abortController && !this.abortController.signal.aborted) {
            this.abortController.abort();
            console.log('Cancellation signal sent to API request.');
            this.isGenerating = false;
            this.abortController = null;
            this.chatWindow.window.webContents.send('generation-cancelled');
            this.chatWindow.window.webContents.send('status-update', ''); // Clear status text
        }
    }

    public undo(): void {
        console.log("Undoing last exchange.");
        const full = [...this.ledger().messages];
        const lastUserIndex = [...full].reverse().findIndex(m => m.role === 'user');

        if (lastUserIndex !== -1) {
            const actualIndex = full.length - 1 - lastUserIndex;
            console.log(`Removing messages from index ${actualIndex} onwards.`);
            this.ledger();
            const removedMessages = full.slice(actualIndex);
            this.memoryCompactor?.invalidateSourceMessages?.(removedMessages.map(message => message.id!),
                String(this.gameData.playerID), id => this.memoryManager?.deleteMemory(id));
            const removedIds = new Set(removedMessages.map(message => message.id));
            this.messages = this.messages.filter(message => !removedIds.has(message.id));
            this.encounterLedger!.remove(removedMessages.map(message => message.id!));
            this.invalidateDerivedViews();

            // Clean up actions for removed messages
            for (const msg of removedMessages) {
                if (msg.id) {
                    this.pendingActions.delete(msg.id);
                    this.executedActions.delete(msg.id);
                }
            }

            // Reset consecutive actions counter since we're going back in time
            this.consecutiveActionsCount = 0;
            this.lastActionMessageIndex = -1;
        }
    }


    public editMessage(messageId: string, newContent: string): void {
        const message = this.ledger().messages.find(m => m.id === messageId);
        if (message) {
            console.log(`Editing message ${messageId}. Old content: "${message.content.substring(0, 50)}...". New content: "${newContent.substring(0, 50)}..."`);
            if (message.utterance || languageCaptureEnabled())
                this.languageView().editForRecipient(message, this.gameData.playerID, newContent, 'reader');
            else message.content = newContent;
            this.encounterLedger!.changed();
            this.invalidateDerivedViews();
        } else {
            console.warn(`Could not find message with ID ${messageId} to edit.`);
        }
    }

    public async regenerate(): Promise<void> {
        console.log("Regenerating last AI response.");

        // Find the last user message to know where the exchange started
        const full = [...this.ledger().messages];
        const lastUserIndex = [...full].reverse().findIndex(m => m.role === 'user');
        if (lastUserIndex === -1) {
            console.log("No user message found to regenerate from.");
            return;
        }
        const actualIndex = full.length - 1 - lastUserIndex;

        // Remove all messages after the last user message
        if (actualIndex < full.length - 1) {
            console.log(`Splicing messages from index ${actualIndex + 1}`);
            this.ledger();
            const removedMessages = full.slice(actualIndex + 1);
            this.memoryCompactor?.invalidateSourceMessages?.(removedMessages.map(message => message.id!),
                String(this.gameData.playerID), id => this.memoryManager?.deleteMemory(id));
            const removedIds = new Set(removedMessages.map(message => message.id));
            this.messages = this.messages.filter(message => !removedIds.has(message.id));
            this.encounterLedger!.remove(removedMessages.map(message => message.id!));
            this.invalidateDerivedViews();
            // Clean up actions associated with removed messages
            for (const msg of removedMessages) {
                if (msg.id) {
                    this.pendingActions.delete(msg.id);
                    this.executedActions.delete(msg.id);
                }
            }
        }

        // Reset action counter as we are re-doing this turn
        this.consecutiveActionsCount = 0;

        // Now, generate the AI response again
        await this.generateAIsMessages();
    }

    public removeCharacter(characterId: number): void {
        const character = this.gameData.characters.get(characterId);
        if (character) {
            console.log(`Removing character ${character.shortName} (ID: ${characterId}) from conversation state.`);

            // Add a system message to the chat history to inform the LLM
            const systemMessage: Message = {
                role: "system",
                name: "System",
                content: `[System note: ${character.fullName} has left the conversation and is no longer present.]`
            };
            this.pushMessage(systemMessage);
            // Also send it to the UI so it's visible for debugging and context
            this.chatWindow.window.webContents.send('message-receive', systemMessage, false);

            // Remove from GameData
            this.gameData.characters.delete(characterId);

            // Remove any placeholder messages
            const placeholderIndex = this.messages.findIndex(
                msg => (msg as any).characterId === characterId && msg.content === this.notSpokenYetText
            );
            if (placeholderIndex !== -1) {
                this.messages.splice(placeholderIndex, 1);
            }

            // Remove from NPC queue for future turns
            this.npcQueue = this.npcQueue.filter(c => c.id !== characterId);
            if (this.customQueue) {
                this.customQueue = this.customQueue.filter(c => c.id !== characterId);
            }

            // Notify the UI to update itself
            this.chatWindow.window.webContents.send('character-left', characterId);

            // Notify UI to update slash command dropdowns
            this.chatWindow.window.webContents.send('update-character-lists', Array.from(this.gameData.characters.keys()));
        } else {
            console.warn(`Attempted to remove character with ID ${characterId}, but they were not found in the conversation.`);
        }
    }



    private async checkForSummariesFromOtherPlayers(): Promise<void> {
        console.log('Checking for summaries from other players...');
        const summariesBasePath = path.join(this.votcDataPath, 'conversation_summaries');
        if (!fs.existsSync(summariesBasePath)) return;

        const playerDirs = fs.readdirSync(summariesBasePath, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name);

        const otherPlayerIds = playerDirs.filter(id => id !== this.gameData.playerID.toString());

        if (otherPlayerIds.length === 0) {
            console.log('No other player summaries found.');
            return;
        }

        console.log(`Found summaries from other players: ${otherPlayerIds.join(', ')}`);

        for (const character of this.gameData.characters.values()) {
            if (character.id === this.gameData.playerID) continue;

            let characterSummaries = this.summaries.get(character.id) || [];

            for (const playerId of otherPlayerIds) {
                const summaryFilePath = path.join(summariesBasePath, playerId, `${character.id.toString()}.json`);
                if (fs.existsSync(summaryFilePath)) {
                    try {
                        const foreignSummaries: Summary[] = JSON.parse(fs.readFileSync(summaryFilePath, 'utf8'));
                        const summariesToImport = foreignSummaries.map(s => ({
                            ...s,
                            fromPlayerId: playerId // Add the player ID
                        }));
                        characterSummaries.push(...summariesToImport);
                        console.log(`Imported ${summariesToImport.length} summaries for character ${character.id} from player ${playerId}.`);
                    } catch (e) {
                        console.error(`Error reading or parsing summary file ${summaryFilePath}:`, e);
                    }
                }
            }

            // Re-sort all summaries by date
            characterSummaries.sort((a: any, b: any) => {
                const dateA = parseGameDate(a.date) || new Date(0);
                const dateB = parseGameDate(b.date) || new Date(0);
                return dateB.getTime() - dateA.getTime();
            });

            this.summaries.set(character.id, characterSummaries);
        }
    }

    private async handleAiToAiConversation(initialMessages: Message[]): Promise<void> {
        const shouldTalkToAi = Math.random() < (this.config.aiToAiChatChance / 100);
        if (initialMessages.length === 0 || this.aiToAiTurnLimit >= 2 || !shouldTalkToAi) {
            return;
        }
        this.aiToAiTurnLimit++;

        const lastRespondingCharacter = this.gameData.characters.get((initialMessages[initialMessages.length - 1] as any).characterId);
        if (!lastRespondingCharacter) return;

        // Exclude silenced characters so they don't speak randomly in AI-to-AI chatter.
        const otherAIs = Array.from(this.gameData.characters.values()).filter(
            c => c.id !== this.gameData.playerID && c.id !== lastRespondingCharacter.id &&
                !this.gameData.silencedCharacterIds?.has(c.id)
        );

        if (otherAIs.length > 0) {
            const targetAI = otherAIs[Math.floor(Math.random() * otherAIs.length)];
            console.log(`AI-to-AI turn: ${lastRespondingCharacter.shortName} will now talk to ${targetAI.shortName}.`);

            // Generate AI1 -> AI2 message
            const aiMessage = await this.generateAiToAiMessage(lastRespondingCharacter, targetAI);
            if (aiMessage) {
                this.pushMessage(aiMessage);
                this.chatWindow.window.webContents.send('message-receive', this.messageForPlayer(aiMessage), this.config.actionsEnableAll, true);

                let collectedActions: ActionResponse[] = [];
                if (this.config.actionsEnableAll) {
                    collectedActions = await checkActions(this, lastRespondingCharacter.id, targetAI.id);
                    if (collectedActions.length > 0) {
                        this.actionInvolvedCharacterIds.add(lastRespondingCharacter.id);
                        this.actionInvolvedCharacterIds.add(targetAI.id);
                    }
                }
                let narrativeMessage: Message | null = null;
                if (collectedActions.length > 0 && this.config.narrativeEnable) {
                    narrativeMessage = await generateNarrative(this, collectedActions);
                    if (narrativeMessage) {
                        this.pushMessage(narrativeMessage);
                    }
                }
                this.chatWindow.window.webContents.send('actions-receive', collectedActions, narrativeMessage, true);

                // Update UI to show who is speaking now
                this.chatWindow.window.webContents.send('queue-update', [], { name: targetAI.shortName, id: targetAI.id });

                // Generate AI2 -> AI1 response
                const { actions } = await this.processCharacterList([targetAI], false, false, true);

                // The message is pushed and sent inside processCharacterList. Now, handle the actions.
                let responseNarrative: Message | null = null;
                if (actions.length > 0 && this.config.narrativeEnable) {
                    responseNarrative = await generateNarrative(this, actions);
                    if (responseNarrative) {
                        this.pushMessage(responseNarrative);
                    }
                }
                this.chatWindow.window.webContents.send('actions-receive', actions, responseNarrative, true);
            }
        }
        // The main generateAIsMessages finally block will handle re-enabling the input.
    }

    public async initiateConversation(){
        if(Math.random() < (this.config.aiStartConversationChance / 100)){
            // Send loading event to chat window when AI starts conversation
            this.chatWindow.window.webContents.send('ai-first-conversation-loading', true);
            await this.generateAIsMessages();
        }
    }

    /**
     * Generate a message where the AI character questions the player's actions
     * based on their personality and history.
     */
    private async generateActionQuestioningMessage(character: Character, plannedLanguageId?: string, proseEncoding: ResponseProseEncoding = 'legacy',
        deliver?: (message: Message) => Message | null): Promise<Message | null> {
        return this.withLimitedHistory(async () => {
            console.log(`Generating action questioning message for character: ${character.fullName}`);

            // Build a prompt that uses the full conversation context and adds a questioning instruction.
        const prompt = await this.buildQuestioningPrompt(character, plannedLanguageId, proseEncoding);

        try {
            if (proseEncoding === 'controls-v1') return await this.completeControlledMessage(prompt, character, plannedLanguageId!, deliver!,
                { max_tokens: this.config.maxTokens, temperature: 0.7 });
            const response = await this.textGenApiConnection.complete(prompt, false, {
                max_tokens: this.config.maxTokens,
                temperature: 0.7 // Slightly higher temperature for more creative questioning
            });

            if (!response || (response as any).trim?.() === '') {
                return null;
            }

            const message: Message = {
                role: "assistant",
                name: character.fullName,
                characterId: character.id,
                content: typeof response === 'string' ? response.trim() : response.content?.trim() ?? ''
            };

            return message;
        } catch (error) {
            console.error(`Error generating action questioning message: ${error}`);
            return null;
        }
        });
    }

    /**
     * Build a prompt for questioning player actions by appending an instruction to the main chat prompt.
     */
    private async buildQuestioningPrompt(character: Character, plannedLanguageId?: string, proseEncoding: ResponseProseEncoding = 'legacy'): Promise<any[]> {
        // Get the standard, rich prompt with full conversation context.
        const standardPrompt = await buildChatPrompt(this, character, undefined, undefined, false, plannedLanguageId, proseEncoding);

        // Add a new system instruction at the end to guide the AI's response.
        const interlocutorName = this.gameData.getPlayer().fullName;
        const questioningInstruction = {
            role: "system" as const,
            content: `Instead of directly complying, your character has reservations about the last statement made by ${interlocutorName}. Based on your personality and the situation, express your hesitation, question their motives, or suggest an alternative. Your response should be in character and move the conversation forward by exploring this conflict or concern. Keep dialogue, observable narration and private thoughts within the setting. Refer to people by their in-world names, titles or appropriate pronouns, never by software roles such as player, user or assistant.`
        };

        standardPrompt.push(questioningInstruction);
        console.log("Appended questioning instruction to the standard prompt.");

        return standardPrompt;
    }

    public async calculateBasePromptTokens(): Promise<number> {
        try {
            await this.encounterCapture;
            return await this.withLimitedHistory(async () => {
                // We need a character to build the prompt for. Let's use the main AI.
                const mainAiCharacter = this.gameData.getCharacter(this.gameData.aiID);
                if (!mainAiCharacter) {
                    console.warn("Cannot calculate base prompt tokens: main AI character not found.");
                    return 0;
                }

                // A UI estimate does not initiate capture or authorize a reply.
                // Preserve the real writer's strict age-readiness requirement.
                if (developmentCaptureEnabled() && !currentDevelopment(mainAiCharacter)) {
                    console.info('[Generation diagnostic] ' + JSON.stringify({ phase: 'prompt_preview', code: 'capture_pending' }));
                    return 0;
                }

                // Build a prompt as if we were about to generate a message for this character.
                // We pass a copy of the current messages.
                const spokenLanguageId = this.plannedLanguage(mainAiCharacter);
                const prompt = await buildChatPrompt(this, mainAiCharacter, this.messages.slice(0), undefined, false,
                    spokenLanguageId, this.plannedProseEncoding(spokenLanguageId),{preview:true});

                // Calculate tokens from this prompt.
                const text = convertMessagesToString(prompt, "", "");
                const tokenCount = this.textGenApiConnection.calculateTokensFromText(text);

                console.log(`Calculated base prompt tokens: ${tokenCount}`);
                return tokenCount;
            });
        } catch (error) {
            console.error("Error calculating base prompt tokens:", error);
            return 0;
        }
    }

    private calculateQuestioningChance(character: Character): number {
        let chance = this.config.questionPlayerActionsChance;
        if (chance <= 0) {
            return 0;
        }

        console.log(`Calculating questioning chance for ${character.shortName}. Base chance: ${chance}%`);

        // Trait-based modifiers (positive for more likely to question, negative for less)
        const traitModifiers: { [key: string]: number } = {
            'just': 20,
            'honest': 15,
            'honorable': 15,
            'compassionate': 10,
            'cynical': 10,
            'paranoid': 25,
            'arbitrary': -10,
            'deceitful': -20,
            'callous': -15,
            'lazy': -10
        };

        for (const trait of character.traits) {
            const traitName = trait.name.toLowerCase();
            if (traitModifiers[traitName]) {
                const modifier = traitModifiers[traitName];
                chance += modifier;
                console.log(`... applying modifier for trait '${traitName}': ${modifier}%. New chance: ${chance}%`);
            }
        }

        // Clamp the chance between 0 and 100
        const finalChance = Math.max(0, Math.min(100, chance));
        if (finalChance !== this.config.questionPlayerActionsChance) {
            console.log(`Final questioning chance for ${character.shortName}: ${finalChance}%`);
        }
        return finalChance;
    }
}
