import { FaithFact, FaithSnapshot, FaithLiveContext, validateFaithSnapshot, validateFaithLiveContext } from '../../shared/gameData/FaithSnapshot';
import { FaithCatalog } from './faithCatalog';
import { canonicalJsonStringify } from '../promptWorkbench/canonicalJson';

export interface FaithObservation {
    characterId: number; faithId: number; snapshot: FaithSnapshot; liveContext: FaithLiveContext;
    /** Observed possession of the canonical CK3 trait, independent of localized labels and faith identity. */
    characterZealous?: boolean;
}
export interface FaithCapture {
    religion: string; doctrines: string[]; virtues: string[]; sins: string[]; holySites: string[];
    texts: Record<string, string>;
}
const normalizeText = (value: string): string => value.replace(/#(?:[A-Za-z_][A-Za-z_0-9]*|!)\s?/g, '')
    .replace(/@[^!\s]+!/g, '').replace(/\s+/gu, ' ').trim();

export function sealFaithSnapshot(catalog: FaithCatalog, capture: FaithCapture): FaithSnapshot {
    const religion = catalog.religions.find(r => r.key === capture.religion);
    const family = catalog.families.find(f => f.key === religion?.family);
    if (!religion || !family || capture.texts.faith_description === undefined || capture.texts.religion_description === undefined)
        throw new Error('Incomplete religious hierarchy');
    const facts: FaithFact[] = [religion.fact, family,
        { kind: 'description', key: 'faith', name: '', description: normalizeText(capture.texts.faith_description), rules: '' },
        { kind: 'description', key: 'religion', name: '', description: normalizeText(capture.texts.religion_description), rules: '' },
        { kind: 'description', key: 'effective_morality', name: '', description: 'Completed current faith-wide moral census, independent of any particular character.',
            rules: canonicalJsonStringify({ virtues: [...capture.virtues].sort(), sins: [...capture.sins].sort(),
                interpretation: 'Only these observed traits currently have these faith valuations. An unlisted known trait has neither classification. Parent and doctrine trait definitions do not override this census.' }) }];
    for (const key of capture.doctrines) {
        const f = catalog.doctrines.find(d => d.key === key);
        if (!f) throw new Error('Unknown current doctrine');
        facts.push(f);
    }
    for (const kind of ['virtue', 'sin'] as const) for (const key of capture[kind === 'virtue' ? 'virtues' : 'sins']) {
        const f = catalog.traits.find(t => t.key === key);
        if (!f) throw new Error('Unknown moral trait');
        facts.push({ ...f, kind, rules: canonicalJsonStringify({ observedClassification: kind,
            supportingTraitRules: f.rules, meaning: "This faith's valuation of this trait, not possession or personal compliance." }) });
    }
    for (const key of capture.holySites) {
        const site = catalog.holySites.find(s => s.key === key);
        if (!site) throw new Error('Unknown sacred location');
        const aliases = catalog.holySites.filter(s => (s.barony ?? s.county) === (site.barony ?? site.county));
        // CK3's verified membership trigger identifies a location, not a unique aliased holy-site definition.
        if (aliases.length === 1) facts.push(site.fact);
        else if (!facts.some(f => f.kind === 'holy_site' && f.key === 'location:' + (site.barony ?? site.county))) {
            facts.push({ kind: 'holy_site', key: 'location:' + (site.barony ?? site.county), name: site.barony ?? site.county,
                description: 'Observed sacred location. Multiple definitions share it; its precise religious meanings and bonuses are unresolved.',
                rules: canonicalJsonStringify({ ambiguousDefinitions: aliases.map(s => s.fact),
                    interpretation: 'Do not select or assert any individual candidate meaning or bonus.' }) });
        }
    }
    for (const key of catalog.worshipKeys) {
        const current = capture.texts['worship:' + key];
        if (current === undefined) throw new Error('Incomplete worship capture');
        const text = normalizeText(current);
        if (!text || text === key || text.includes('[')) continue; // Unavailable getters are unknown, never defaults substituted by name.
        const matching = religion.worship[key]?.filter(variants => variants.includes(text)) ?? [];
        const alternatives = [...new Set(matching.flat())].sort();
        facts.push({ kind: 'worship', key, name: key,
            description: alternatives.length ? alternatives.join('; ') : text,
            rules: canonicalJsonStringify({ alternatives: alternatives.length ? alternatives : [text],
                interpretation: 'Faith vocabulary; alternatives are familiar possibilities, not personal practices.' }) });
    }
    return validateFaithSnapshot({ version: 1, complete: true, facts });
}

interface Pending {
    characterId: number; faithId: number; started: number; invalid: boolean;
    capture: FaithCapture; seen: Set<string>; censuses: Set<string>; live: FaithLiveContext;
    text?: { key: string; lines: string[]; length: number };
    characterZealous?: boolean;
}
/** Atomic census + bounded multiline fields. An incomplete transaction never schedules a profile. */
export class FaithLogReader {
    private pending?: Pending;
    constructor(private catalog: FaithCatalog, private now: () => number = Date.now, private onBegin?: (id?: number) => void) {}
    reset(): void { this.pending = undefined; }
    read(line: string): FaithObservation | undefined {
        const position = line.indexOf('VOTC:FAITH/;/');
        const record = position >= 0 ? line.slice(position + 'VOTC:FAITH/;/'.length).trim() : undefined;
        const pending = this.pending;
        if (pending && this.now() - pending.started > 30_000) this.reset();
        const active = this.pending;
        if (active?.text) {
            const end = 'text_end/;/' + this.catalog.digest + '/;/' + active.characterId + '/;/' + active.faithId + '/;/' + active.text.key;
            if (record === end) {
                active.capture.texts[active.text.key] = active.text.lines.join('\n');
                active.text = undefined;
            } else {
                active.text.length += line.length;
                if (active.text.length > 65536) { this.reset(); return; }
                // The initial text prefix is consumed here; separators inside the content are ordinary data.
                active.text.lines.push(record?.startsWith('text/;/') ? record.slice(7) : line);
            }
            return;
        }
        if (record === undefined) return;
        const fields = record.split('/;/');
        if (fields[0] === 'begin') {
            this.reset();
            this.onBegin?.(/^\d+$/.test(fields[3] ?? '') ? Number(fields[3]) : undefined);
            if (fields.length !== 5 || fields[1] !== '1' || fields[2] !== this.catalog.digest ||
                fields.slice(3).some(v => !/^\d+$/.test(v) || !Number.isSafeInteger(Number(v)))) return;
            this.pending = { characterId: Number(fields[3]), faithId: Number(fields[4]), started: this.now(), invalid: false,
                capture: { religion: '', doctrines: [], virtues: [], sins: [], holySites: [], texts: {} },
                seen: new Set(), censuses: new Set(), live: {} };
            return;
        }
        if (!active) return;
        const duplicate = (id: string): boolean => {
            if (active.seen.has(id)) { active.invalid = true; return true; }
            active.seen.add(id); return false;
        };
        if (fields[0] === 'fact') {
            if (fields.length !== 3 || duplicate(fields[1] + ':' + fields[2])) { active.invalid = true; return; }
            const key = fields[2];
            if (fields[1] === 'religion' && this.catalog.religions.some(r => r.key === key) && !active.capture.religion)
                active.capture.religion = key;
            else if (fields[1] === 'doctrine' && this.catalog.doctrines.some(d => d.key === key)) active.capture.doctrines.push(key);
            else if (['virtue', 'sin'].includes(fields[1]) && this.catalog.traits.some(t => t.key === key))
                active.capture[fields[1] === 'virtue' ? 'virtues' : 'sins'].push(key);
            else if (fields[1] === 'holy_site' && this.catalog.holySites.some(s => s.key === key)) active.capture.holySites.push(key);
            else active.invalid = true;
        } else if (fields[0] === 'personal') {
            if (fields.length !== 3 || fields[1] !== 'zealous' || !['yes', 'no'].includes(fields[2]) ||
                !this.catalog.traits.some(t => t.key === 'zealous') || duplicate('personal:zealous')) active.invalid = true;
            else active.characterZealous = fields[2] === 'yes';
        } else if (fields[0] === 'census') {
            const counts: Record<string, number> = { religion: this.catalog.religions.length, doctrine: this.catalog.doctrines.length,
                virtue: this.catalog.traits.length, sin: this.catalog.traits.length, holy_site: this.catalog.holySites.length };
            if (fields.length !== 3 || String(counts[fields[1]]) !== fields[2] || active.censuses.has(fields[1])) active.invalid = true;
            else active.censuses.add(fields[1]);
        } else if (fields[0] === 'text_begin') {
            const key = fields[1];
            if (fields.length !== 2 || !['faith_description', 'religion_description', ...this.catalog.worshipKeys.map(k => 'worship:' + k)].includes(key) ||
                duplicate('text:' + key)) active.invalid = true;
            else active.text = { key, lines: [], length: 0 };
        } else if (fields[0] === 'live') {
            if (fields[1] === 'fervor' && fields.length === 3 && !duplicate('live:fervor') && fields[2] !== '' && Number.isFinite(Number(fields[2])))
                active.live.fervor = Number(fields[2]);
            else if (fields[1] === 'head' && fields.length >= 3 && !duplicate('live:head'))
                active.live.religiousHead = normalizeText(fields.slice(2).join('/;/'));
            else if (fields[1] === 'site' && fields.length === 4 && this.catalog.holySites.some(s => s.key === fields[2]) &&
                ['yes', 'no'].includes(fields[3]) && !duplicate('live:site:' + fields[2])) {
                const site = this.catalog.holySites.find(s => s.key === fields[2])!;
                (active.live.holySiteControl ??= []).push({ site: site.barony ?? site.county, heldByFaith: fields[3] === 'yes' });
            } else active.invalid = true;
        } else if (fields[0] === 'end') {
            this.reset();
            if (fields.length !== 4 || fields[1] !== this.catalog.digest || fields[2] !== String(active.characterId) ||
                fields[3] !== String(active.faithId) || active.invalid || active.censuses.size !== 5) return;
            try { return { characterId: active.characterId, faithId: active.faithId,
                snapshot: sealFaithSnapshot(this.catalog, active.capture), liveContext: validateFaithLiveContext(active.live),
                ...(active.characterZealous === undefined ? {} : { characterZealous: active.characterZealous }) }; }
            catch { return; }
        } else active.invalid = true;
    }
}
