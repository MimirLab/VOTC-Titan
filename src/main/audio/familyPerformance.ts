/** Player-selected generated-family defaults. Named character clones never enter this lane. */
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { app } from 'electron';
import type { VoiceProfile, AudioSegment } from '../../shared/audio';
import type { VoiceCasting } from './acousticCasting';
import { demonFamily, WHISPER_DIRECTION } from './demonVoices';
import { cloneIdentity } from './CloneBanks';
import { automaticIndividual } from './voiceDevelopment';
import { recordedMaturity } from './maturation';
import { raceReferencePreset, raceReferenceByKey } from './raceSelections';

export interface FamilyPreset {
    key: string; family: string; sex: string; mode: 'individual'|'reference'; cfgScale: number; speech: string;
    selectedSha256: string; referenceFile?: string; referenceSha256?: string; referenceText?: string; seed?: number;
    effectAlgorithm?: 'pass2-effects'|'vocal-grit'|'pitch-layers'; effect?: any;
    reviewVersion?: string;
    sourceBank?: { key: string; manifestHash: string };
}
export const FAMILY_VERSION = 'player-approved-20261017-v1';
export function familyPresets(): readonly FamilyPreset[] {
    const data = JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'public/audio/demon-families/manifest.json'), 'utf8'));
    if (data.version !== FAMILY_VERSION || data.canonicalClonesExcluded !== true || data.presets.length !== 19)
        throw new Error('The approved demon voice defaults are incomplete. Reinstall the intact Audio assets.');
    return data.presets;
}
export function familyPreset(casting?: VoiceCasting): FamilyPreset | undefined {
    const reviewed=raceReferencePreset(casting);
    if(reviewed)return reviewed;
    const family = demonFamily(casting);
    return family ? familyPresets().find(p => p.family === family && (p.sex === 'shared' || p.sex === casting?.presentation)) : undefined;
}
export function eligibleFamilyProfile(profile: VoiceProfile): boolean {
    if (profile.characterId === '__narrator__' || cloneIdentity(profile)) return false;
    try { return automaticIndividual(profile) || ['demon-family-reference-v1','race-family-reference-v1'].includes(JSON.parse(profile.provenance).origin); }
    catch { return false; }
}
export function selectedFamilyPreset(profile: VoiceProfile, key?: string): FamilyPreset | undefined {
    if (!key || !eligibleFamilyProfile(profile)) return;
    const casting = JSON.parse(profile.provenance).casting as VoiceCasting | undefined;
    const preset = performancePreset(key,casting);
    if (preset?.key !== key) throw new Error('The saved demon performance does not match this voice.');
    return preset;
}
export function performancePreset(key:string,casting?:VoiceCasting):FamilyPreset|undefined {
    const reviewed=raceReferenceByKey(key,casting);
    if(reviewed)return reviewed;
    const preset=familyPreset(casting);
    return preset?.key===key?preset:undefined;
}
export function familyReference(preset: FamilyPreset): {wav: Buffer; text: string; seed: number} {
    if (preset.mode !== 'reference' || !preset.referenceFile || path.basename(preset.referenceFile) !== preset.referenceFile || !preset.referenceText || !preset.seed)
        throw new Error('Missing approved family reference.');
    const wav = fs.readFileSync(path.join(app.getAppPath(), preset.reviewVersion?'public/audio/race-selections':'public/audio/demon-families', preset.referenceFile));
    if (createHash('sha256').update(wav).digest('hex') !== preset.referenceSha256)
        throw new Error('The approved demon reference changed. Reinstall the intact Audio assets.');
    return { wav, text: preset.referenceText, seed: preset.seed };
}
export function familyDesignDirection(casting: VoiceCasting): string | undefined {
    const p = familyPreset(casting);
    if (!p || p.mode === 'reference') return;
    return p.speech.replace(/^Speak naturally and clearly\.\s*/, '').replace(/\s*Speak aloud naturally\.$/, '');
}
/** Tone and whispers remain line-local; shared reference families bypass Race/culture/sex recasting. */
export function familyDelivery(preset: FamilyPreset, segment: AudioSegment, age: string, tone = ''): {renderText:string;instruction:string} {
    if (segment.kind === 'narration') throw new Error('Narration cannot use a demon family performance.');
    if (preset.mode === 'reference' && !recordedMaturity(age)) age = '';
    if (segment.kind === 'speech') return {renderText:segment.text,instruction:[age,tone,preset.speech].filter(Boolean).join(' ')};
    return {renderText:segment.text,instruction:[age,tone,!preset.reviewVersion&&(preset.sex==='male'||preset.sex==='female')?`The reference speaker is ${preset.sex}.`:'',preset.reviewVersion?"Retain the reference speaker's vocal texture, accent and register.":"Retain the reference speaker's demonic vocal texture and register.",WHISPER_DIRECTION].filter(Boolean).join(' ')};
}
