import { createHash } from 'crypto';
import type { VoiceProfile } from '../../shared/audio';
import type { VoiceCasting } from './acousticCasting';

/** Reference treatment, not character allegiance, current culture or religion. */
export type UndeadCoverage = 'covered' | 'uncolored' | 'unknown' | 'specialized';
export interface UndeadFacts { undead: boolean; specialized: boolean }
export interface UndeadPerformance {
    version: 1; voiceId: string; treatment: 'damaged-throat' | 'preserve'; reason: string;
}
/** Player-selected in paired original-reference auditions, explicitly at CFG 2. */
export const UNDEAD_THROAT_DIRECTION = 'Speak through a damaged throat with a coarse, scraping rasp.';
// Reviewed against the r3.1 acoustic packet. These descriptions already contain
// grave-worn, spectral, skeletal, vampiric or drowned coloration.
const covered = new Set(['022','081','095','096','099','100','162','177','194']);
// Preserve explicitly material, elemental, void and demonic references. A generic
// corpse direction cannot describe these vocal mechanisms safely.
const specialized = new Set(['013','034','061','084','085','086','088','091','092','093',
    '154','155','156','157','160','164','166','182','185','189','191','195','198','199','200']);
export function castingUndeadCoverage(casting?: Pick<VoiceCasting,'anatomyId'>): UndeadCoverage {
    const id=casting?.anatomyId;
    return id ? covered.has(id) ? 'covered' : specialized.has(id) ? 'specialized' : 'uncolored' : 'unknown';
}
export function savedUndeadCoverage(profile:VoiceProfile):UndeadCoverage {
    if(profile.characterId==='__narrator__')return 'specialized';
    try {
        const p=JSON.parse(profile.provenance);
        const casting=castingUndeadCoverage(p.casting);
        if(p.origin!=='player'&&typeof p.casting?.anatomyCore==='string'&&profile.instruction.includes(p.casting.anatomyCore)&&
            (casting==='covered'||casting==='specialized'))return casting;
        // Only designs authored under the explicit state-neutral contract make
        // this claim. Old/custom descriptions must not be silently reclassified.
        if(p.origin!=='player'&&p.undead?.version===1&&p.undead.reference==='uncolored')return 'uncolored';
    }catch { /* Older and player-authored references remain protected. */ }
    return 'unknown';
}
/** Reject explicit corpse effects, without mistaking ordinary racial rasp or hollow resonance for undeath. */
export function undeadNeutralIndividual(instruction:string):boolean {
    return !/\b(?:undead|necrotic|ghostly|spectral|skeletal|cadaverous|corpse(?:[- ]like)?|grave[- ]worn|death[- ]rattle)\b/i.test(instruction);
}
export function decideUndeadPerformance(profile:VoiceProfile,facts:UndeadFacts|undefined,coverage:UndeadCoverage):UndeadPerformance {
    const reason=profile.characterId==='__narrator__'?'narrator':!facts?'no-current-physical-state':!facts.undead?'currently-living':
        coverage==='covered'?'reference-already-undead':coverage==='specialized'||facts.specialized?'specialized-voice':
        coverage==='unknown'?'reference-treatment-unknown':'uncolored-reference';
    return {version:1,voiceId:profile.id,treatment:reason==='uncolored-reference'?'damaged-throat':'preserve',reason};
}
export function validUndeadPerformance(value:unknown,voiceId?:string):value is UndeadPerformance {
    const p=value as UndeadPerformance|undefined;
    return !!p&&p.version===1&&typeof p.voiceId==='string'&&(!voiceId||p.voiceId===voiceId)&&
        ['damaged-throat','preserve'].includes(p.treatment)&&typeof p.reason==='string'&&p.reason.length<=80;
}
export function undeadDirection(performance:UndeadPerformance|undefined,thought=false):string {
    // Thought delivery appends its existing whisper instruction after this exact
    // physical direction. Do not substitute the rejected hollow/spectral prose.
    return performance?.treatment==='damaged-throat' ? UNDEAD_THROAT_DIRECTION : '';
}

