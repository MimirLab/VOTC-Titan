import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CultureSnapshot } from '../../shared/gameData/CultureSnapshot';
import { canonicalJsonStringify } from '../promptWorkbench/canonicalJson';

interface Evidence { passageId: string; bodySha256: string }
interface RootOutlook {
    id: string;
    cultureDefinitions: Record<string, string>;
    coveredPracticeId: string;
    text: string;
    evidence: Evidence[];
}
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[a-z][a-z0-9_]{0,199}$/u.test(value);
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);

/** Concise ancestral outlooks, not proof that an inherited custom is still enacted. */
export class CulturalRootBank {
    private readonly roots: RootOutlook[];
    constructor(value: unknown) {
        const asset = value as { version: number; roots: RootOutlook[] };
        if (!asset || Object.keys(asset).sort().join() !== 'roots,version' || asset.version !== 1 ||
            !Array.isArray(asset.roots) || asset.roots.length > 4096) throw new Error('Invalid cultural root bank');
        const ids = new Set<string>();
        this.roots = asset.roots.map(root => {
            if (!root || Object.keys(root).sort().join() !== 'coveredPracticeId,cultureDefinitions,evidence,id,text' ||
                !identifier(root.id) || ids.has(root.id) || !identifier(root.coveredPracticeId) ||
                !root.cultureDefinitions || typeof root.cultureDefinitions !== 'object' || Array.isArray(root.cultureDefinitions) ||
                !Object.keys(root.cultureDefinitions).length || Object.keys(root.cultureDefinitions).length > 64 ||
                Object.entries(root.cultureDefinitions).some(([key, value]) => !identifier(key) || !digest(value)) ||
                typeof root.text !== 'string' || !root.text.trim() || root.text.length > 300 || /[\x00-\x1f]/u.test(root.text) ||
                !Array.isArray(root.evidence) || !root.evidence.length || root.evidence.length > 32 ||
                root.evidence.some(e => !e || Object.keys(e).sort().join() !== 'bodySha256,passageId' ||
                    typeof e.passageId !== 'string' || !e.passageId.trim() || e.passageId.length > 512 || !digest(e.bodySha256)))
                throw new Error('Invalid cultural root outlook');
            ids.add(root.id);
            return structuredClone(root);
        });
    }
    /** Only exact, observed source definitions qualify; a label or body does not. */
    resolve(snapshot: CultureSnapshot, coveredPracticeIds: readonly string[] = []): { id: string; text: string }[] {
        const lineages = snapshot.facts.filter(f => f.kind === 'lineage' && f.category === 'source_culture' && !f.name && !f.description);
        return this.roots.filter(root => !coveredPracticeIds.includes(root.coveredPracticeId) && lineages.some(f => {
            const expected = root.cultureDefinitions[f.key];
            return !!expected && f.rules === canonicalJsonStringify({ version: 1, sourceDefinitionHash: expected });
        })).map(root => ({ id: root.id, text: root.text }));
    }
}

let bundled: CulturalRootBank | undefined;
export function getCulturalRootBank(): CulturalRootBank {
    return bundled ??= new CulturalRootBank(JSON.parse(readFileSync(
        path.join(__dirname, '../../../public/backgroundConcepts/recipe/cultural-roots.json'), 'utf8')));
}
