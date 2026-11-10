import { createHash } from 'crypto';
export const MATURATION_DIGEST = createHash('sha256').update('votc-audio-maturity-v2:is_adult;youthful20;adolescent13;childhood_education_start_age;native-personality-sections').digest('hex');
export type MaturityStage = 'young-child' | 'child' | 'adolescent' | 'youthful-adult' | 'adult';
export type ChildhoodStage = Exclude<MaturityStage,'adult'|'youthful-adult'>;
export interface VoiceTrait { category:'personality'|'childhood'; name:string }
export interface MaturityFrame { stage:MaturityStage; traits:readonly VoiceTrait[] }
export const YOUTHFUL_DIRECTION = 'The same adult speaker, sounding youthful and still settling into their adult voice, with clear articulation and the same accent.';
export function isAdultMaturity(stage?:MaturityStage):boolean { return stage==='adult'||stage==='youthful-adult'; }
export function isMaturityStage(value: unknown): value is MaturityStage {
    return typeof value === 'string' && ['young-child','child','adolescent','youthful-adult','adult'].includes(value);
}
/** Fallback for offline/unconfigured callers; live playback uses CK3's participant frame. */
export function maturityFromAge(age: number | undefined): MaturityStage | undefined {
    if (!Number.isFinite(age) || age! < 0) return;
    return age! < 6 ? 'young-child' : age! < 13 ? 'child' : age! < 16 ? 'adolescent' : age! < 20 ? 'youthful-adult' : 'adult';
}
export const CHILD_DIRECTIONS: Readonly<Record<ChildhoodStage,string>> = Object.freeze({
    'young-child': "The same character as a very young child, with a small child's voice, clear words and the same accent.",
    child: 'The same character as a child, with a natural child voice, clear words and the same accent.',
    adolescent: 'The same character as an adolescent, with a youthful maturing voice, clear words and the same accent.'
});
export function childhoodDirection(stage?: MaturityStage): string {
    return stage && !isAdultMaturity(stage) ? CHILD_DIRECTIONS[stage as ChildhoodStage] : '';
}
export function maturityDirection(stage?:MaturityStage):string { return stage==='youthful-adult'?YOUTHFUL_DIRECTION:childhoodDirection(stage); }
export function recordedMaturity(direction:string):MaturityStage|undefined { return direction===YOUTHFUL_DIRECTION?'youthful-adult':recordedChildhood(direction); }
export function recordedChildhood(direction:string): ChildhoodStage|undefined {
    return (Object.keys(CHILD_DIRECTIONS) as ChildhoodStage[]).find(stage=>CHILD_DIRECTIONS[stage]===direction);
}
/** Runs only in an already exported participant scope. No world scans or game mutation. */
export function maturationCaptureBody(): string {
    return `debug_log = "VOTC:MATURITY/;/begin/;/${MATURATION_DIGEST}/;/[THIS.Char.GetID]"\n` +
        `if = { limit = { is_adult = yes }\n` +
        `if = { limit = { age < 20 } debug_log = "VOTC:MATURITY/;/stage/;/youthful-adult" }\n` +
        `else = { debug_log = "VOTC:MATURITY/;/stage/;/adult" } }\n` +
        `else_if = { limit = { age >= 13 } debug_log = "VOTC:MATURITY/;/stage/;/adolescent" }\n` +
        `else_if = { limit = { age >= childhood_education_start_age } debug_log = "VOTC:MATURITY/;/stage/;/child" }\n` +
        `else = { debug_log = "VOTC:MATURITY/;/stage/;/young-child" }\n` +
        ['personality','childhood'].map(category=>`debug_log = "VOTC:MATURITY/;/traits_begin/;/${category}"\n`+
            `every_character_trait = { limit = { has_trait_category = ${category} }\n`+
            `debug_log = "VOTC:MATURITY/;/trait/;/${category}/;/[THIS.Trait.GetNameNoTooltip(PREV.Char)]" }\n`+
            `debug_log = "VOTC:MATURITY/;/traits_end/;/${category}"\n`).join('') +
        `debug_log = "VOTC:MATURITY/;/end/;/${MATURATION_DIGEST}/;/[THIS.Char.GetID]"\n`;
}
export class MaturationLogReader {
    private pending?: { id:number; stage?:MaturityStage; invalid:boolean; section?:string; completed:Set<string>; traits:VoiceTrait[] };
    private observations = new Map<number,MaturityFrame>();
    constructor(private requireTraits=false) {}
    clear(): void { this.pending = undefined; this.observations.clear(); }
    take(id:number): MaturityStage | undefined { return this.takeFrame(id)?.stage; }
    takeFrame(id:number):MaturityFrame|undefined { const value=this.observations.get(id);this.observations.delete(id);return value; }
    observe(line:string): void {
        if (line.includes('VOTC:CAMPAIGN/;/loaded/;/')) { this.clear(); return; }
        const marker=line.indexOf('VOTC:MATURITY/;/');if(marker<0)return;
        const [kind,...args]=line.slice(marker+'VOTC:MATURITY/;/'.length).trim().split('/;/');
        if(kind==='begin'){
            this.pending=undefined;
            if(!/^\d+$/.test(args[1]??'')||!Number.isSafeInteger(Number(args[1])))return;
            const id=Number(args[1]);this.observations.delete(id);
            if(args.length===2&&args[0]===MATURATION_DIGEST)this.pending={id,invalid:false,completed:new Set(),traits:[]};
            return;
        }
        const p=this.pending;if(!p)return;
        if(kind==='stage'){
            if(args.length!==1||!isMaturityStage(args[0])||p.stage)p.invalid=true;
            else p.stage=args[0];
        }else if(kind==='traits_begin'){
            if(args.length!==1||!['personality','childhood'].includes(args[0])||p.section||p.completed.has(args[0]))p.invalid=true;
            else p.section=args[0];
        }else if(kind==='trait'){
            if(args.length!==2||args[0]!==p.section||!args[1]?.trim()||args[1].length>120||p.traits.length>=16||p.traits.some(t=>t.category===args[0]&&t.name===args[1]))p.invalid=true;
            else p.traits.push({category:args[0] as VoiceTrait['category'],name:args[1]});
        }else if(kind==='traits_end'){
            if(args.length!==1||args[0]!==p.section)p.invalid=true;
            else {p.completed.add(args[0]);p.section=undefined;}
        }else if(kind==='end'){
            if(!p.invalid&&!p.section&&(!this.requireTraits||p.completed.size===2)&&p.stage&&args.length===2&&args[0]===MATURATION_DIGEST&&args[1]===String(p.id)){
                this.observations.set(p.id,Object.freeze({stage:p.stage,traits:Object.freeze(p.traits.map(t=>Object.freeze(t)))}));
                while(this.observations.size>16)this.observations.delete(this.observations.keys().next().value!);
            }
            this.pending=undefined;
        }else p.invalid=true;
    }
}
