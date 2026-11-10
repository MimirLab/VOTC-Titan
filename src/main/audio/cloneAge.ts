import { CHILD_DIRECTIONS, ChildhoodStage, MaturityStage, maturityFromAge, YOUTHFUL_DIRECTION } from './maturation';
/** A narrow performance exception: reference clones may sound older without recasting. */
export interface CloneAgingFacts { ageless: boolean; longLived: boolean }
export type CloneReferenceAge = 'adult' | 'older' | 'elderly';
export type CloneAgeBand = 'older' | 'elderly' | 'youthful-adult' | ChildhoodStage;
const directions: Record<CloneAgeBand,string> = {
    ...CHILD_DIRECTIONS,
    'youthful-adult': YOUTHFUL_DIRECTION,
    older: 'The same reference speaker, sounding older, with clear articulation and the same accent. Avoid exaggerated frailty.',
    elderly: 'The same reference speaker, sounding elderly, with clear articulation and the same accent. Avoid exaggerated frailty.'
};
export function cloneAgeBand(age: number | undefined, facts: CloneAgingFacts | undefined, maturity?: MaturityStage, referenceAge?: CloneReferenceAge): CloneAgeBand | undefined {
    const stage = maturity ?? maturityFromAge(age);
    if (stage && stage !== 'adult') return stage;
    if (!facts || facts.ageless !== false || facts.longLived !== false || !Number.isFinite(age) || age! < 55) return;
    return ageBeyondReference(age! < 70 ? 'older' : 'elderly', referenceAge);
}
/** Unknown/older source performances must not acquire the same age quality twice. */
export function ageBeyondReference(band:CloneAgeBand|undefined, baseline:CloneReferenceAge|undefined):CloneAgeBand|undefined {
    if(band!=='older'&&band!=='elderly')return band;
    const rank={adult:0,older:1,elderly:2};
    return baseline&&rank[band]>rank[baseline]?band:undefined;
}
export function cloneAgeInstruction(band?: CloneAgeBand): string { return band ? directions[band] : ''; }
/** Old plans contain ordinary age directions that clones ignored. Never reinterpret them. */
export function recordedCloneAge(direction: string): CloneAgeBand | undefined {
    return (Object.keys(directions) as CloneAgeBand[]).find(b => directions[b] === direction);
}
