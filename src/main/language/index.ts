/** Titan's internal language-module boundary. Sound assets live in public/languages. */
export { LanguageEngine, loadLanguageEngine, TITAN_FAR_VOCABULARY_SEED } from './languageEngine';
export type { LanguageEngineData } from './languageEngine';
export { defaultLanguageEngine, defaultLanguageRenderer, configureLanguageCapture, setLanguageRoutingEnabled,
    currentLanguageCaptureCatalog, languageCaptureEnabled, observeLanguageLine, clearLanguageObservations,
    bindLanguageSnapshot } from './languageRuntime';
export { LanguageConversation, projectRecordedMessage, characterLanguages, markLanguageRoutingBypassed } from './languageConversation';
export { languageRoutingEnabled, knownLanguages, selectSpokenLanguage } from './languageRouting';
export type { CharacterLanguageKnowledge, ComprehensionMode } from './languageRouting';
export type { SpokenUtterance, RecipientRendering } from './languageRendering';
export type { LanguageRoute } from './languageRelations';
export { languageCaptureBody } from './languageCapture';
export type { LanguageCaptureCatalog } from './languageCapture';
export { recipientMessages, recipientEncounterMessages, recipientSummary, promptPerceptionMessages, characterKnowledgeInstruction, perceivedMemoryTranscript, SPEECH_WRITER_INSTRUCTION } from './conversationView';
export { recipientHistory, readRecipientHistory } from './languageHistory';
export { perceivedSummary } from './perceivedSummary';
export { ConversationLedger } from './conversationLedger';
export { validateLedger } from './languageHistory';
