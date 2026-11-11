import path from 'path';
import { audioHostingIssue } from './hostingDiagnostics';
import { familyPreset, familyReference, eligibleFamilyProfile, FAMILY_VERSION } from './familyPerformance';
import { randomUUID, createHash } from 'crypto';
import { AudioSettings, AudioStatus, VoiceProfile, normalizeAudio } from '../../shared/audio';
import type { Conversation } from '../conversation/Conversation';
import type { Character } from '../../shared/gameData/Character';
import type { GoaSnapshot } from '../../shared/gameData/GoaSnapshot';
import { getVerifiedGoaSnapshot } from '../goa/goaRuntime';
import type { Message } from '../ts/conversation_interfaces';
import { AudioLibrary } from './AudioLibrary';
import { BreezeProvider } from './BreezeProvider';
import { ManagedBreeze } from './ManagedBreeze';
import { BREEZE_MODELS } from './modelCatalog';
import { projectAudioUtterances } from './audioProjection';
import { phraseAudioText } from './audioPhrasing';
import { audioCuesFor } from './audioDirections';
import { ageDirection, characterAgeYears } from './ageDirection';
import { CloneAgeBand, CloneReferenceAge, ageBeyondReference, cloneAgeBand, cloneAgeInstruction, recordedCloneAge } from './cloneAge';
import { MaturityStage, maturityFromAge, recordedMaturity, isAdultMaturity, VoiceTrait } from './maturation';
import { captureMaturityForAudio, currentVoiceTraits, currentUndeadFacts } from './maturationRuntime';
import { automaticIndividual, observedVoiceTraits, personalityHash, designDevelopment, validVoiceStyle } from './voiceDevelopment';
import { designPersonalityStyle } from './personalityStyle';
import { designCharacterVoice, prepareVoiceDesign, updatePreparedVoiceDesign, refreshPreparedVoiceBody } from './voiceDesign';
import { sideSpeech } from './SideSpeechProvider';
import { CastingChoices, VoiceCasting, castingFromProvenance, normalizeCastingChoices, resolveUndeadVoiceCasting } from './acousticCasting';
import { UndeadCoverage, UndeadFacts, UndeadPerformance, savedUndeadCoverage, decideUndeadPerformance, validUndeadPerformance } from './undeadVoice';
import { acousticDelivery } from './acousticDelivery';
import { captureForAudio, clearCastingObservations, currentCastingCapture } from './castingRuntime';
import { AudioPipeline } from './AudioPipeline';
import { NarratorDraft } from './NarratorDraft';
import { demonFamily, DemonFamily } from './demonVoices';
import { BUNDLED_CLONES, bundledCloneCatalog } from './cloneCapture';
import { reviewedRaceReferenceCoverage, retiredPopulationReference } from './raceSelections';
import { reviewedRaceDirection } from './raceVoiceRefinements';
import { captureCloneForAudio, cloneObservation } from './cloneRuntime';
import { CloneBanks, cloneIdentity, cloneDelivery, verifyCloneProfile } from './CloneBanks';

export const REFERENCE_TEXT = 'The road turns beyond the quiet hill. I have time to listen, and I will speak plainly when the moment comes.';
export const DEFAULT_NARRATOR = 'A warm, clear storyteller with a smooth, resonant midrange voice, careful natural articulation and a measured intimate cadence. Subtle expressive phrasing, without theatrical exaggeration. Consistent neutral English pronunciation.';
export const DEFAULT_NARRATOR_NAME = 'Medivh (HotS)';
export const DEFAULT_NARRATOR_BANK = 'goa2-5000-hots-medivhbase/v0001';
const DEFAULT_NARRATOR_MANIFEST = '9da4655e5127d3b927b635a732bc54c2321eec0ece5be7400c79f5cb4ccfc5a4';
type Emit = (channel: string, ...args: any[]) => void;
interface PlaybackJob { conv: Conversation; view: Message; actor: Character; settings: AudioSettings; age: string; cues: ReturnType<typeof audioCuesFor>; epoch: number;
    familyKey?: string; design?: ReturnType<typeof prepareVoiceDesign>; bodySnapshot?: GoaSnapshot; casting?: VoiceCasting; characterVoiceId?: string; narratorVoiceId?: string; historical?: boolean; replay?: boolean; prepareCasting?: boolean; cloneAgeYears?: number; prepareCloneAge?: boolean; maturity?: MaturityStage; voiceTraits?:readonly VoiceTrait[]; voiceStyle?:string; undeadFacts?:UndeadFacts; undead?:UndeadPerformance }
