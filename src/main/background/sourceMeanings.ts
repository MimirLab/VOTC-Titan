// Readable source projection; identity retains the complete observed snapshot.
import { CultureSnapshot } from '../../shared/gameData/CultureSnapshot';
import { FaithSnapshot } from '../../shared/gameData/FaithSnapshot';
import { containsReligiousSteering, projectCultureEvidence, cultureSourceId } from '../culture/cultureEvidence';
import { isAuthoredConceptReading } from './authoredConceptBank';
import { projectedFaithRelationship } from './faithRelationshipBank';

type Domain = 'culture' | 'faith';
interface Card { id: string; source: string; kind: string; readings: string[]; scope: string; required: boolean }
interface Plan { cards: Card[]; omitted: { source: string; reason: string }[] }
export function cleanMeaning(text = ''): string {
    return text.replace(/\x15(?:ONCLICK|TOOLTIP):[^\s\x15]+\s*/gu, '')
        .replace(/\x15[A-Za-z0-9_]+;\s*/gu, '').replace(/\x15[!x]?/gu, '')
        .replace(/\bA nexus of [^.!?;]+ scholarship,\s*/iu, 'Drawing on scholarship from varied sources, ')
        .replace(/\s+/gu, ' ').trim();
}
const readable = (s: string) => !!s && !/context-dependent wording|unresolved|Get[A-Z]|\x15/u.test(s);
const technical = /\b(?:interaction|decision|modifier|cooldowns?|experience points|perks?)\b|\b(?:strong|weak) hooks?\b|\b(?:opinion|prowess|prestige|piety|tax|levies) (?:bonus|gain|cost|points|levels)\b/iu;

