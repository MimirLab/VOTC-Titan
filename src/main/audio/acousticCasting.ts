import { demonFamily, demonDirection } from './demonVoices';
import { familyDesignDirection } from './familyPerformance';
import { createHash } from 'crypto';
import type { Character } from '../../shared/gameData/Character';
import type { GoaSnapshot } from '../../shared/gameData/GoaSnapshot';
import { getVerifiedGoaSnapshot } from '../goa/goaRuntime';
import { GoaRuleContext } from '../goa/goaRuleContext';
import { castingCatalogue } from './castingCatalog';
import { currentCastingCapture, getAcousticCulture } from './castingRuntime';
import type { UndeadFacts } from './undeadVoice';
import { tuskarrDirection } from './tuskarrVoice';

export interface CastingChoices { anatomyId?: string; presentation?: 'male' | 'female'; cultureId?: string }
export interface VoiceCasting { version: string; sourceSha256: string; anatomyId?: string; body?: string;
    presentation?: 'male' | 'female'; cultureId?: string; anatomyCore: string; cultureCore: string; formKey: string; explicit: boolean }
export function normalizeCastingChoices(value: unknown): CastingChoices {
    if (!value || typeof value !== 'object') throw new Error('Invalid character casting.');
    const data = value as CastingChoices, c = castingCatalogue();
    if (data.anatomyId !== undefined && data.anatomyId !== '' && !c.anatomy[data.anatomyId]) throw new Error('Unknown Race selection.');
    if (data.cultureId !== undefined && data.cultureId !== '' && !c.cultures[data.cultureId]) throw new Error('Unknown culture acoustic profile.');
    if (data.presentation !== undefined && !['male', 'female'].includes(data.presentation)) throw new Error('Unknown Sex selection. Choose Male or Female.');
    return { ...(data.anatomyId ? { anatomyId: data.anatomyId } : {}), ...(data.presentation ? { presentation: data.presentation } : {}),
        ...(data.cultureId !== undefined ? { cultureId: data.cultureId } : {}) };
}
export function resolveVoiceCasting(actor: Character, choices: CastingChoices = {}, established?: VoiceCasting,
    snapshot: GoaSnapshot | undefined = getVerifiedGoaSnapshot(actor)): VoiceCasting {
    const c = castingCatalogue(), context = snapshot ? new GoaRuleContext(snapshot) : undefined;
    const body = context?.body, presentation = choices.presentation ?? snapshot?.sex ?? actor.sex;
    let anatomyId = choices.anatomyId ?? (body ? c.races[body]?.default : undefined);
    if (!choices.anatomyId && context) {
        if (body === 'moknathal') anatomyId = '026';
        if (body === 'creature_dryad' && presentation === 'male') anatomyId = '053';
        if (body === 'creature_gnome' && context.has('irradiated')) anatomyId = '009';
        if (body === 'creature_human' && context.has('being_undead')) anatomyId = '022';
        if (body === 'creature_high_elf' && context.has('being_undead')) anatomyId = '162';
        else if (body === 'creature_high_elf' && context.has('being_void')) anatomyId = '195';
        else if (body === 'creature_high_elf' && context.has('being_demon') && !context.has('demon_hunter')) anatomyId = '166';
        else if (body === 'creature_high_elf' && context.has('blood_human')) anatomyId = '023';
        if (body === 'creature_night_elf' && context.has('blood_human')) anatomyId = '024';
        if (body === 'creature_human' && context.has('blood_high_elf') && !context.has('being_undead')) anatomyId = '023';
        if (body === 'creature_human' && context.has('blood_night_elf') && !context.has('being_undead')) anatomyId = '024';
        if (body === 'creature_orc' && context.has('blood_human')) anatomyId = '025';
    }
    let anatomyCore = '';
    if (anatomyId) {
        const entry = c.anatomy[anatomyId];
        if (!presentation) {
            if (entry.male && entry.male === entry.female) anatomyCore = entry.male;
            else throw new Error('This character needs an observed Sex. Select Male or Female in Audio.');
        } else {
            const core = entry[presentation];
            if (core === null) throw new Error('This Race has no voice profile for the selected Sex. Choose a compatible Race in Audio.');
            anatomyCore = anatomyId === '084' ? entry.male ?? core : core;
        }
    }
    // Learned accent persists with identity. Changing culture requires an explicit new audition/revision.
    const observed = choices.cultureId !== undefined || established ? undefined : getAcousticCulture(actor);
    if (!established && choices.cultureId === undefined && currentCastingCapture() && !observed)
        throw new Error('Current culture capture is not ready for voice casting. Reopen the encounter or select its accent in Audio.');
    const cultureId = choices.cultureId !== undefined ? choices.cultureId || undefined : established?.cultureId ?? observed?.cultureId;
    const cultureCore = cultureId ? c.cultures[cultureId] ?? '' : 'Use clear neutral English pronunciation. Do not infer a new named accent from culture names or faith.';
    // Match the Wildhammer women's audition without re-keying existing voices.
    // The generic dwarf route otherwise sends the longer Ironforge refinement.
    if (!choices.anatomyId && body === 'creature_dwarf' && presentation === 'female' && cultureId === 'wildhammer')
        anatomyCore = c.anatomy['003'].female ?? anatomyCore;
    return { version: c.version, sourceSha256: c.sourceSha256, ...(anatomyId ? { anatomyId } : {}), ...(body ? { body } : {}),
        ...(presentation ? { presentation } : {}), ...(cultureId ? { cultureId } : {}), anatomyCore, cultureCore,
        formKey: createHash('sha256').update(JSON.stringify([anatomyId ?? body ?? '', presentation ?? '', cultureId ?? ''])).digest('hex'),
        explicit: !!choices.anatomyId || !!choices.presentation || choices.cultureId !== undefined };
}
export function castingFromProvenance(provenance: string): VoiceCasting | undefined {
    try { const data = JSON.parse(provenance).casting; return data?.version && typeof data.formKey === 'string' ? data : undefined; }
    catch { return; }
}
/** Refresh only the audio-owned infusion fact. A new infusion alone keeps the
 * established reference; actual body changes and explicit Race choices retain
 * normal casting. Never alter the actor or the shared GoA snapshot. */