interface DevelopmentContext {conv:Conversation;actor:Character;maturity:MaturityStage;traits:readonly VoiceTrait[];design?:ReturnType<typeof prepareVoiceDesign>}
const heardDigest = (view: Message) => createHash('sha256').update(JSON.stringify([view.content, view.editableContent])).digest('hex');
/** Existing local diagnostics only: identify the frozen hearing, without logging its words. */
function traceDelivery(view: Message, speakerId: number, listenerId: number, replay: boolean): void {
    console.info('[Audio hearing receipt] ' + JSON.stringify({ messageId: view.id, speakerId, listenerId, replay,
        type: view.type ?? 'dialogue', spokenLanguageId: view.spokenLanguageId ?? null,
        comprehensionMode: view.comprehensionMode ?? null, speechComprehension: view.speechComprehension ?? null,
        heardDigest: heardDigest(view) }));
}
export class AudioRuntime {
    private library?: AudioLibrary;
    private narratorDraft?: NarratorDraft;
    readonly managed: ManagedBreeze;
    private epoch = 0;
    private controller?: AbortController;
    private queue: PlaybackJob[] = [];
    private draining = false;
    private activeConv?: Conversation;
    private finish?: { id: string; resolve: () => void; reject: (error: Error) => void };
    private paused = false;
    private playbackMessage = '';
    status: AudioStatus = { state: 'disabled', message: 'Audio is disabled.' };
    constructor(private root: string, private settings: () => AudioSettings, private emit: Emit, private observedTotalDays?: () => number) {
        if (settings().enabled) this.status = { state: 'idle', message: 'Audio is ready.' };
        this.managed = new ManagedBreeze(path.join(root, 'models'), message => this.update('preparing', message), message => {
            this.stop(); this.update('error', message);
        });
    }
    private store(): AudioLibrary { return this.library ??= new AudioLibrary(path.join(this.root, 'library')); }
    private banks(): CloneBanks { return new CloneBanks(path.join(this.root, 'clone-banks'), BUNDLED_CLONES); }
    cloneBanks() { return this.banks().list(); }
    importCloneBank(manifest: string) { const bank = this.banks().import(manifest); return { key: bank.key, name: bank.name }; }
    cloneBinding(conv: Conversation, characterId: number) {
        return conv.campaignIdentity?.campaignId ? this.store().cloneBinding(this.campaign(conv), String(characterId)) : undefined;
    }
    cloneMode(conv: Conversation, characterId: number): 'auto' | 'normal' {
        return conv.campaignIdentity?.campaignId ? this.store().cloneMode(this.campaign(conv), String(characterId)) : 'auto';
    }
    cloneInfo(conv: Conversation, characterId: number) {
        const actor = conv.gameData.characters.get(characterId), observed = actor ? cloneObservation(actor) : undefined;
        return { mode: this.cloneMode(conv, characterId), automaticKey: observed?.key, needsForm: observed?.ambiguous ?? false };
    }
    private async automaticClone(conv: Conversation, characterId: number, signal: AbortSignal, refreshAging = false): Promise<VoiceProfile | undefined> {
        if (this.settings().provider !== 'breeze' || !this.settings().enabled || this.cloneMode(conv, characterId) === 'normal' || this.cloneBinding(conv, characterId)) return;
        const actor = conv.gameData.characters.get(characterId); if (!actor) return;
        this.update('preparing', 'Checking the speaker’s recorded character voice…');
        const observed = await captureCloneForAudio(actor, conv.gameData, signal, { refreshAging });
        console.info('[Audio clone routing] ' + JSON.stringify({ characterId, historicalId: observed?.id ?? null,
            bank: observed?.key ?? null, formTraits: observed?.traits ?? [], outcome: observed?.key ? 'clone' : observed ? 'uncovered' : 'catalog-unavailable' }));
        if (!observed?.key) return;
        const bank = this.banks().load(observed.key), expected = bundledCloneCatalog()?.profiles[observed.key];
        if (!expected || bank.manifestHash !== expected.manifestHash) throw new Error('The bundled character reference changed. Reinstall the intact voice bank or assign a separate revision.');
        return this.store().importClone(this.campaign(conv), String(characterId), bank);
    }
    bindClone(conv: Conversation, characterId: number, key?: string): void {
        if (!Number.isSafeInteger(characterId) || !conv.gameData.characters.has(characterId)) throw new Error('Select a character in the current encounter.');
        if (this.settings().provider !== 'breeze') throw new Error('Choose Breeze to assign reference clone banks.');
        const bank = key === undefined || key === '__auto__' ? undefined : this.banks().load(key);
        this.stop(); this.store().setCloneMode(this.campaign(conv), String(characterId), key === undefined ? 'normal' : 'auto');
        this.store().bindClone(this.campaign(conv), String(characterId), bank);
        this.update(this.settings().enabled ? 'idle' : 'disabled', bank ? `${bank.name} assigned. Tone and whispered thoughts remain enabled.` : key === '__auto__' ? 'Automatic character clone selection enabled.' : 'Normal character casting restored for new playback.');
    }
    private boundClone(conv: Conversation, characterId: number): VoiceProfile | undefined {
        if (this.settings().provider !== 'breeze') return;
        const binding = this.cloneBinding(conv, characterId); if (!binding) return;
        const bank = this.banks().load(binding.key);
        if (bank.manifestHash !== binding.manifestHash) throw new Error('The assigned clone bank changed. Import a new revision and assign it explicitly.');
        return this.store().importClone(this.campaign(conv), String(characterId), bank);
    }
    private ordinary(campaign: string, characterId: string): VoiceProfile | undefined {
        const active = this.store().get(campaign, characterId);
        return active && !cloneIdentity(active) ? active : this.store().list(campaign).find(p => p.characterId === characterId && !cloneIdentity(p));
    }
    private narratorVoice(reset = false): VoiceProfile {
        const saved = this.store().get('__global__', '__narrator__');
        if (saved && !reset) return saved;
        // The default is the exact auditioned recording, independent of imported
        // banks or character casting. Existing custom narrators remain overrides.
        const bank = new CloneBanks(BUNDLED_CLONES).load(DEFAULT_NARRATOR_BANK);
        if (bank.manifestHash !== DEFAULT_NARRATOR_MANIFEST) throw new Error('The default Medivh recording changed. Reinstall the intact voice bank.');
        return this.store().importClone('__global__', '__narrator__', { ...bank, name: DEFAULT_NARRATOR_NAME });
    }
    useDefaultNarrator(): VoiceProfile {
        this.discardNarratorDraft();
        const profile = this.narratorVoice(true);
        this.update(this.settings().enabled ? 'idle' : 'disabled', `${DEFAULT_NARRATOR_NAME} selected as storyteller.`);
        return profile;
    }
    private performanceFamily(profile: VoiceProfile): DemonFamily | undefined {
        // Recorded performances supply their own physical character. Family metadata
        // describes the source; it must never color a cloned delivery.
        if (profile.characterId === '__narrator__' || cloneIdentity(profile)) return;
        return demonFamily(castingFromProvenance(profile.provenance));
    }
    private familyVoice(campaign:string,id:string,label:string,casting:VoiceCasting|undefined,profile?:VoiceProfile):VoiceProfile|undefined {
        if (!casting || profile && !eligibleFamilyProfile(profile)) return profile;
        const preset=familyPreset(casting);
        if (!preset || preset.mode!=='reference') {
            if(!profile || !retiredPopulationReference(profile))return profile;
            // Restore the same character/form's earlier individual identity, if it
            // exists. Retired files/plans stay available for historical playback.
            const restored=this.store().list(campaign).filter(p=>p.characterId===id && automaticIndividual(p) &&
                castingFromProvenance(p.provenance)?.formKey===casting.formKey).sort((a,b)=>b.revision-a.revision)[0];
            if(restored){this.store().activate(restored);this.store().bindForm(restored,casting.formKey);}
            return restored; // Otherwise normal fresh casting creates one personal reference.
        }
        const origin=preset.reviewVersion?'race-family-reference-v1':'demon-family-reference-v1',version=preset.reviewVersion??FAMILY_VERSION;
        if(profile){try{const p=JSON.parse(profile.provenance);if(p.origin===origin&&p.familyVersion===version&&p.familyKey===preset.key)return profile;}catch{}}
        const reference=familyReference(preset);
        const provenance=JSON.stringify({origin,familyVersion:version,familyKey:preset.key,casting});
        return this.store().importFamilyReference(campaign,id,label,preset.speech,provenance,
            reference.seed,reference.wav,reference.text,casting.formKey);
    }
    private referenceAge(profile:VoiceProfile):CloneReferenceAge|undefined {
        const clone=cloneIdentity(profile),entry=clone?bundledCloneCatalog()?.profiles[clone.key]:undefined;
        // Source annotations belong to the exact sealed edition, never its name.
        return clone&&entry?.manifestHash===clone.manifestHash?entry.referenceAge:undefined;
    }
    private undeadPerformance(profile:VoiceProfile,facts:UndeadFacts|undefined):UndeadPerformance {
        const clone=cloneIdentity(profile),entry=clone?bundledCloneCatalog()?.profiles[clone.key]:undefined;
        // An external bank with a colliding key never inherits the original
        // recording's reviewed treatment. Preserve unknown/custom recordings.
        let coverage:UndeadCoverage=clone?entry?.manifestHash===clone.manifestHash
            ?entry.performanceFamily?'specialized':entry.undeadCoverage??'unknown':'unknown':savedUndeadCoverage(profile);
        if(!clone&&coverage==='unknown'&&facts?.undead)coverage=reviewedRaceReferenceCoverage(profile);
        const performance=decideUndeadPerformance(profile,facts,coverage);
        console.info('[Audio undead receipt] '+JSON.stringify(performance));
        return performance;
    }
    private currentAge(conv: Conversation, actor: Character, maturity?: MaturityStage): string {
        const observed = this.observedTotalDays?.();
        return ageDirection(actor, observed && Number.isFinite(observed) && observed > 0
            ? { ...conv.gameData, totalDays: observed } as typeof conv.gameData : conv.gameData, maturity);
    }
    private currentAgeYears(conv: Conversation, actor: Character): number {
        const observed = this.observedTotalDays?.();
        return characterAgeYears(actor, observed && Number.isFinite(observed) && observed > 0
            ? { ...conv.gameData, totalDays: observed } as typeof conv.gameData : conv.gameData);
    }
    private update(state: AudioStatus['state'], message: string): void {
        const code = audioHostingIssue(message);
        if (code) console.info('[Audio hosting diagnostic] ' + JSON.stringify({ phase: 'status', state, code }));
        this.status = { state, message, enabled: this.settings().enabled }; this.emit('audio-status', this.status);
    }
    list(): (VoiceProfile & { active: boolean })[] {
        return this.store().list().map(voice => ({ ...voice, active: this.store().get(voice.campaign, voice.characterId)?.id === voice.id }));
    }
    renameVoice(id: string, label: string): void { this.store().rename(id, label); }
    deleteVoice(id: string): void {
        this.stop(); this.store().delete(id);
        this.update(this.settings().enabled ? 'idle' : 'disabled', 'Saved voice deleted. Its recording and cached bindings were removed.');
    }
    saveNarrator(label: string, instruction: string): VoiceProfile {
        this.validateInstruction(instruction);
        if (typeof label !== 'string' || !label.trim() || label.trim().length > 100) throw new Error('Enter a voice name between 1 and 100 characters.');
        this.stop(); return this.store().save('__global__', '__narrator__', label.trim(), instruction, 'Player-authored narrator v1', true);
    }
    discardNarratorDraft(): void {
        this.stop(); this.narratorDraft?.close(); this.narratorDraft = undefined;
    }
    saveNarratorDraft(id: string, label: string): VoiceProfile {
        if (typeof label !== 'string' || !label.trim() || label.trim().length > 100) throw new Error('Enter a voice name between 1 and 100 characters.');
        const draft = this.narratorDraft;
        if (!draft || draft.profile.id !== id || !draft.profile.referenceFile)
            throw new Error('Preview this narrator again before saving it.');
        this.stop();
        const alreadySaved = draft.savedId ? this.store().byId(draft.savedId) : undefined;
        if (alreadySaved) { this.store().rename(alreadySaved.id, label); this.store().activate(alreadySaved); return this.store().byId(alreadySaved.id)!; }
        const saved = this.store().importNarrator(draft.profile, label.trim()); draft.savedId = saved.id;
        this.update(this.settings().enabled ? 'idle' : 'disabled', `${saved.label} saved and selected as narrator.`);
        return saved;
    }
    async previewNarratorDraft(instruction: string, text = REFERENCE_TEXT, faithDeliveryId?: string): Promise<{ bytes: Buffer; draftId: string }> {
        this.validateInstruction(instruction);
        if (typeof text !== 'string' || !text.trim() || text.length > 1200) throw new Error('Enter preview words between 1 and 1200 characters.');
        this.stop(); const settings = normalizeAudio(this.settings());
        if (settings.provider !== 'breeze') throw new Error('Choose Breeze to design a narrator voice.');
        const controller = new AbortController(); this.controller = controller; const signal = controller.signal;
        this.activeConv = undefined; let ready = false;
        try {
            this.update('preparing', 'Preparing an unsaved narrator preview…');
            if (settings.hosting === 'managed') await this.managed.start(settings, signal);
            const hosted = this.effectiveSettings(settings);
            const key = JSON.stringify([instruction.trim(), hosted.endpoint, hosted.model, hosted.cfgScale]);
            if (this.narratorDraft?.key !== key) { this.narratorDraft?.close(); this.narratorDraft = new NarratorDraft(key, instruction); }
            const draft = this.narratorDraft;
            const provider = new BreezeProvider(hosted, draft.library);
            const direction = draft.profile.instruction + ' Neutral delivery.';
            let bytes: Buffer | undefined;
            if (!draft.profile.referenceFile) {
                bytes = await provider.speech(REFERENCE_TEXT, direction, draft.profile, signal);
                signal.throwIfAborted();
                draft.profile = draft.library.reference(draft.profile, bytes, REFERENCE_TEXT, this.referenceMetadata(settings, draft.profile, direction));
            }
            if (!bytes || text !== REFERENCE_TEXT || faithDeliveryId) {
                const delivery = acousticDelivery({ kind: 'speech', text, passage: 0 }, 'Speak naturally and clearly.', { faithDeliveryId });
                bytes = await provider.speech(delivery.renderText, delivery.instruction, draft.profile, signal);
            }
            signal.throwIfAborted(); ready = true;
            return { bytes, draftId: draft.profile.id };
        } finally {
            if (this.controller === controller) this.controller = undefined;
            if (!signal.aborted) this.update(ready ? settings.enabled ? 'idle' : 'disabled' : 'error',
                ready ? 'Narrator preview ready. Save narrator to keep this voice.' : 'Narrator preview could not be prepared.');
            this.managed.idle(settings.idleMinutes);
        }
    }
    async previewCharacter(conv: Conversation, characterId: number, text?: string, faithDeliveryId?: string): Promise<Buffer> {
        if (this.settings().provider !== 'breeze') {
            if (!conv.gameData.characters.has(characterId)) throw new Error('Select a character in the current encounter.');
            return this.previewVoice(undefined, faithDeliveryId, text);
        }
        const campaign = this.campaign(conv);
        this.stop(); const controller = new AbortController(); this.controller = controller;
        let profile: VoiceProfile | undefined, age: CloneAgeBand | undefined, ageDirection: string | undefined, maturity: MaturityStage | undefined, development:DevelopmentContext|undefined,undeadFacts:UndeadFacts|undefined;
        try {
            const actor = conv.gameData.characters.get(characterId), years = actor ? this.currentAgeYears(conv, actor) : undefined;
            if (actor) {
                maturity = await captureMaturityForAudio(actor,conv.gameData,controller.signal) ?? maturityFromAge(years);
                undeadFacts=currentUndeadFacts(actor);
                ageDirection = this.currentAge(conv,actor,maturity);
                if(maturity)development={conv,actor,maturity,traits:currentVoiceTraits(actor)??observedVoiceTraits(actor)};
            }
            profile = this.boundClone(conv, characterId);
            if (profile && actor && maturity === 'adult' && years !== undefined && years >= 55) await captureCloneForAudio(actor, conv.gameData, controller.signal, { refreshAging: true });
            profile ??= await this.automaticClone(conv, characterId, controller.signal, maturity === 'adult' && years !== undefined && years >= 55) ?? this.ordinary(campaign, String(characterId));
            if (profile && cloneIdentity(profile) && actor) age = cloneAgeBand(years, cloneObservation(actor)?.aging, maturity, this.referenceAge(profile));
        }
        finally { if (this.controller === controller) this.controller = undefined; }
        controller.signal.throwIfAborted();
        if (!profile) { await this.redesign(conv, characterId,undefined,development); profile = this.store().get(campaign, String(characterId)); }
        if (!profile) throw new Error('The character voice was not prepared.');
        return this.previewVoice(profile.id, faithDeliveryId, text, age, ageDirection, maturity,development,undeadFacts);
    }
    selectVoice(id: string): void {
        const profile = this.store().byId(id); if (!profile?.referenceFile) throw new Error('Preview this candidate to prepare its reference before selecting it.');
        if (cloneIdentity(profile) && profile.characterId !== '__narrator__') throw new Error('Assign this character’s reference using the Clone bank selector.');
        verifyCloneProfile(profile);
        this.stop(); this.store().activate(profile);
        const casting = castingFromProvenance(profile.provenance); if (casting) this.store().bindForm(profile, casting.formKey);
        this.update(this.settings().enabled ? 'idle' : 'disabled', `${profile.label}'s saved reference is selected for future lines.`);
    }
    castingChoices(conv: Conversation, characterId: number): CastingChoices {
        return conv.campaignIdentity?.campaignId ? this.store().castingChoice(this.campaign(conv), String(characterId)) : {};
    }
    async saveCasting(conv: Conversation, characterId: number, input: unknown): Promise<void> {
        const actor = conv.gameData.characters.get(characterId); if (!actor) throw new Error('Select a character in the current encounter.');
        const choices = normalizeCastingChoices(input);
        await this.redesign(conv, characterId, choices);
    }
    saveVoice(id: string, instruction: string): VoiceProfile {
        const previous = this.store().byId(id);
        if (!previous) throw new Error('This voice was deleted. Refresh Audio.');
        if (cloneIdentity(previous)) throw new Error('Clone identity comes from its recording. Import a new bank revision to change it.');
        this.validateInstruction(instruction);
        this.stop(); const casting = castingFromProvenance(previous.provenance);
        const saved = this.store().save(previous.campaign, previous.characterId, previous.label, instruction,
            casting ? JSON.stringify({ version: 2, origin: 'player', casting, individual: instruction }) : 'Player-authored voice instruction v1');
        if (casting) this.store().bindForm(saved, casting.formKey); return saved;
    }
    private validateInstruction(instruction: string): void {
        if (typeof instruction !== 'string' || !instruction.trim() || instruction.length > 2400) throw new Error('Enter a voice description between 1 and 2400 characters.');
    }
    async previewVoice(id?: string, faithDeliveryId?: string, text = REFERENCE_TEXT, cloneAge?: CloneAgeBand, ageDirection?: string, maturity?: MaturityStage, development?:DevelopmentContext,undeadFacts?:UndeadFacts): Promise<Buffer> {
        if (typeof text !== 'string' || !text.trim() || text.length > 1200) throw new Error('Enter preview words between 1 and 1200 characters.');
        this.stop(); const settings = normalizeAudio(this.settings()); const controller = new AbortController(); this.controller = controller;
        this.activeConv = undefined; let ready = false;
        const signal = controller.signal;
        try {
            this.update('preparing', 'Preparing voice preview…');
            if (settings.provider !== 'breeze') {
                const chunks: Buffer[] = [];
                await sideSpeech(settings, text, 'Speak naturally and clearly.', signal, async bytes => { chunks.push(bytes); });
                const { pcmToWav } = await import('./pcm'); ready = true; return pcmToWav(Buffer.concat(chunks));
            }
            let profile = id ? this.store().byId(id) : this.narratorVoice();
            if (!profile) throw new Error('This voice profile is no longer available. Refresh Audio.');
            // An explicitly selected archived reference can still be previewed;
            // fresh encounter playback instead follows the current population policy.
            profile=this.familyVoice(profile.campaign,profile.characterId,profile.label,castingFromProvenance(profile.provenance),profile)??profile;
            const familyKey=eligibleFamilyProfile(profile)?familyPreset(castingFromProvenance(profile.provenance))?.key??retiredPopulationReference(profile)?.key:undefined;
            verifyCloneProfile(profile);
            if (settings.hosting === 'managed') await this.managed.start(settings, signal);
            const provider = new BreezeProvider(this.effectiveSettings(settings), this.store());
            let style='';
            if(development){const result=await this.developVoice(profile,development,provider,settings,signal);profile=result.profile;style=result.style;}
            const instruction = profile.instruction + (profile.characterId === '__narrator__' ? ' Neutral delivery.' : ' A mature adult speaking neutrally.');
            let wav: Buffer | undefined;
            if (!profile.referenceFile) {
                wav = await provider.speech(REFERENCE_TEXT, instruction, profile, signal);
                signal.throwIfAborted();
                profile = this.store().reference(profile, wav, REFERENCE_TEXT, this.referenceMetadata(settings, profile, instruction));
            }
            if(cloneIdentity(profile))cloneAge=ageBeyondReference(cloneAge,this.referenceAge(profile));
            const undead=undeadFacts?this.undeadPerformance(profile,undeadFacts):undefined;
            if (familyKey || !wav || text !== REFERENCE_TEXT || faithDeliveryId || ageDirection !== undefined || cloneAge !== undefined || undeadFacts!==undefined) {
                const family = this.performanceFamily(profile), casting = castingFromProvenance(profile.provenance);
                const delivery = cloneIdentity(profile) ? cloneDelivery({ kind: 'speech', text, passage: 0 }, profile.characterId === '__narrator__' ? 'Speak naturally.' : '', family, cloneAge,undead)
                    : acousticDelivery({ kind: 'speech', text, passage: 0 }, ageDirection ?? 'Speak naturally and clearly.', { familyKey,faithDeliveryId,direction:style,undead,reviewedRaceDirection:reviewedRaceDirection(profile,casting),
                        ...(profile.characterId !== '__narrator__' && casting ? { voice: { anatomyId: casting.anatomyId, body: casting.body, sex: casting.presentation, cultureId: casting.cultureId } } : {}) });
                wav = await provider.speech(delivery.renderText, delivery.instruction, profile, signal, undefined, { familyKey,deliveryKind: 'speech', demonFamily: family, cloneAge, maturity,undead:undead?.treatment==='damaged-throat' });
            }
            ready = true; return wav;
        } finally {
            if (this.controller === controller) this.controller = undefined;
            if (!signal.aborted) this.update(ready ? settings.enabled ? 'idle' : 'disabled' : 'error', ready ? 'Voice preview is ready.' : 'Voice preview could not be prepared.');
            this.managed.idle(settings.idleMinutes);
        }
    }
    changed(): void {
        this.discardNarratorDraft(); this.managed.stop();
        clearCastingObservations(); currentCastingCapture();
        this.update(this.settings().enabled ? 'idle' : 'disabled', this.settings().enabled ? 'Audio is ready.' : 'Audio is disabled.');
    }
    enqueue(conv: Conversation, message: Message): void {
        const settings = normalizeAudio(this.settings());
        if (!settings.enabled || message.role === 'system' && (message.type !== 'scene' || !settings.narrator) || message.role === 'user' && !settings.playerSpeech || !message.id) return;
        if (this.activeConv && this.activeConv !== conv) this.stop();
        this.activeConv = conv;
        const actor = conv.gameData.characters.get(message.characterId ?? conv.gameData.playerID);
        const view = conv.messageForPlayer(message);
        if (!actor || !view) return;
        traceDelivery(view, actor.id, conv.gameData.playerID, false);
        const campaign = this.campaign(conv);
        const profile = (message.type !== 'scene' ? this.boundClone(conv, actor.id) : undefined) ?? this.ordinary(campaign, String(actor.id));
        const existingCasting = profile ? castingFromProvenance(profile.provenance) : undefined;
        const age = this.currentAge(conv, actor), cues = audioCuesFor(message);
        this.store().savePlan(campaign, String(conv.gameData.playerID), message.id, heardDigest(view),
            { version: 2, age, cues, characterVoiceId: profile?.id, pending:true });
        const observedBody = settings.provider === 'breeze' && (!profile || existingCasting) ? getVerifiedGoaSnapshot(actor) : undefined;
        this.queue.push({ conv, actor: Object.assign(Object.create(Object.getPrototypeOf(actor)), actor),
            bodySnapshot: observedBody ? structuredClone(observedBody) : undefined,
            view: structuredClone(view), settings, age, cues, epoch: this.epoch, cloneAgeYears: this.currentAgeYears(conv, actor),
            design: message.type === 'scene' || profile && !existingCasting ? undefined : prepareVoiceDesign(conv, actor, undefined,
                profile && existingCasting ? this.individual(profile) : undefined), characterVoiceId: profile?.id });
        void this.drain();
    }
    private savePlaybackPlan(job: PlaybackJob, pending: boolean, audioState: 'muted' | 'completed'): void {
        if (!job.view.id) return;
        this.store().savePlan(this.campaign(job.conv), String(job.conv.gameData.playerID), job.view.id, heardDigest(job.view),
            { version: 2, age: job.age, cues: job.cues, casting: job.casting, characterVoiceId: job.characterVoiceId,
                narratorVoiceId: job.narratorVoiceId, familyKey: job.familyKey, voiceStyle: job.voiceStyle, undead: job.undead,
                provider: job.settings.provider, pending, audioState });
    }
    replay(conv: Conversation, id: string): void {
        const current = conv.getHistory().find(message => message.id === id);
        const view = current ?? conv.historicalConversations.flatMap(history => history.messages).find(message => message.id === id);
        if (!view) throw new Error('This message is no longer available in the displayed history.');
        const settings = normalizeAudio(this.settings());
        if (!settings.enabled) throw new Error('Enable Audio to replay voices.');
        const characterId = view.characterId ?? (view.role === 'user' ? conv.gameData.playerID : undefined);
        if (characterId === undefined) throw new Error('This old reply has no verified character identity for voice playback.');
        const campaign = this.campaign(conv), saved = this.store().plan(campaign, String(conv.gameData.playerID), id, heardDigest(view));
        const original = saved ?? this.store().plan(campaign, String(conv.gameData.playerID), id);
        const needsCharacter = view.type !== 'scene' && projectAudioUtterances(view, { ...settings, narrator: true }, original?.cues ?? [])
            .some(segment => segment.kind !== 'narration');
        // Optional speech providers use their configured voice directly. Narration can
        // use the global storyteller even if it was muted when this turn was received.
        if(!current&&original?.pending&&settings.provider==='breeze'&&needsCharacter)
            throw new Error('This historical reply’s voice preparation did not finish. Open a current encounter to prepare its voice.');
        if (settings.provider === 'breeze' && needsCharacter && !original?.pending && original?.characterVoiceId && !this.store().byId(original.characterVoiceId))
            throw new Error('The saved voice for this replay was deleted. Play a new reply to prepare a current voice.');
        const actor = conv.getEncounterCharacter(characterId);
        const firstPlayback = !!current && (original?.pending===true||!original?.characterVoiceId && !original?.casting);
        const profile = firstPlayback ? this.boundClone(conv, characterId) ?? this.ordinary(campaign, String(characterId)) : original?.characterVoiceId ? this.store().byId(original.characterVoiceId) : original?.casting
            ? this.store().form(campaign, String(characterId), original.casting.formKey) : this.ordinary(campaign, String(characterId));
        if (!actor && !profile && settings.provider === 'breeze' && needsCharacter)
            throw new Error('This character has no prepared voice. Open an encounter with them first.');
        traceDelivery(view, characterId, conv.gameData.playerID, true);
        this.stop(); this.activeConv = conv;
        if (profile) verifyCloneProfile(profile);
        const observedBody = firstPlayback && actor && !(profile && cloneIdentity(profile)) ? getVerifiedGoaSnapshot(actor) : undefined;
        this.queue.push({ conv, view: structuredClone(view), settings, epoch: this.epoch,
            actor: actor ? Object.assign(Object.create(Object.getPrototypeOf(actor)), actor)
                : { id: characterId, fullName: profile?.label ?? view.name ?? 'Narrator', shortName: profile?.label ?? view.name ?? 'Narrator' } as Character,
            bodySnapshot: observedBody ? structuredClone(observedBody) : undefined,
            age: !original?.pending&&original?.age ? original.age : current&&actor?this.currentAge(conv,actor):'Use the established natural voice.',
            cues: saved?.cues ?? [], characterVoiceId: profile?.id, narratorVoiceId: original?.narratorVoiceId,
            familyKey:typeof original?.familyKey==='string'?original.familyKey:undefined,
            voiceStyle:validVoiceStyle(original?.voiceStyle)?original.voiceStyle:undefined,
            undead:validUndeadPerformance(original?.undead,profile?.id)?original.undead:undefined,
            casting: original?.casting, replay: true, historical: !current, prepareCasting: firstPlayback && !(profile && cloneIdentity(profile)),
            prepareCloneAge: firstPlayback, cloneAgeYears: firstPlayback && actor ? this.currentAgeYears(conv, actor) : undefined,
            design: !actor || profile && !firstPlayback ? undefined : prepareVoiceDesign(conv, actor, original?.casting,
                profile ? this.individual(profile) : undefined) });
        void this.drain();
    }
    invalidate(conv?: Conversation): void { if (!conv || this.activeConv === conv) this.stop(); }
    hasEncounterWork(conv: Conversation): boolean { return this.activeConv === conv && (!!this.controller || !!this.queue.length); }
    stop(): void {
        this.epoch++; this.queue = []; this.controller?.abort(); this.controller = undefined;
        this.finish?.reject(new Error('Audio stopped.')); this.finish = undefined;
        this.paused = false; this.playbackMessage = ''; this.emit('audio-stop'); this.update(this.settings().enabled ? 'idle' : 'disabled', this.settings().enabled ? 'Playback stopped.' : 'Audio is disabled.');
    }
    pause(): void { this.paused = !this.paused; this.emit('audio-pause', this.paused); this.showPlayback(this.playbackMessage || 'Playback'); }
    private showPlayback(message: string): void {
        this.playbackMessage = message;
        this.update(this.paused ? 'paused' : 'speaking', this.paused ? `Paused · ${message}` : message);
    }
    completed(id: string): void { if (this.finish?.id === id) { this.finish.resolve(); this.finish = undefined; } }
    async test(): Promise<void> {
        this.stop(); this.activeConv = undefined;
        const settings = normalizeAudio(this.settings()); const controller = new AbortController(); this.controller = controller;
        try {
        if (settings.provider !== 'breeze') throw new Error('Use a preview to test optional speech connections.');
        if (settings.hosting === 'managed') await this.managed.start(settings, controller.signal);
        await new BreezeProvider(this.effectiveSettings(settings), this.store()).health(controller.signal);
        this.update('idle', 'Breeze connection is ready.'); this.managed.idle(settings.idleMinutes);
        } finally { if (this.controller === controller) this.controller = undefined; }
    }
    async redesign(conv: Conversation, characterId: number, choices?: CastingChoices, development?:DevelopmentContext): Promise<void> {
        this.stop(); const actor = conv.gameData.characters.get(characterId);
        if (!actor) throw new Error('Select a character in the current encounter.');
        if (this.cloneBinding(conv, characterId)) throw new Error('This character uses a clone bank. Choose Normal casting before redesigning it.');
        const campaign = this.campaign(conv); const controller = new AbortController(); this.controller = controller;
        this.activeConv = conv;
        this.update('preparing', `Designing ${actor.shortName}'s voice…`);
        try {
            if(!development){const maturity=await captureMaturityForAudio(actor,conv.gameData,controller.signal)??maturityFromAge(this.currentAgeYears(conv,actor));if(maturity)development={conv,actor,maturity,traits:currentVoiceTraits(actor)??observedVoiceTraits(actor)};}
            const selected = choices ?? this.store().castingChoice(campaign, String(actor.id));
            await captureForAudio(actor, conv.gameData, controller.signal, { body: !selected.anatomyId, culture: selected.cultureId === undefined });
            const casting = resolveUndeadVoiceCasting(actor, selected,undefined,getVerifiedGoaSnapshot(actor),currentUndeadFacts(actor));
            if (choices) this.store().saveCastingChoice(campaign, String(actor.id), choices);
            const context=development?{phase:isAdultMaturity(development.maturity)?'adult' as const:'provisional' as const,traits:development.traits}:undefined;
            const shared=this.familyVoice(campaign,String(actor.id),actor.fullName,casting);
            if(shared){this.update(this.settings().enabled?'idle':'disabled',`${actor.shortName}'s approved family reference is ready.`);return;}
            const designed = await designCharacterVoice(conv, actor, controller.signal, prepareVoiceDesign(conv, actor, casting,undefined,context)); controller.signal.throwIfAborted();
            const profile = this.store().save(campaign, String(actor.id), actor.fullName, designed.instruction, designed.provenance);
            this.store().bindForm(profile, casting.formKey);
            this.update(this.settings().enabled ? 'idle' : 'disabled', `${actor.shortName}'s new voice design is saved.`);
        } catch (error) { if (!controller.signal.aborted) { this.update('error', (error as Error).message); throw error; } }
    }
    private campaign(conv: Conversation): string {
        if (!conv.campaignIdentity?.campaignId) throw new Error('A verified campaign identity is needed to save consistent character voices. Reopen an encounter with a compatible subscribed VOTC CE version.');
        return conv.campaignIdentity.campaignId;
    }
    private effectiveSettings(settings: AudioSettings): AudioSettings {
        const model = this.managed.activeModel ?? settings.managedModel;
        return settings.hosting === 'managed' && settings.provider === 'breeze'
            ? { ...settings, managedModel: model, endpoint: 'http://127.0.0.1:18891', model: model + ':' + BREEZE_MODELS[model].sha256 } : settings;
    }
    private referenceMetadata(settings: AudioSettings, profile: VoiceProfile, instruction: string): NonNullable<VoiceProfile['referenceMetadata']> {
        const effective = this.effectiveSettings(settings);
        return { model: effective.model, runtime: settings.hosting === 'managed' ? effective.managedModel : 'external-breeze',
            cfgScale: settings.cfgScale, sampleRate: 24000, seed: profile.seed, instruction };
    }
    private individual(profile: VoiceProfile): string | undefined {
        try { const data = JSON.parse(profile.provenance); return typeof data.individual === 'string' ? data.individual : undefined; }
        catch { return; }
    }
    private async developVoice(profile:VoiceProfile,context:DevelopmentContext,provider:BreezeProvider,settings:AudioSettings,signal:AbortSignal):Promise<{profile:VoiceProfile;style:string}> {
        if(profile.characterId==='__narrator__'||cloneIdentity(profile)||!automaticIndividual(profile))return {profile,style:''};
        const hash=personalityHash(context.traits),designed=designDevelopment(profile);
        if(!isAdultMaturity(context.maturity)&&designed?.originalVoiceId){
            const original=this.store().byId(designed.originalVoiceId);
            if(original&&original.campaign===profile.campaign&&original.characterId===profile.characterId&&automaticIndividual(original)){
                this.store().activate(original);const key=castingFromProvenance(original.provenance)?.formKey;if(key)this.store().bindForm(original,key);
                return this.developVoice(original,context,provider,settings,signal);
            }
        }
        let state=this.store().development(profile);
        if(!state){
            state={phase:designed?.phase??(isAdultMaturity(context.maturity)&&!this.store().heardAsChild(profile)?'adult':'provisional'),personalityHash:personalityHash(designed?.traits??context.traits),style:''};
            this.store().saveDevelopment(profile,state);
        }
        if(state.phase==='provisional'&&isAdultMaturity(context.maturity)){
            const adult=state.adultVoiceId?this.store().byId(state.adultVoiceId):undefined;
            if(adult){this.store().activate(adult);const key=castingFromProvenance(adult.provenance)?.formKey;if(key)this.store().bindForm(adult,key);return this.developVoice(adult,context,provider,settings,signal);}
            this.update('preparing',`Finalizing ${profile.label}’s adult voice…`);
            const casting=castingFromProvenance(profile.provenance);
            const development={phase:'adult' as const,traits:context.traits,originalVoiceId:profile.id};
            const prepared=context.design ? updatePreparedVoiceDesign(context.design,casting,this.individual(profile),development)
                : prepareVoiceDesign(context.conv,context.actor,casting,this.individual(profile),development);
            const voice=await designCharacterVoice(context.conv,context.actor,signal,prepared);signal.throwIfAborted();
            const target={...profile,instruction:voice.instruction,provenance:voice.provenance};
            const direction='The same speaker as a fully mature adult. Retain the original vocal texture and accent. Speak neutrally and clearly. '+(this.individual(target)??target.instruction);
            const wav=await provider.speech(REFERENCE_TEXT,direction,target,signal,undefined,{deliveryKind:'speech',maturity:'adult'});signal.throwIfAborted();
            profile=this.store().finalizeAdult(profile,voice.instruction,voice.provenance,wav,REFERENCE_TEXT,this.referenceMetadata(settings,target,direction),hash,casting?.formKey);
            return {profile,style:''};
        }
        if(state.personalityHash!==hash){
            this.update('preparing',`Updating ${profile.label}’s speaking habits…`);
            const style=await designPersonalityStyle(context.conv,context.traits,signal);signal.throwIfAborted();
            state={...state,personalityHash:hash,style};this.store().saveDevelopment(profile,state);
        }
        return {profile,style:state.style};
    }
    private async voice(job: PlaybackJob, narrator: boolean, provider: BreezeProvider, signal: AbortSignal): Promise<VoiceProfile> {
        const campaign = narrator ? '__global__' : this.campaign(job.conv), id = narrator ? '__narrator__' : String(job.actor.id);
        const recorded = narrator ? job.narratorVoiceId : job.characterVoiceId;
        if (recorded && !this.store().byId(recorded)) throw new Error('The saved voice for this replay was deleted. Play a new reply to prepare a current voice.');
        let profile = this.store().byId(recorded ?? '') ??
            (narrator ? this.narratorVoice() : job.casting ? this.store().form(campaign, id, job.casting.formKey) : this.ordinary(campaign, id));
        if(!narrator && (!job.replay || job.prepareCasting)) {
            profile=this.familyVoice(campaign,id,job.actor.fullName,job.casting,profile);
            if(profile && eligibleFamilyProfile(profile))job.familyKey=familyPreset(castingFromProvenance(profile.provenance))?.key;
        }
        const current=!narrator&&job.maturity&&(!job.replay||job.prepareCloneAge||job.prepareCasting)?
            {conv:job.conv,actor:job.actor,maturity:job.maturity,traits:job.voiceTraits??observedVoiceTraits(job.actor),design:job.design}:undefined;
        if (!profile) {
            this.update('preparing', `Designing ${job.actor.shortName}'s voice…`);
            const preceding=this.ordinary(campaign,id);
            const designed = await designCharacterVoice(job.conv, job.actor, signal, current?updatePreparedVoiceDesign(
                    job.design??prepareVoiceDesign(job.conv,job.actor),job.casting,preceding?this.individual(preceding):undefined,
                    {phase:isAdultMaturity(current.maturity)?'adult':'provisional',traits:current.traits}):job.design);
            signal.throwIfAborted(); profile = this.store().save(campaign, id, job.actor.fullName, designed.instruction, designed.provenance,
                !!preceding&&!!retiredPopulationReference(preceding));
            const casting = job.casting ?? castingFromProvenance(profile.provenance);
            if (casting) this.store().bindForm(profile, casting.formKey);
        }
        if(!narrator && (!job.replay || job.prepareCasting) && eligibleFamilyProfile(profile))job.familyKey=familyPreset(castingFromProvenance(profile.provenance))?.key;
        verifyCloneProfile(profile);
        if(current){const developed=await this.developVoice(profile,current,provider,job.settings,signal);profile=developed.profile;job.voiceStyle=developed.style;}
        if (!profile.referenceFile) {
            this.update('preparing', `Preparing ${profile.label}'s consistent voice…`);
            // Identity reference is adult and emotionally neutral. Current age belongs only to playback.
            const instruction = profile.instruction + (narrator ? ' Neutral delivery.' : ' A mature adult speaking neutrally.');
            const wav = await provider.speech(REFERENCE_TEXT, instruction, profile, signal);
            signal.throwIfAborted(); profile = this.store().reference(profile, wav, REFERENCE_TEXT, this.referenceMetadata(job.settings, profile, instruction));
        }
        if (narrator) job.narratorVoiceId = profile.id; else job.characterVoiceId = profile.id;
        return profile;
    }
    private async drain(): Promise<void> {
        if (this.draining) return; this.draining = true;
        try {
            while (this.queue.length) {
                const job = this.queue.shift()!;
                if (job.epoch !== this.epoch || job.conv.isOpen === false) continue;
                const controller = new AbortController(); this.controller = controller; const signal = controller.signal;
                let pipeline: AudioPipeline | undefined;
                try {
                    const segments = job.view.type === 'scene'
                        ? phraseAudioText(job.view.content, true).map(text => ({ kind: 'narration' as const, text, passage: -1 }))
                        : projectAudioUtterances(job.view, job.settings, job.cues);
                    if (!segments.length) { this.savePlaybackPlan(job, false, 'muted'); continue; }
                    // An existing current reply may be the player's first voice request after enabling Audio.
                    // Prepare its casting once; already recorded/historical replays retain their frozen identity.
                    const firstReplay = job.replay && !job.historical && job.prepareCasting;
                    const freshMaturity = !job.replay || job.prepareCloneAge || firstReplay;
                    if (freshMaturity && segments.some(s=>s.kind!=='narration')) {
                        this.update('preparing', 'Checking the speaker’s current maturity…');
                        const actor = job.conv.gameData.characters.get(job.actor.id) ?? job.actor;
                        job.maturity = await captureMaturityForAudio(actor,job.conv.gameData,signal) ?? maturityFromAge(job.cloneAgeYears);
                        job.voiceTraits=currentVoiceTraits(actor)??observedVoiceTraits(actor);
                        job.undeadFacts=currentUndeadFacts(actor);
                        job.age = this.currentAge(job.conv,job.actor,job.maturity);
                    }
                    let automatic: VoiceProfile | undefined;
                    if (job.settings.provider === 'breeze' && (!job.replay || firstReplay) && segments.some(s => s.kind !== 'narration')) {
                        automatic = await this.automaticClone(job.conv, job.actor.id, signal, job.maturity === 'adult' && job.cloneAgeYears !== undefined && job.cloneAgeYears >= 55);
                        if (automatic) { job.characterVoiceId = automatic.id; job.casting = undefined; job.design = undefined; }
                    }
                    const selected = job.characterVoiceId ? this.store().byId(job.characterVoiceId) : undefined;
                    if (selected) verifyCloneProfile(selected);
                    const cloned = !!selected && !!cloneIdentity(selected);
                    if (cloned && (!job.replay || job.prepareCloneAge)) {
                        const actor = job.conv.gameData.characters.get(job.actor.id);
                        const observed = actor && job.maturity === 'adult' && job.cloneAgeYears !== undefined && job.cloneAgeYears >= 55
                            ? automatic ? cloneObservation(actor) : await captureCloneForAudio(actor, job.conv.gameData, signal, { refreshAging: true }) : undefined;
                        job.age = cloneAgeInstruction(cloneAgeBand(job.cloneAgeYears, observed?.aging, job.maturity, this.referenceAge(selected!)));
                    }
                    if (!cloned && job.settings.provider === 'breeze' && (!job.replay || firstReplay) && segments.some(segment => segment.kind !== 'narration')) {
                        const campaign = this.campaign(job.conv), actorId = String(job.actor.id);
                        const old = job.characterVoiceId ? this.store().byId(job.characterVoiceId) : this.ordinary(campaign, actorId);
                        const established = old ? castingFromProvenance(old.provenance) : undefined;
                        // Legacy saved voices remain exact. New cast voices refresh only through this audio-owned path.
                        if (!old || established) {
                            this.update('preparing', 'Reading current body and culture for this voice…');
                            const choices = this.store().castingChoice(campaign, actorId);
                            await captureForAudio(job.actor, job.conv.gameData, signal, {
                                body: !job.bodySnapshot && !choices.anatomyId, culture: !established && choices.cultureId === undefined });
                            const casting = resolveUndeadVoiceCasting(job.actor, choices, established, job.bodySnapshot ?? getVerifiedGoaSnapshot(job.actor),job.undeadFacts);
                            const prepared = this.store().form(campaign, actorId, casting.formKey) ??
                                (established?.formKey === casting.formKey ? old : undefined);
                            job.casting = casting; job.characterVoiceId = prepared?.id;
                            // A late native body capture can fill previously unavailable
                            // context. Otherwise retain the complete enqueue-time input.
                            if (!job.design) job.design = prepareVoiceDesign(job.conv, job.actor, casting, old ? this.individual(old) : undefined);
                            else if (!job.bodySnapshot) job.design = refreshPreparedVoiceBody(job.design, job.conv, job.actor, casting, old ? this.individual(old) : undefined);
                            job.design.casting = casting;
                            if (job.view.id) this.store().savePlan(campaign, String(job.conv.gameData.playerID), job.view.id,
                                heardDigest(job.view), { version: 2, age: job.age, cues: job.cues, casting, characterVoiceId: job.characterVoiceId,pending:true });
                        }
                    }
                    if (job.settings.provider === 'breeze' && job.settings.hosting === 'managed') {
                        this.update('preparing', 'Loading Breeze…'); await this.managed.start(job.settings, signal);
                    }
                    const provider = new BreezeProvider(this.effectiveSettings(job.settings), this.store());
                    // Each role is prepared when the serial producer first reaches it.
                    // Opening narration can play while the character is prepared, and the
                    // same character profile supplies every spoken and whispered passage.
                    const prepared = new Map<'character' | 'narrator', VoiceProfile>();
                    const passages = segments.filter(s => s.kind !== 'thought' || job.settings.provider !== 'elevenlabs').map(segment => ({
                        segment, label: segment.kind === 'narration' ? 'Narrator' : `${job.actor.shortName}${segment.kind === 'thought' ? ' · thoughts' : ''}` }));
                    if (!passages.length) continue;
                    let playing = -1, playbackId = '', hasPCM = false;
                    const progress = () => {
                        if (!pipeline || !playbackId || this.finish?.id !== playbackId || signal.aborted) return;
                        const state = pipeline.state(), passage = passages[playing];
                        const ready = Math.max(0, state.completed - playing - 1);
                        const upcoming = state.generating !== null && state.generating > playing
                            ? ` · Generating ${passages[state.generating].label} (${state.generating + 1} of ${passages.length})…`
                            : ready ? ` · ${ready} upcoming ${ready === 1 ? 'passage' : 'passages'} ready` : '';
                        const message = `${passage.label} · ${playing + 1} of ${passages.length}` +
                            (state.waiting ? ' · Queued audio ready; waiting for playback' : upcoming);
                        if (hasPCM) this.showPlayback(message); else this.update('preparing', `Generating ${message}…`);
                    };
                    pipeline = new AudioPipeline(passages.length, async (index, stream) => {
                        const { segment } = passages[index], role = segment.kind === 'narration' ? 'narrator' : 'character';
                        let profile = prepared.get(role);
                        if (!profile && job.settings.provider === 'breeze') {
                            profile = await this.voice(job, role === 'narrator', provider, signal); prepared.set(role, profile);
                            if(role==='character'&&freshMaturity)job.undead=this.undeadPerformance(profile,job.undeadFacts);
                            if (job.view.id) this.store().savePlan(this.campaign(job.conv), String(job.conv.gameData.playerID), job.view.id,
                                heardDigest(job.view), { version: 2, age: job.age, cues: job.cues, casting: job.casting,
                                    characterVoiceId: job.characterVoiceId, narratorVoiceId: job.narratorVoiceId,familyKey:job.familyKey,voiceStyle:job.voiceStyle,undead:job.undead,
                                    pending:!!freshMaturity&&!prepared.has('character')&&segments.some(s=>s.kind!=='narration') });
                        }
                        const cue = job.cues.find(c => c.passage === segment.passage)?.direction ?? job.cues.find(c => c.passage === undefined)?.direction ?? 'Speak naturally.';
                        const casting = profile ? castingFromProvenance(profile.provenance) : undefined;
                        const family = profile ? this.performanceFamily(profile) : undefined;
                        const cloneAge = role === 'character' && profile && cloneIdentity(profile) ? ageBeyondReference(recordedCloneAge(job.age),this.referenceAge(profile)) : undefined;
                        const undead=role==='character'&&validUndeadPerformance(job.undead,profile?.id)?job.undead:undefined;
                        const delivery = profile && cloneIdentity(profile) ? cloneDelivery(segment, cue, family, cloneAge,undead) : acousticDelivery(segment, job.age, { familyKey:role==='character'?job.familyKey:undefined,undead,reviewedRaceDirection:role==='character'?reviewedRaceDirection(profile,casting):undefined,direction: role==='character'?[job.voiceStyle,cue].filter(Boolean).join(' '):cue,
                            ...(role === 'character' && profile ? { voice: { sex: casting?.presentation, anatomyId: casting?.anatomyId, body: casting?.body, cultureId: casting?.cultureId } } : {}) });
                        const maturity = role === 'character' ? job.maturity ?? recordedMaturity(job.age) : undefined;
                        if (profile) await provider.speech(delivery.renderText, delivery.instruction, profile, signal, stream, { familyKey:role==='character'?job.familyKey:undefined,singleUtterance: true, deliveryKind: segment.kind, demonFamily: family, cloneAge, maturity,undead:undead?.treatment==='damaged-throat' });
                        else await sideSpeech(job.settings, delivery.renderText, delivery.instruction, signal, stream);
                    }, signal, progress);
                    for (const [index, { segment, label }] of passages.entries()) {
                        signal.throwIfAborted();
                        const id = randomUUID(); this.update('preparing', `Generating ${label} · ${index + 1} of ${passages.length}…`);
                        let finishTimer: ReturnType<typeof setTimeout> | undefined;
                        const finished = new Promise<void>((resolve, reject) => { this.finish = { id,
                            resolve: () => { clearTimeout(finishTimer); resolve(); }, reject: error => { clearTimeout(finishTimer); reject(error); } }; });
                        // Attach rejection immediately so cancellation during a provider await cannot go unhandled.
                        void finished.catch(() => {});
                        // A short fixed lead can drain mid-sentence when GPU contention slows
                        // synthesis. Buffer this complete planned utterance before playing it;
                        // the serial producer still prepares following passages during playback.
                        this.emit('audio-start', { id, sampleRate: 24000, volume: job.settings.volume, kind: segment.kind, messageId: job.view.id,
                            bufferAll: true, pauseBeforeMs: 300 });
                        playing = index; playbackId = id; hasPCM = false;
                        pipeline.connect(index, bytes => {
                            signal.throwIfAborted(); this.emit('audio-chunk', id, bytes);
                            if (!hasPCM) { hasPCM = true; progress(); }
                        });
                        // No next audio-start is emitted until the current passage is acknowledged.
                        // If generation is still running, its remaining PCM now streams to this id.
                        const audio = pipeline.passage(index);
                        await audio.done; signal.throwIfAborted();
                        this.emit('audio-end', id);
                        const checkCompletion = () => {
                            if (this.finish?.id !== id) return;
                            if (this.paused) finishTimer = setTimeout(checkCompletion, 60_000);
                            else { this.finish.reject(new Error('Playback did not finish. Reopen the chat window and replay this voice.')); this.finish = undefined; }
                        };
                        if (this.finish?.id === id) { finishTimer = setTimeout(checkCompletion, audio.bytes / 48 + 60_000); finishTimer.unref?.(); }
                        await finished;
                    }
                    this.savePlaybackPlan(job, false, 'completed');
                } catch (error) {
                    const interrupted = signal.aborted; controller.abort();
                    this.finish?.reject(new Error('Audio delivery ended.')); this.finish = undefined;
                    if (!interrupted) { this.emit('audio-stop'); this.update('error', (error as Error).message); }
                    await pipeline?.finished.catch(() => {});
                } finally { if (this.controller === controller) this.controller = undefined; }
            }
            if (this.status.state !== 'error') this.update(this.settings().enabled ? 'idle' : 'disabled', this.settings().enabled ? 'Audio is ready.' : 'Audio is disabled.');
            this.managed.idle(this.settings().idleMinutes);
        } finally { this.draining = false; }
    }
    shutdown(): void { this.discardNarratorDraft(); this.managed.cancelInstall(); this.managed.stop(); this.library?.close(); this.library = undefined; }
    preparationFailed(error?: unknown): void { this.update('error', error instanceof Error ? error.message : 'Character voice preparation could not start. Check the Audio connection and verified campaign identity.'); }
}
let runtime: AudioRuntime | undefined;
export function setAudioRuntime(value: AudioRuntime): void { runtime = value; }
export function enqueueConversationAudio(conv: Conversation, message: Message): void {
    if (conv.config.audio?.enabled) try { runtime?.enqueue(conv, message); } catch (error) { runtime?.preparationFailed(error); }
}
export function invalidateConversationAudio(conv: Conversation): void { if (conv.config.audio?.enabled || runtime?.hasEncounterWork(conv)) runtime?.invalidate(conv); }
