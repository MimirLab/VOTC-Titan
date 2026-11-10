import { projectedFaithRelationship } from './faithRelationshipBank';
// Current-faith anchors and independently observed vocabulary roles.
import { FaithSnapshot } from '../../shared/gameData/FaithSnapshot';
import { cleanMeaning } from './sourceMeanings';

const readable = (text: string) => !!text && !/context-dependent wording|unresolved|Get[A-Z]|\w_\w|\[/u.test(text);
export function faithCore(snapshot: FaithSnapshot) {
    const resolved = projectedFaithRelationship(snapshot);
    const relation = resolved?.account;
    const suppressed = relation && ['account', 'secular'].includes(relation.vocabulary);
    const roles: Record<string,string> = suppressed ? {} : relation ?
        relation.vocabulary === 'named' ? { CreatorName: 'Creation-associated term', HighGodName: 'Chief revered name' } :
        { CreatorName: 'Other primary sacred term', HighGodName: 'Sacred focus' } :
        { CreatorName: 'Creator term', HighGodName: 'High-god term' };
    const worship = snapshot.facts.filter(f => f.kind === 'worship' && roles[f.key])
        .map(f => ({ source: 'worship:' + f.key, text: cleanMeaning(f.description), role: roles[f.key] }))
        .filter(f => readable(f.text))
        .filter(f => !relation || f.source !== 'worship:CreatorName' || !snapshot.facts.some(other =>
            other.kind === 'worship' && other.key === 'HighGodName' && cleanMeaning(other.description) === f.text))
        .sort((a,b) => a.source.localeCompare(b.source,'en'));
    const tenets = snapshot.facts.filter(f => f.kind === 'doctrine').filter(f => {
        const rules = f.rules ? JSON.parse(f.rules) : {};
        return (rules.definitions || []).some((d:any) => d.key === 'group_rules' && Array.isArray(d.value) &&
            d.value.some((r:any) => r.key === 'category' && r.value === 'core_tenets'));
    }).map(f => ({ source: 'doctrine:' + f.key, name: cleanMeaning(f.name) }))
        .filter(f => readable(f.name)).sort((a,b) => a.source.localeCompare(b.source,'en'));
    const bySource = new Map(worship.map(term => [term.source, term]));
    for (const role of resolved?.vocabularyRoles ?? []) {
        const source = 'worship:' + role.key;
        bySource.set(source, { source, text: role.value, role: role.label });
    }
    return { worship: [...bySource.values()].sort((a,b) => a.source.localeCompare(b.source,'en')), tenets };
}
