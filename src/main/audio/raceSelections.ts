/** Exact player-selected methods for reviewed Race/Culture/Sex groups. */
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { app } from 'electron';
import type { FamilyPreset } from './familyPerformance';
import type { VoiceCasting } from './acousticCasting';
import type { VoiceProfile } from '../../shared/audio';
import type { UndeadCoverage } from './undeadVoice';
import { CloneBanks } from './CloneBanks';
import { BUNDLED_CLONES, bundledCloneCatalog } from './cloneCapture';

export interface RaceSelection extends FamilyPreset {
    reviewVersion: string;
    anatomyId: string;
    cultureId: string;
    notes?: string;
    active?: boolean;
    retirementReason?: string;
}
export function raceSelections(): readonly RaceSelection[] {
    const file=path.join(app.getAppPath(),'public/audio/race-selections/manifest.json');
    const data=JSON.parse(fs.readFileSync(file,'utf8'));
    if(data.version!==1 || data.canonicalClonesExcluded!==true || !Array.isArray(data.entries))
        throw new Error('The reviewed Race voice selections are incomplete. Reinstall the intact Audio assets.');
    const keys=new Set<string>();
    const policy=data.populationPolicy;
    if(policy && (policy.default!=='individual' || !Array.isArray(policy.referenceAnatomyIds)))
        throw new Error('Invalid population casting policy.');
    for(const p of data.entries){
        if(!p.key || keys.has(p.key) || !p.reviewVersion || !p.anatomyId || !p.cultureId ||
            !['male','female','shared'].includes(p.sex) || !['individual','reference'].includes(p.mode))
            throw new Error('Invalid reviewed Race voice selection.');
        keys.add(p.key);
        if(policy && p.active!==false && p.mode==='reference' && !policy.referenceAnatomyIds.includes(p.anatomyId))
            throw new Error('A shared Race reference is outside the selected population exceptions.');
    }
    return data.entries;
}

/** Only exact automatic routes explicitly retired by the population reset qualify.
 * Unknown references and player/canonical assignments are never inferred away.
 */
export function retiredPopulationReference(profile:VoiceProfile):RaceSelection|undefined {
    try {
        const saved=JSON.parse(profile.provenance);
        if(saved.origin!=='race-family-reference-v1')return;
        const p=raceReferenceByKey(saved.familyKey,saved.casting);
        return p?.active===false && p.retirementReason==='population-individual-reset' &&
            saved.familyVersion===p.reviewVersion ? p : undefined;
    }catch{return;}
}
export function raceSelectionMatches(p:RaceSelection,casting?:Partial<VoiceCasting>):boolean {
    return !!casting && p.anatomyId===casting.anatomyId && p.cultureId===casting.cultureId &&
        (p.sex==='shared'||p.sex===casting.presentation);
}
export function raceReferencePreset(casting?:Partial<VoiceCasting>):RaceSelection|undefined {
    if(!casting?.anatomyId||!casting.cultureId||!casting.presentation)return;
    return raceSelections().find(p=>p.mode==='reference' && (p as any).active!==false && raceSelectionMatches(p,casting));
}
export function raceReferenceByKey(key:string,casting?:Partial<VoiceCasting>):RaceSelection|undefined {
    if(!key.startsWith('race-review-')||!casting?.anatomyId||!casting.cultureId||!casting.presentation)return;
    return raceSelections().find(p=>p.mode==='reference' && p.key===key && raceSelectionMatches(p,casting));
}

/** Inherit only the reviewed state of the exact bundled source edition.
 * No actor-name, Race, culture, old prompt or adult-age inference is involved.
 */
export function reviewedRaceReferenceCoverage(profile:VoiceProfile):UndeadCoverage {
    try {
        const saved=JSON.parse(profile.provenance);
        if(saved.origin!=='race-family-reference-v1'||!profile.referenceFile||!profile.referenceText)return 'unknown';
        const preset=raceReferenceByKey(saved.familyKey,saved.casting),source=preset?.sourceBank;
        if(!preset||!source||preset.reviewVersion!==saved.familyVersion)return 'unknown';
        const entry=bundledCloneCatalog()?.profiles[source.key];
        if(!entry||entry.manifestHash!==source.manifestHash)return 'unknown';
        const bank=new CloneBanks(BUNDLED_CLONES).load(source.key);
        if(bank.manifestHash!==source.manifestHash||bank.audioHash!==preset.referenceSha256||bank.text.trim()!==profile.referenceText.trim())return 'unknown';
        const fd=fs.openSync(profile.referenceFile,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
        try {
            const stat=fs.fstatSync(fd);
            if(!stat.isFile()||stat.size!==bank.wav.length)return 'unknown';
            if(createHash('sha256').update(fs.readFileSync(fd)).digest('hex')!==bank.audioHash)return 'unknown';
        }finally{fs.closeSync(fd)}
        return entry.performanceFamily?'specialized':entry.undeadCoverage??'unknown';
    }catch{return 'unknown'}
}
