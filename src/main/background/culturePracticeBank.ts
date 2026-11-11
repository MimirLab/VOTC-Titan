import fs from 'node:fs';
import path from 'node:path';
import { CultureFact, CultureSnapshot } from '../../shared/gameData/CultureSnapshot';
import { parseCk3Script } from '../culture/ck3Script';
import { canonicalJsonStringify, sha256Hex } from '../promptWorkbench/canonicalJson';
import { conceptDefinitionHash } from './authoredConceptBank';

interface PracticeAnchor { key: string; definitionHash: string }
export interface CulturePracticeRule {
    id: string;
    cultureDefinitions: Record<string, string>;
    anchors: PracticeAnchor[];
    text: string;
    coveredReadingIds: string[];
    rationale: string;
}
export interface ResolvedCulturePractice { id: string; anchor: string; text: string; fact: CultureFact }
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/u.test(v);
const identifier = (v: unknown): v is string => typeof v === 'string' && /^[a-z][a-z0-9_]{0,199}$/u.test(v);

/** Authored interpretations require observed native lineage AND a current exact adopted custom. */
export class CulturePracticeBank {
    private rules: CulturePracticeRule[];
    constructor(value: unknown = { version: 1, rules: [] }) {
        const asset = value as { version: number; rules: CulturePracticeRule[] };
        if (!asset || Object.keys(asset).sort().join() !== 'rules,version' || asset.version !== 1 ||
            !Array.isArray(asset.rules) || asset.rules.length > 64) throw new Error('Invalid cultural practice bank');
        const ids = new Set<string>();
        this.rules = asset.rules.map(r => {
            if (!r || Object.keys(r).sort().join() !== 'anchors,coveredReadingIds,cultureDefinitions,id,rationale,text' ||
                !identifier(r.id) || ids.has(r.id) || !r.cultureDefinitions || Array.isArray(r.cultureDefinitions) ||
                !Object.keys(r.cultureDefinitions).length || Object.keys(r.cultureDefinitions).length > 16 ||
                Object.entries(r.cultureDefinitions).some(([k, v]) => !identifier(k) || !hash(v)) ||
                !Array.isArray(r.anchors) || !r.anchors.length || r.anchors.length > 16 ||
                new Set(r.anchors.map(a => a.key)).size !== r.anchors.length ||
                r.anchors.some(a => !a || Object.keys(a).sort().join() !== 'definitionHash,key' || !identifier(a.key) || !hash(a.definitionHash)) ||
                typeof r.text !== 'string' || !r.text.trim() || r.text.length > 1200 ||
                typeof r.rationale !== 'string' || !r.rationale.trim() || r.rationale.length > 6000 ||
                !Array.isArray(r.coveredReadingIds) || r.coveredReadingIds.length > 64 ||
                r.coveredReadingIds.some(id => !identifier(id)) || new Set(r.coveredReadingIds).size !== r.coveredReadingIds.length)
                throw new Error('Invalid cultural practice rule');
            ids.add(r.id);
            return structuredClone(r);
        });
    }
    private fact(rule: CulturePracticeRule, anchor: PracticeAnchor, cultures = Object.keys(rule.cultureDefinitions).sort()): CultureFact {
        return { kind: 'practice', key: rule.id + ':' + anchor.key, category: 'adopted_custom_interpretation', name: '', description: '',
            rules: canonicalJsonStringify({ version: 1, id: rule.id, anchor, cultures,
                sourceDefinitions: Object.fromEntries(cultures.map(k => [k, rule.cultureDefinitions[k]])) }) };
    }
    /** Source hashes qualify the native anchors; template membership never predicts live membership. */
    catalogueFacts(files: Map<string, string>, concepts: readonly CultureFact[]): CultureFact[] {
        const definitions = new Map<string, string>();
        for (const file of [...files.keys()].filter(f => f.startsWith('common/culture/cultures/')).sort())
            for (const entry of parseCk3Script(files.get(file)!)) if (entry.key && Array.isArray(entry.value))
                definitions.set(entry.key, sha256Hex(canonicalJsonStringify({ key: entry.key, definition: entry.value })));
        return this.rules.flatMap(rule => {
            const cultures = Object.keys(rule.cultureDefinitions).filter(k => definitions.get(k) === rule.cultureDefinitions[k]).sort();
            if (!cultures.length) return [];
            return rule.anchors.filter(a => concepts.some(f => f.kind === 'tradition' && f.key === a.key &&
                conceptDefinitionHash('culture', f) === a.definitionHash)).map(a => this.fact(rule, a, cultures));
        });
    }
    private match(fact: CultureFact): { rule: CulturePracticeRule; anchor: PracticeAnchor; cultures: string[] } | undefined {
        if (fact.kind !== 'practice') return;
        const rule = this.rules.find(r => r.anchors.some(a => fact.key === r.id + ':' + a.key));
        if (!rule) throw new Error('Unknown cultural practice evidence');
        const anchor = rule.anchors.find(a => fact.key === rule.id + ':' + a.key)!;
        let cultures: unknown;
        try { cultures = JSON.parse(fact.rules).cultures; } catch { throw new Error('Invalid cultural practice evidence'); }
        if (!Array.isArray(cultures) || !cultures.length || cultures.some(k => typeof k !== 'string' || !rule.cultureDefinitions[k]) ||
            new Set(cultures).size !== cultures.length ||
            canonicalJsonStringify(fact) !== canonicalJsonStringify(this.fact(rule, anchor, cultures)))
            throw new Error('Changed cultural practice evidence');
        return { rule, anchor, cultures };
    }
    /** Invoked inside culture scope. Native engine predicates; no saved flags or name matching. */
    capturePredicate(fact: CultureFact): string {
        const match = this.match(fact);
        if (!match) throw new Error('Missing cultural practice evidence');
        const lineage = match.cultures.map(k => `this = culture:${k} any_parent_culture_or_above = { this = culture:${k} }`).join(' ');
        return `OR = { ${lineage} } has_cultural_tradition = ${match.anchor.key}`;
    }
    resolve(snapshot: CultureSnapshot, covered: readonly string[] = []): ResolvedCulturePractice[] {
        const matches = snapshot.facts.filter(f => f.kind === 'practice').map(fact => ({ fact, ...this.match(fact)! }));
        // Captured true records cannot outlive the exact contributing custom in a snapshot/import.
        for (const m of matches) if (!snapshot.facts.some(f => f.kind === 'tradition' && f.key === m.anchor.key &&
            conceptDefinitionHash('culture', f) === m.anchor.definitionHash)) throw new Error('Cultural practice lost its adopted contributor');
        return this.rules.flatMap(rule => {
            if (rule.coveredReadingIds.some(id => covered.includes(id))) return [];
            const chosen = rule.anchors.map(a => matches.find(m => m.rule.id === rule.id && m.anchor.key === a.key)).find(Boolean);
            return chosen ? [{ id: rule.id, anchor: chosen.anchor.key, text: rule.text, fact: chosen.fact }] : [];
        });
    }
    context(snapshot: CultureSnapshot): readonly string[] { return this.resolve(snapshot).map(r => r.id); }
}

let bundled: CulturePracticeBank | undefined;
export function getCulturePracticeBank(): CulturePracticeBank {
    return bundled ??= new CulturePracticeBank(JSON.parse(fs.readFileSync(
        path.join(__dirname, '../../../public/backgroundConcepts/recipe/practices.json'), 'utf8')));
}
