import { StringDecoder } from 'string_decoder';
import { CultureFact, CultureSnapshot } from '../../shared/gameData/CultureSnapshot';
import { CultureCatalog } from './cultureCatalog';
import { sealCultureSnapshot } from './cultureEvidence';

export interface CultureObservation { characterId: number; cultureId: number; snapshot: CultureSnapshot }
interface Pending {
    characterId: number;
    cultureId: number;
    traditions: number;
    innovations: number;
    facts: Map<string, CultureFact>;
    started: number;
    invalid: boolean;
    practices: Set<string>;
}

/** Shared log framing handles records split across file reads, including split UTF-8 code points. */
export class LogLineFramer {
    private decoder = new StringDecoder('utf8');
    private remainder = '';
    push(bytes: Buffer, onLine: (line: string) => void): void {
        this.remainder += this.decoder.write(bytes);
        let newline: number;
        while ((newline = this.remainder.indexOf('\n')) !== -1) {
            const line = this.remainder.slice(0, newline).replace(/\r$/, '');
            this.remainder = this.remainder.slice(newline + 1);
            if (line) onLine(line);
        }
        if (this.remainder.length > 1_000_000) this.reset();
    }
    reset(): void { this.decoder = new StringDecoder('utf8'); this.remainder = ''; }
}

/** Atomic begin/facts/end protocol. An incomplete capture can never become a cache entry. */
export class CultureLogReader {
    private pending?: Pending;
    private lookup: Map<string, CultureFact>;
    constructor(private catalog: CultureCatalog, private now: () => number = Date.now, private onBegin?: (characterId?: number) => void) {
        this.lookup = new Map(catalog.facts.map(f => [`${f.kind}:${f.key}`, f]));
    }
    reset(): void { this.pending = undefined; }
    read(line: string): CultureObservation | undefined {
        const position = line.indexOf('VOTC:CULTURE/;/');
        if (position < 0) return;
        const fields = line.slice(position + 'VOTC:CULTURE/;/'.length).trim().split('/;/');
        const [command] = fields;
        if (command === 'begin') {
            this.reset();
            this.onBegin?.(/^\d+$/.test(fields[3] ?? '') ? Number(fields[3]) : undefined);
            if (fields.length !== 7 || fields[1] !== '2' || fields[2] !== this.catalog.digest ||
                fields.slice(3).some(v => !/^\d+$/.test(v))) return;
            const [characterId, cultureId, traditions, innovations] = fields.slice(3).map(Number);
            if (![characterId, cultureId, traditions, innovations].every(Number.isSafeInteger) ||
                traditions > 4096 || innovations > 4096) return;
            this.pending = { characterId, cultureId, traditions, innovations, facts: new Map(), practices: new Set(), started: this.now(), invalid: false };
            return;
        }
        const pending = this.pending;
        if (!pending || this.now() - pending.started > 30_000) { this.reset(); return; }
        if (command === 'fact') {
            const id = `${fields[1]}:${fields[2]}`;
            const fact = this.lookup.get(id);
            if (fields.length !== 3 || !fact || fact.kind === 'practice' || pending.facts.has(id)) pending.invalid = true;
            else pending.facts.set(id, fact);
        } else if (command === 'practice') {
            const fact = this.lookup.get('practice:' + fields[1]);
            if (fields.length !== 3 || !fact || !['0', '1'].includes(fields[2]) || pending.practices.has(fields[1])) pending.invalid = true;
            else {
                pending.practices.add(fields[1]);
                if (fields[2] === '1') pending.facts.set('practice:' + fact.key, fact);
            }
        } else if (command === 'support') {
            if (!['era', 'naming_order', 'primary_naming'].includes(fields[1]) || fields.length !== 3 || !fields[2] || fields[2].includes('[')) pending.invalid = true;
            else {
                const matching = fields[1] === 'era' ? this.catalog.eras.filter(f => f.name === fields[2] || f.key === fields[2]) : [];
                const fact: CultureFact = fields[1] !== 'era' ? {
                    kind: 'naming', key: `live:${fields[1]}`, category: fields[1], name: fields[2],
                    description: fields[1] === 'naming_order' ? 'Reported current naming style; do not infer an unprovided name order from the label.'
                        : 'Reported primary naming-list label; other captured lists remain available. This does not establish their full ordering.', rules: ''
                } : matching.length === 1 ? matching[0] : {
                    kind: 'era', key: 'current_era', category: '', name: fields[2], description: '', rules: ''
                };
                if (pending.facts.has(`${fact.kind}:${fact.key}`)) pending.invalid = true;
                pending.facts.set(`${fact.kind}:${fact.key}`, fact);
            }
        } else if (command === 'end') {
            this.reset();
            if (fields.length !== 4 || fields[1] !== this.catalog.digest || fields[2] !== String(pending.characterId) ||
                fields[3] !== String(pending.cultureId) || pending.invalid ||
                pending.practices.size !== this.catalog.facts.filter(f => f.kind === 'practice').length) return;
            const facts = [...pending.facts.values()];
            if (facts.filter(f => f.kind === 'tradition').length !== pending.traditions ||
                facts.filter(f => f.kind === 'innovation').length !== pending.innovations ||
                !facts.some(f => f.kind === 'naming' && !f.key.startsWith('live:')) || !facts.some(f => f.kind === 'era') ||
                !facts.some(f => f.key === 'live:naming_order') || !facts.some(f => f.key === 'live:primary_naming') ||
                this.catalog.pillarCategories.some(c => facts.filter(f => f.kind === 'pillar' && f.category === c).length !== 1)) return;
            try {
                return { characterId: pending.characterId, cultureId: pending.cultureId,
                    snapshot: sealCultureSnapshot(this.catalog, facts) };
            } catch { return; }
        } else pending.invalid = true;
    }
}