export function meaningPlan(domain: Domain, snapshot: CultureSnapshot | FaithSnapshot): Plan {
    const cards: Card[] = [], omitted: Plan['omitted'] = [];
    const add = (source: string, kind: string, readings: string[], scope: string, required = false) => {
        const usable = [...new Set(readings.map(cleanMeaning).filter(s => readable(s) &&
            (domain !== 'culture' || !containsReligiousSteering(s))))];
        if (!usable.length) { omitted.push({ source, reason: 'No unambiguous readable meaning' }); return; }
        cards.push({ id: '', source, kind, readings: usable, scope, required });
    };
    if (domain === 'culture') {
        const e = projectCultureEvidence(snapshot as CultureSnapshot) as any;
        for (const f of e.adoptedPillarsAndTraditions) {
            if (f.conditionalDescriptions && Object.keys(f.conditionalDescriptions).length) {
                omitted.push({source: f.source, reason: 'Unresolved conditional description; retain in hash, not an unconditional custom'});
                continue;
            }
            const option = e.supportingContext.culturalOptions.find((p: any) => p.source === f.source);
            const permissions = (option?.options || []).filter((p: any) => p.value === true &&
                readable(cleanMeaning(p.meaning)) && !technical.test(p.meaning)).map((p: any) => 'Available option, not proof of enactment: ' + p.meaning + '.');
            const customs = (f.culturalCustoms || []).filter((p: any) => p.value === true &&
                readable(cleanMeaning(p.meaning)) && !technical.test(p.meaning)).map((p: any) => p.meaning + '.');
            const inheritance = permissions.some((s: string) => /inheritance|gender.*law/iu.test(s));
            const authored = (snapshot as CultureSnapshot).facts.find(fact =>
                cultureSourceId(fact) === f.source && isAuthoredConceptReading(fact));
            const description = authored ? authored.description : f.category === 'martial_custom' ? f.description :
                (f.description && !technical.test(f.description) ? f.description : '');
            add(f.source, f.category === 'martial_custom' ? 'martial expectation' : f.category === 'ethos' ? 'social ideal' : 'adopted custom',
                [description || '', ...customs, ...permissions],
                'Shared cultural expectation or familiar custom, not this person\'s disposition, body, occupation or compliance. Options retain their limits.',
                f.category === 'martial_custom' || f.category === 'ethos' || inheritance);
        }
        for (const f of e.courtIdeals) add(f.source, 'associated court ideal',
            [(f.description || '').replace(/\s+Courtiers gain [^.]*traits\.?\s*$/u, '')],
            'A culturally associated social ideal valued beyond court scenes; not proof of a present court type, setting or occupant.');
        // Retain clearly worded trait esteem, without numerical effects or inferring the opposite.
        for (const f of e.socialTraitConsequences) {
            const effects = (f.effects || []).filter((x: any) => !x.rules && typeof x.affected === 'string' &&
                /public esteem|family renown/iu.test(x.affected) && ['increased','decreased'].includes(x.direction));
            if (readable(cleanMeaning(f.name)) && effects.length) add(f.source, 'social esteem',
                effects.map((x: any) => f.name + ' carries ' + (x.direction === 'increased' ? 'more' : 'less') + ' ' + x.affected + '.'),
                'Valuation of this supplied disposition, not possession, personal guilt, its opposite or unconditional approval in every circumstance.');
        }
        // Naming, graphics, innovations and representative-selection are retained in identity.
        // They cannot independently establish a current social practice in this generator.
        for (const f of (snapshot as CultureSnapshot).facts.filter(f => ['innovation','naming','aesthetic','era'].includes(f.kind)))
            omitted.push({source: f.kind + ':' + f.key, reason: 'Supporting identity/capability; no standalone adopted social meaning'});
    } else {
        const facts = (snapshot as FaithSnapshot).facts;
        for (const key of ['faith','religion']) {
            const f = facts.find(f => f.kind === 'description' && f.key === key);
            if (f) add('description:' + key, key === 'faith' ? 'faith-specific account' : 'broader religious heritage', [f.description],
                key === 'faith' ? 'This faith\'s account and teachings; retain subjects and negation. A founder of an empire is not necessarily founder of the religion.' :
                    'Broader roots contextualize this faith; current observed teachings and classifications take precedence over inherited defaults.', !!f.description.trim());
        }
        const parent = projectedFaithRelationship(snapshot as FaithSnapshot)?.parent;
        if (parent) add('description:parent_faith', 'originating faith account', [parent.text],
            'An originating faith account provides inherited context; current teachings take precedence, and present rituals and personal adherence are not established.', true);
        const morals = facts.filter(f => ['virtue','sin'].includes(f.kind)).sort((a,b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
        if (morals.length) add('description:effective_morality', 'current religious valuations',
            ['Esteemed dispositions: ' + morals.filter(f => f.kind === 'virtue').map(f => (f.name || f.key).replace(/_/gu, ' ')).join(', ') + '.',
             'Condemned dispositions: ' + morals.filter(f => f.kind === 'sin').map(f => (f.name || f.key).replace(/_/gu, ' ')).join(', ') + '.'],
            'Only these current classifications are authoritative. An unlisted trait has neither status. These are recognized teachings, not anyone\'s traits, automatic guilt or compliance.', true);
        for (const f of facts.filter(f => f.kind === 'doctrine')) {
            const rules = f.rules ? JSON.parse(f.rules) : {};
            const group = rules.definitions?.find((d: any) => d.key === 'doctrine_group')?.value;
            let readings = [f.description], required = false;
            if (group === 'doctrine_clerical_gender') {
                const parameters = rules.definitions?.find((d: any) => d.key === 'parameters')?.value;
                readings = (Array.isArray(parameters) ? parameters : []).filter((p: any) => p.value === 'yes')
                    .map((p: any) => rules.meanings?.['doctrine_parameter_' + p.key]).filter((s: unknown) => typeof s === 'string');
                required = true;
            }
            add('doctrine:' + f.key, group === 'doctrine_clerical_gender' ? 'religious office eligibility' : 'current teaching', readings,
                'A religious teaching, with its actual subject and qualifications. It does not establish realm laws, everyone\'s personal gender attitudes, present rituals, powers or cosmic truth.', required);
        }
        for (const f of facts.filter(f => f.kind === 'worship')) {
            if (/Possessive|Genitive|Accusative|Objective|Subjective|Locative|Pronoun|SheHe|HerHis|HerHim|HerselfHimself|HasHave|MotherFather|MistressMaster/u.test(f.key) ||
                /\d$/u.test(f.key) && facts.some(other => other.kind === 'worship' &&
                    other.key === f.key.replace(/\d+$/u, '') && other.description === f.description)) {
                omitted.push({source:'worship:'+f.key,reason:'Grammatical variant; retained in identity'}); continue;
            }
            const role = f.key.replace(/([a-z])([A-Z])/gu,'$1 $2').replace(/_/gu,' ');
            add('worship:' + f.key, 'religious vocabulary', [role + ': ' + f.description],
                'Supplied worship term and its role; not personal devotion, a present rite, a new myth, an enacted office rule or supernatural proof.');
        }
        for (const f of facts.filter(f => f.kind === 'holy_site')) {
            // Modifier-only benefits cannot become unconditional supernatural claims.
            if (readable(cleanMeaning(f.description))) add('holy_site:' + f.key, 'recognized sacred site', [f.description],
                'Recognition only. Conditional site benefits require current control and their actual conditions; neither attendance nor benefits are established here.');
            else omitted.push({source: 'holy_site:' + f.key, reason: 'No readable site meaning beyond conditional mechanics'});
        }
    }
    cards.sort((a,b) => a.source < b.source ? -1 : a.source > b.source ? 1 : 0);
    cards.forEach((c,i) => { c.id = (domain === 'culture' ? 'C' : 'F') + String(i+1).padStart(3,'0'); });
    return {cards, omitted};
}
