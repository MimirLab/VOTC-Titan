import fs from 'node:fs';
import path from 'node:path';
import { FaithSnapshot } from '../../src/shared/gameData/FaithSnapshot';
import { ingredientView, ingredientRevision } from '../../src/main/background/backgroundIngredients';
import { faithReferenceLimits, passagePlan, renderExtraction } from '../../src/main/background/sourceReference';
import { canonicalJsonStringify, sha256Hex } from '../../src/main/promptWorkbench/canonicalJson';
import { getEncoding } from 'js-tiktoken';
import { buildFaithGenerationMessages, faithInput } from '../../src/main/faith/faithIdentity';

const sources = JSON.parse(fs.readFileSync(path.join(__dirname, '../culture/practice-sources.json'), 'utf8')).faithSnapshots;
function descendant(key: string): FaithSnapshot {
    const original: FaithSnapshot = structuredClone(sources[key]);
    const account = original.facts.find(f => f.kind === 'description' && f.key === 'faith')!;
    const religion = original.facts.find(f => f.kind === 'description' && f.key === 'religion')!;
    const worship = Object.fromEntries(original.facts.filter(f => f.kind === 'worship').map(f => [f.key, f.description]));
    original.facts.push({ kind:'description',key:'parent_faith',name:'',description:account.description,
        rules:canonicalJsonStringify({version:1,sourceFaithKey:key,sourceDefinitionHash:'a'.repeat(64),
            sourceReligionHash:sha256Hex(religion.description),sourceWorship:worship}) });
    account.description = 'A descendant community with its own account.';
    return original;
}
function crossRoot(current: string, parent: string): FaithSnapshot {
    const original: FaithSnapshot = structuredClone(sources[parent]);
    const currentFaith: FaithSnapshot = structuredClone(sources[current]);
    const account = original.facts.find(f => f.kind === 'description' && f.key === 'faith')!;
    const religion = original.facts.find(f => f.kind === 'description' && f.key === 'religion')!;
    currentFaith.facts.push({ kind:'description',key:'parent_faith',name:'',description:account.description,
        rules:canonicalJsonStringify({version:1,sourceFaithKey:parent,sourceDefinitionHash:'a'.repeat(64),
            sourceReligionHash:sha256Hex(religion.description),sourceWorship:Object.fromEntries(
                original.facts.filter(f => f.kind === 'worship').map(f => [f.key, f.description]))}) });
    return currentFaith;
}
function plan(snapshot: FaithSnapshot) { return passagePlan('faith', ingredientView('faith', snapshot)); }

test('a changed account retains a parent-specific perspective on an actually adopted tenet', () => {
    const snapshot = descendant('cult_of_hakkar');
    const view = ingredientView('faith', snapshot), passages = passagePlan('faith', view).passages;
    const inherited = passages.find(p => p.kind === 'inherited teaching perspective' && p.source === 'inherited:tenet_bloody_feast');
    expect(inherited?.text).toMatch(/originating faith/i);
    expect(inherited?.text).toMatch(/may reinterpret or reject/i);
    expect(inherited?.required).toBe(false);
    const encoder = getEncoding('cl100k_base');
    const unselected = renderExtraction('faith', view, { selections: [] },
        { maximumTokens: 500, countTokens: text => encoder.encode(text).length });
    expect(unselected.paragraph).not.toContain(inherited!.text);
    const result = renderExtraction('faith', view, { selections: [inherited!.id] },
        { maximumTokens: 500, countTokens: text => encoder.encode(text).length });
    expect(result.paragraph).toContain(inherited!.text);
    expect(result.paragraph).toContain('Current core tenets:');
    expect(result.paragraph).toContain('blood goes to the divine');
    expect(result.notes.find(n => n.text.includes(inherited!.text))?.sources)
        .toEqual(['description:parent_faith','doctrine:tenet_bloody_feast']);
});

test('no origin or no adopted tenet supplies no inherited tenet perspective', () => {
    const snapshot = descendant('cult_of_hakkar');
    const unrooted = { ...snapshot, facts: snapshot.facts.filter(f => f.key !== 'parent_faith') };
    expect(plan(unrooted).passages.some(p => p.kind === 'inherited teaching perspective')).toBe(false);
    const withoutFeast = { ...snapshot, facts: snapshot.facts.filter(f => !(f.kind === 'doctrine' && f.key === 'tenet_bloody_feast')) };
    expect(plan(withoutFeast).passages.some(p => p.source === 'inherited:tenet_bloody_feast')).toBe(false);
    const wrongOrigin = structuredClone(snapshot);
    const parent = wrongOrigin.facts.find(f => f.key === 'parent_faith')!;
    parent.rules = canonicalJsonStringify({ ...JSON.parse(parent.rules), sourceReligionHash: 'b'.repeat(64) });
    expect(plan(wrongOrigin).passages.some(p => p.kind === 'inherited teaching perspective')).toBe(false);
});

test('a current contradictory account remains primary and is not replaced by the inherited reading', () => {
    const snapshot = descendant('cult_of_hakkar');
    snapshot.facts.find(f => f.kind === 'description' && f.key === 'faith')!.description =
        'This descendant community rejects devotion to Hakkar.';
    const view = ingredientView('faith', snapshot), passages = passagePlan('faith', view).passages;
    expect(passages.find(p => p.kind === 'faith-specific account')?.text).toContain('rejects devotion to Hakkar');
    expect(passages.find(p => p.source === 'inherited:tenet_bloody_feast')?.text).toContain('may reinterpret or reject');
    const changed = descendant('cult_of_hakkar');
    changed.facts = changed.facts.filter(f => f.key !== 'parent_faith');
    expect(ingredientRevision('faith', snapshot)).not.toBe(ingredientRevision('faith', changed));
});

test('a long current account can fit one selected inherited perspective without changing ordinary budgets', () => {
    const snapshot = crossRoot('tuskarr_religion', 'earth_mother_worship');
    const view = ingredientView('faith', snapshot), encoder = getEncoding('cl100k_base');
    const countTokens = (text: string) => encoder.encode(text).length;
    const perspective = passagePlan('faith', view).passages.find(p => p.source === 'inherited:tenet_ancestor_worship');
    expect(perspective).toBeDefined();
    const oldBudget = renderExtraction('faith', view, { selections: [perspective!.id] }, { maximumTokens: 500, countTokens });
    expect(oldBudget.paragraph).not.toContain(perspective!.text);
    const limits = faithReferenceLimits(view, countTokens);
    expect(limits.maximumTokens).toBeGreaterThan(500);
    expect(limits.maximumTokens).toBeLessThanOrEqual(600);
    expect(buildFaithGenerationMessages(faithInput(snapshot, 'en'))[0].content)
        .toContain(limits.maximumWords + '-word');
    for (const option of passagePlan('faith', view).passages.filter(p => !p.required && p.kind !== 'inherited teaching perspective')) {
        const ordinarySelection = { selections: [option.id] };
        expect(renderExtraction('faith', view, ordinarySelection, { ...limits, countTokens }).paragraph)
            .toBe(renderExtraction('faith', view, ordinarySelection, { maximumTokens: 500, countTokens }).paragraph);
    }
    const selected = renderExtraction('faith', view, { selections: [perspective!.id] }, { ...limits, countTokens });
    expect(selected.paragraph).toContain(perspective!.text);
    expect(countTokens(selected.paragraph)).toBeLessThanOrEqual(limits.maximumTokens);
    const ordinary = ingredientView('faith', structuredClone(sources.tuskarr_religion));
    expect(faithReferenceLimits(ordinary, countTokens).maximumTokens).toBe(500);
});
