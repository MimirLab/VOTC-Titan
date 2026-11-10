import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CultureSnapshot } from '../../shared/gameData/CultureSnapshot';
import { FaithSnapshot } from '../../shared/gameData/FaithSnapshot';
import { AuthoredConceptBank, AuthoredConceptUnavailable, ConceptDomain } from './authoredConceptBank';
import { EssentialConceptBank, EssentialConceptUnavailable } from './essentialConceptBank';
import { ConceptCompositionBank, ConceptComposition } from './conceptCompositionBank';
import { FaithRelationshipBank, FaithRelationshipUnavailable } from './faithRelationshipBank';
import { canonicalJsonStringify, sha256Hex } from '../promptWorkbench/canonicalJson';
import { cultureSourceId } from '../culture/cultureEvidence';

type Snapshot = CultureSnapshot | FaithSnapshot;
interface Passage { source: string; kind: string; text: string; required: boolean; subject?: string; contributors?: string[] }

/** Current composition selects meanings; no character, provider or campaign enters this bank. */
export class BackgroundIngredientBank {
    readonly authored: AuthoredConceptBank;
    readonly essential: EssentialConceptBank;
    readonly compositions: ConceptCompositionBank;
    readonly relationships: FaithRelationshipBank;
    private views = new WeakMap<Snapshot, { fingerprint: string; rows: ConceptComposition[] }>();

    constructor(assets: { authored: unknown; essential: unknown; compositions: unknown; relationships: unknown }) {
        this.relationships = new FaithRelationshipBank(assets.relationships);
        this.authored = new AuthoredConceptBank(assets.authored, (domain, snapshot) =>
            domain === 'faith' ? this.relationships.teachingContext(snapshot as FaithSnapshot) : []);
        this.essential = new EssentialConceptBank(assets.essential);
        this.compositions = new ConceptCompositionBank(assets.compositions);
    }

    /** Unknown meanings still have a durable encounter identity; generation holds before transport. */
    revision(domain: ConceptDomain, snapshot: Snapshot): string {
        try {
            const meanings = this.essential.resolve(domain, snapshot, this.authored);
            return sha256Hex(canonicalJsonStringify({ version: 1, domain,
                essential: this.essential.revision(domain, snapshot, this.authored),
                compositions: this.compositions.revision(domain, meanings),
                ...(domain === 'faith' && { relationships: this.relationships.resolve(snapshot as FaithSnapshot).revision }) }));
        } catch (error) {
            if (!(error instanceof AuthoredConceptUnavailable || error instanceof EssentialConceptUnavailable ||
                error instanceof FaithRelationshipUnavailable)) throw error;
            return sha256Hex(canonicalJsonStringify({ version: 1, domain, unavailable: error.name,
                ...('issues' in error ? { issues: error.issues } : { reason: error.message }) }));
        }
    }

    project(domain: 'culture', snapshot: CultureSnapshot): CultureSnapshot;
    project(domain: 'faith', snapshot: FaithSnapshot): FaithSnapshot;
    project(domain: ConceptDomain, snapshot: Snapshot): Snapshot {
        const meanings = this.essential.resolve(domain, snapshot, this.authored);
        const projected = domain === 'culture'
            ? this.essential.project('culture', snapshot as CultureSnapshot, this.authored)
            : this.relationships.project(this.essential.project('faith', snapshot as FaithSnapshot, this.authored));
        this.views.set(projected, { fingerprint: sha256Hex(canonicalJsonStringify(projected)),
            rows: this.compositions.resolve(domain, meanings) });
        return projected;
    }

    /** Bind complete authored unions before presentation; every source contributor survives. */
    combine<T extends Passage>(domain: ConceptDomain, snapshot: Snapshot, passages: T[]): T[] {
        const view = this.views.get(snapshot);
        if (!view) return passages;
        if (view.fingerprint !== sha256Hex(canonicalJsonStringify(snapshot))) throw new Error('Changed ingredient projection');
        let result = [...passages];
        for (const row of view.rows) {
            const sources = row.members.map(member => {
                const fact = snapshot.facts.find(f => f.key === member.key && f.kind === (domain === 'culture' ? 'tradition' : 'doctrine'));
                if (!fact) throw new Error('Missing ingredient contributor');
                return domain === 'culture' ? cultureSourceId(fact as any) : 'doctrine:' + fact.key;
            }).sort();
            const selected = sources.map(source => result.filter(p => p.source === source &&
                p.kind === (domain === 'culture' ? 'adopted custom' : 'current teaching')));
            if (selected.some(rows => rows.length !== 1)) throw new Error('Missing complete ingredient passage');
            const earliest = Math.min(...selected.map(rows => result.indexOf(rows[0])));
            const removed = new Set(selected.flat());
            const union = { ...selected[0][0], source: sources[0], text: row.text, contributors: sources,
                ...(domain === 'faith' && { subject: 'Core tenets / ' + row.members.map(member =>
                    snapshot.facts.find(f => f.key === member.key)!.name).join(' + ') }) };
            result = result.filter(p => !removed.has(p));
            result.splice(Math.min(earliest, result.length), 0, union);
        }
        return result;
    }
}

let bundled: BackgroundIngredientBank | undefined;
export function getBackgroundIngredients(): BackgroundIngredientBank {
    const directory = path.join(__dirname, '../../../public/backgroundConcepts/recipe');
    const read = (name: string) => JSON.parse(readFileSync(path.join(directory, name + '.json'), 'utf8'));
    return bundled ??= new BackgroundIngredientBank({ authored: read('authored'), essential: read('essential'),
        compositions: read('compositions'), relationships: read('relationships') });
}
export function ingredientRevision(domain: ConceptDomain, snapshot: Snapshot): string {
    return getBackgroundIngredients().revision(domain, snapshot);
}
export function ingredientView(domain: 'culture', snapshot: CultureSnapshot): CultureSnapshot;
export function ingredientView(domain: 'faith', snapshot: FaithSnapshot): FaithSnapshot;
export function ingredientView(domain: ConceptDomain, snapshot: Snapshot): Snapshot {
    const bank = getBackgroundIngredients();
    return domain === 'culture' ? bank.project('culture', snapshot as CultureSnapshot) : bank.project('faith', snapshot as FaithSnapshot);
}
export function ingredientInterpretations(domain: ConceptDomain, snapshot: Snapshot) {
    return getBackgroundIngredients().authored.generatorConcepts(domain, snapshot);
}
export function combineIngredientPassages<T extends Passage>(domain: ConceptDomain, snapshot: Snapshot, passages: T[]): T[] {
    return getBackgroundIngredients().combine(domain, snapshot, passages);
}