export function resolveUndeadVoiceCasting(actor:Character,choices:CastingChoices,established:VoiceCasting|undefined,
    snapshot:GoaSnapshot|undefined,facts:UndeadFacts|undefined):VoiceCasting {
    if(!snapshot||!facts)return resolveVoiceCasting(actor,choices,established,snapshot);
    const traits=snapshot.traitIds.filter(id=>id!=='being_undead');
    const base={...snapshot,traitIds:traits};
    const current=resolveVoiceCasting(actor,choices,established,facts.undead?{...base,traitIds:[...traits,'being_undead']}:base);
    if(facts.undead&&!facts.specialized&&!choices.anatomyId&&established){
        const living=resolveVoiceCasting(actor,choices,established,base);
        if(living.formKey===established.formKey&&living.body===established.body)return established;
    }
    return current;
}
/** Fixed casting is supplied directly, independently of the text model's bounded individual variation. */
export function composeVoiceDesign(casting: VoiceCasting, individual: string): string {
    const parts = [casting.anatomyCore, casting.cultureCore, individual, tuskarrDirection(casting), familyDesignDirection(casting) ?? demonDirection(demonFamily(casting))];
    if (casting.anatomyCore || casting.cultureCore) parts.push('Keep the specified anatomical resonance and learned pronunciation; individual differences remain within that casting.');
    const instruction = parts.filter(Boolean).join(' ');
    if (instruction.length > 2400) throw new Error('The individual voice description is too long for this casting brief. Retry with a concise voice design.');
    return instruction;
}
