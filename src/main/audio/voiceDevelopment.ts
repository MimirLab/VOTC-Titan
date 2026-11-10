import { createHash } from 'crypto';
import type { Character } from '../../shared/gameData/Character';
import type { VoiceProfile } from '../../shared/audio';
import type { VoiceTrait } from './maturation';

export interface VoiceDevelopment {
    phase:'provisional'|'adult'; personalityHash:string; style:string; adultVoiceId?:string;
}
export interface DevelopmentDesign {
    phase:VoiceDevelopment['phase']; traits:readonly VoiceTrait[]; originalVoiceId?:string;
}
/** Only automatic individual designs participate. Explicit player voices and clones remain theirs. */
export function automaticIndividual(profile:VoiceProfile):boolean {
    try { const p=JSON.parse(profile.provenance);return p.version===2&&p.origin!=='player'&&typeof p.model==='string'&&typeof p.inputHash==='string'&&typeof p.individual==='string'; }
    catch { return false; }
}
export function observedVoiceTraits(actor:Character):readonly VoiceTrait[] {
    return (actor.traits??[]).flatMap(t=>{
        const category=t.category?.toLowerCase();
        const kind=['personality trait','personality','性格特质'].includes(category)?'personality':
            ['childhood trait','childhood','童年特质','童年特質'].includes(category)?'childhood':undefined;
        return kind&&t.name?.trim()?[{category:kind as VoiceTrait['category'],name:t.name.trim()}]:[];
    });
}
export function personalityHash(traits:readonly VoiceTrait[]):string {
    return createHash('sha256').update(JSON.stringify([...new Set(traits.map(t=>t.category+':'+t.name))].sort())).digest('hex');
}
export function designDevelopment(profile:VoiceProfile):DevelopmentDesign|undefined {
    try {const p=JSON.parse(profile.provenance).development;return p?.version===1&&['provisional','adult'].includes(p.phase)&&Array.isArray(p.traits)?p:undefined;}
    catch{return;}
}
/** Concise directions, never replacement text or an instruction paragraph to recite. */
export function validVoiceStyle(value:unknown):value is string {
    return typeof value==='string'&&value.length<=300&&!/[<>\r\n]/.test(value);
}