// Native predicates inspected in GoA 0.6.5. Only definitions actually installed
// enter a probe. These exclusions describe current physical mechanisms, never
// Scourge/Forsaken membership, Northrend location, immortality or death magic.
const specialTraits=['creature_revenant','creature_abomination','creature_banshee','creature_ghoul','creature_lich',
    'creature_kvaldir','creature_vampire','creature_protector','creature_ancient_war','creature_ancient_lore','creature_ancient_wind',
    'creature_mechagnome','creature_watcher','creature_wickerman','creature_wicker_behemoth','creature_wicker_golem',
    'creature_nathrezim','creature_manari','creature_annihilan','creature_eredruin','creature_imp','creature_sayaadi',
    'creature_shivarra','creature_satyr','creature_observer','creature_voidwalker','creature_cthraxxi','creature_faceless',
    'creature_flamewaker','being_demon','being_void','being_order','metamorphosis','fallen_demon_hunter'];
export interface UndeadCaptureCatalog { digest:string; specialTraits:readonly string[] }
export function undeadCaptureCatalog(goa?:{digest:string;traitIds:readonly string[]}):UndeadCaptureCatalog|undefined {
    if(!goa?.traitIds.includes('being_undead'))return;
    const traits=specialTraits.filter(t=>goa.traitIds.includes(t)).sort();
    return {digest:createHash('sha256').update(JSON.stringify(['audio-undead-v1',goa.digest,traits])).digest('hex'),specialTraits:traits};
}
export function undeadCaptureBody(c:UndeadCaptureCatalog):string {
    if(!/^[a-f0-9]{64}$/.test(c.digest)||c.specialTraits.some(t=>!specialTraits.includes(t)))throw new Error('Invalid undead voice capture.');
    const tests=[['undead','has_trait = being_undead'],['specialized',c.specialTraits.length?`OR = { ${c.specialTraits.map(t=>`has_trait = ${t}`).join(' ')} }`:'always = no']];
    return `debug_log = "VOTC:UNDEAD/;/begin/;/${c.digest}/;/[THIS.Char.GetID]"\n`+
        tests.map(([name,test])=>`if = { limit = { ${test} } debug_log = "VOTC:UNDEAD/;/fact/;/${name}/;/1" }\n`+
            `else = { debug_log = "VOTC:UNDEAD/;/fact/;/${name}/;/0" }\n`).join('')+
        `debug_log = "VOTC:UNDEAD/;/end/;/${c.digest}/;/[THIS.Char.GetID]"\n`;
}
export class UndeadLogReader {
    private pending?:{id:number;facts:Map<string,boolean>;invalid:boolean};
    private observations=new Map<number,UndeadFacts>();
    constructor(readonly catalog:UndeadCaptureCatalog){}
    clear():void {this.pending=undefined;this.observations.clear();}
    take(id:number):UndeadFacts|undefined {const v=this.observations.get(id);this.observations.delete(id);return v;}
    observe(line:string):void {
        if(line.includes('VOTC:CAMPAIGN/;/loaded/;/')){this.clear();return;}
        const at=line.indexOf('VOTC:UNDEAD/;/');if(at<0)return;
        const [kind,...args]=line.slice(at+'VOTC:UNDEAD/;/'.length).trim().split('/;/');
        if(kind==='begin'){
            this.pending=undefined;
            if(!/^\d+$/.test(args[1]??'')||!Number.isSafeInteger(Number(args[1])))return;
            const id=Number(args[1]);this.observations.delete(id);
            if(args.length===2&&args[0]===this.catalog.digest)this.pending={id,facts:new Map(),invalid:false};
            return;
        }
        const p=this.pending;if(!p)return;
        if(kind==='fact'){
            if(args.length!==2||!['undead','specialized'].includes(args[0])||!['0','1'].includes(args[1])||p.facts.has(args[0]))p.invalid=true;
            else p.facts.set(args[0],args[1]==='1');
        }else if(kind==='end'){
            if(!p.invalid&&p.facts.size===2&&args.length===2&&args[0]===this.catalog.digest&&args[1]===String(p.id)){
                this.observations.set(p.id,Object.freeze({undead:p.facts.get('undead')!,specialized:p.facts.get('specialized')!}));
                while(this.observations.size>16)this.observations.delete(this.observations.keys().next().value!);
            }
            this.pending=undefined;
        }else p.invalid=true;
    }
}
