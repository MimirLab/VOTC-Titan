import { createHmac } from 'crypto';
import { matchSpeechCase, tokenizeSpeech } from '../../shared/language/tokenizer';
import { mapQuoted, mapSpeechSpans, SpeechSpan } from '../../shared/language/speechSpans';

type Slot = 'O' | 'V' | 'F';
type Sound = [Slot, string];
type Syllable = Sound[];
export interface FarProfile {
    inherits?: string; root?: string; lexicon?: string;
    onset: string; nucleus: string; coda: string; shapes: string[]; counts: number[];
    short_counts?: number[]; decay?: number; join_rate?: number; joiner?: string; max_word?: number;
    cells?: [string, string, string][]; initial_shapes?: string[]; medial_shapes?: string[]; final_shapes?: string[];
    keep_syllables?: number; extra_syllables?: number[]; short_extra_syllables?: number[];
    onset_map?: Record<string, string>; vowel_map?: Record<string, string>; coda_map?: Record<string, string>;
    medial_elision?: number; medial_softening?: number; final_vowels?: string; codas?: string;
    open_medial?: boolean | number; final_codas?: string; echo_vowel?: boolean; echo_rate?: number;
    short_echo_rate?: number; echo_onsets?: string; tail_rate?: number; short_tail_rate?: number; tails?: string[];
    reduplicate_rate?: number; compound_span?: number; separator_rate?: number; separator?: string;
    changes?: [string, string][];
}
export interface FarProfileData { version: string; roots?: Record<string, FarProfile>; profiles: Record<string, Partial<FarProfile>> }

class Stream {
    private readonly key: Buffer;
    private counter = 0;
    constructor(seed: string, ...parts: string[]) {
        this.key = createHmac('sha256', Buffer.from(seed, 'utf8')).update(JSON.stringify(parts), 'utf8').digest();
    }
    unit(): number {
        const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(this.counter++));
        const value = createHmac('sha256', this.key).update(counter).digest().readBigUInt64BE();
        return Number(value) / 18446744073709551616;
    }
    pick<T>(values: readonly T[], decay = 1): T {
        if (!values.length) throw new Error('Empty FAR inventory');
        const weights = values.map((_, index) => decay ** index);
        let target = this.unit() * weights.reduce((sum, weight) => sum + weight, 0);
        for (let index = 0; index < values.length; index++) {
            target -= weights[index]; if (target < 0) return values[index];
        }
        return values[values.length - 1];
    }
}

const split = (value: string): string[] => value.trim().split(/\s+/).filter(Boolean);
const length = (value: string): number => Array.from(value).length;

/** Faithful host-language adapter of the handed-off 0.2 engine. No sound/profile/seed revision. */
export class FarEncoder {
    private readonly resolved = new Map<string, FarProfile>();
    constructor(readonly data: FarProfileData, readonly seed = 'titan-demo', private readonly casefold: Record<string, string> = {}) {}

    normalize(word: string): string {
        return Array.from(word.normalize('NFKC'), char => this.casefold[char] ?? char.toLowerCase()).join('').replace(/’/g, "'");
    }

    profile(language: string, trail: readonly string[] = []): FarProfile {
        const cached = this.resolved.get(language); if (cached) return cached;
        if (trail.includes(language)) throw new Error('FAR profile inheritance cycle');
        const raw = this.data.profiles[language];
        if (!raw) throw new Error(`Unknown FAR language profile: ${language}`);
        let result = { ...(raw.inherits ? this.profile(raw.inherits, [...trail, language]) : {}), ...raw } as FarProfile;
        if (result.root) {
            const root = this.data.roots?.[result.root]; if (!root) throw new Error('Missing FAR sound root');
            result = { ...root, ...result };
        }
        for (const field of ['onset', 'nucleus', 'coda', 'shapes', 'counts'] as const)
            if (result[field] === undefined) throw new Error(`Missing FAR ${field}`);
        if (!result.shapes.length || result.shapes.some(shape => !shape || /[^OVF]/.test(shape)))
            throw new Error('Invalid FAR syllable shapes');
        for (const counts of [result.counts, result.short_counts])
            if (counts && (!counts.length || counts.some(n => !Number.isInteger(n) || n < 1 || n > 12)))
                throw new Error('Invalid FAR syllable counts');
        if (!((result.decay ?? .93) > 0 && (result.decay ?? .93) <= 1) ||
            !((result.join_rate ?? 0) >= 0 && (result.join_rate ?? 0) <= 1) ||
            !((result.max_word ?? 18) >= 1 && (result.max_word ?? 18) <= 256) ||
            !split(result.nucleus).some(token => token !== '_')) throw new Error('Invalid FAR profile limits');
        this.resolved.set(language, result); return result;
    }

    private syllables(original: string, p: FarProfile, rng: Stream, suppliedCount?: number): { syllables: Syllable[]; pools: Record<Slot, string[]> } {
        const pools = {} as Record<Slot, string[]>;
        for (const [slot, field] of [['O', 'onset'], ['V', 'nucleus'], ['F', 'coda']] as const) {
            pools[slot] = split(p[field]).map(value => value === '_' ? '' : value);
            if (!pools[slot].length) pools[slot] = [''];
        }
        const count = suppliedCount ?? rng.pick(length(original) <= 3 ? p.short_counts ?? p.counts : p.counts);
        const syllables: Syllable[] = [];
        for (let index = 0; index < count; index++) {
            if (p.cells) {
                const cell = rng.pick(p.cells, p.decay ?? .93);
                syllables.push([['O', cell[0]], ['V', cell[1]], ['F', cell[2]]]); continue;
            }
            const shapes = index === 0 ? p.initial_shapes : index === count - 1 ? p.final_shapes : p.medial_shapes;
            const shape = rng.pick(shapes ?? p.shapes);
            syllables.push(Array.from(shape, slot => [slot as Slot, rng.pick(pools[slot as Slot], p.decay ?? .93)]));
        }
        return { syllables, pools };
    }

    word(source: string, language: string): string {
        const p = this.profile(language), original = this.normalize(source);
        const base = p.root ? this.data.roots![p.root] : p;
        const namespace = p.root ? `root:${p.root}` : p.lexicon ?? language;
        const rng = new Stream(this.seed, this.data.version, namespace, 'word', original);
        let { syllables, pools } = this.syllables(original, base, rng);
        const style = new Stream(this.seed, this.data.version, language, 'articulation', original);
        if (p.keep_syllables !== undefined) syllables = syllables.slice(0, p.keep_syllables);
        const extra = style.pick(length(original) > 3 ? p.extra_syllables ?? [0] : p.short_extra_syllables ?? [0]);
        if (extra) syllables.push(...this.syllables(original, base, style, extra).syllables);
        const firstVowel = syllables[0].find(([slot]) => slot === 'V')?.[1] ?? pools.V[0];
        const transformed: string[] = [];
        for (let index = 0; index < syllables.length; index++) {
            let syllable = syllables[index]; const final = index === syllables.length - 1; const sounds: string[] = [];
            for (const [slot, originalSound] of syllable) {
                let sound = (slot === 'O' ? p.onset_map : slot === 'V' ? p.vowel_map : p.coda_map)?.[originalSound] ?? originalSound;
                if (slot === 'V' && index > 0 && index < syllables.length - 1 && style.unit() < (p.medial_elision ?? 0)) sound = '';
                if (slot === 'O' && index > 0 && index < syllables.length - 1 && style.unit() < (p.medial_softening ?? 0)) sound = '';
                if (slot === 'V' && final && p.final_vowels !== undefined) sound = style.pick(split(p.final_vowels), p.decay ?? .93);
                if (slot === 'F' && p.codas !== undefined) { sound = style.pick(split(p.codas), p.decay ?? .93); if (sound === '_') sound = ''; }
                if (slot === 'F' && !final && (p.open_medial === true ||
                    (p.open_medial && style.unit() < Number(p.open_medial)))) sound = '';
                sounds.push(sound);
            }
            if (final && p.final_codas !== undefined) {
                while (syllable.length && syllable[syllable.length - 1][0] === 'F' && sounds.length) { syllable = syllable.slice(0, -1); sounds.pop(); }
                const ending = style.pick(split(p.final_codas), p.decay ?? .93); sounds.push(ending === '_' ? '' : ending);
            }
            transformed.push(sounds.join(''));
        }
        if (p.echo_vowel && style.unit() < (p.echo_rate ?? 1) &&
            (length(original) > 3 || style.unit() < (p.short_echo_rate ?? .5))) {
            const vowel = p.vowel_map?.[firstVowel] ?? firstVowel, onset = style.pick(split(p.echo_onsets ?? 'l r'));
            transformed.push((onset === '_' ? '' : onset) + vowel);
        }
        const tailRate = length(original) > 3 ? p.tail_rate ?? 0 : p.short_tail_rate ?? (p.tail_rate ?? 0) * .3;
        if (style.unit() < tailRate) transformed.push(style.pick(p.tails!));
        if (style.unit() < (p.reduplicate_rate ?? 0)) transformed.push(transformed[0]);
        let word = transformed[0];
        for (let index = 1; index < transformed.length; index++) {
            const gap = index % (p.compound_span ?? 1) === 0 && style.unit() < (p.separator_rate ?? 0) ? p.separator ?? "'" : '';
            word += gap + transformed[index];
        }
        for (const [pattern, replacement] of p.changes ?? []) {
            // The supplied banks use numeric Python backreferences only.
            const target = replacement.replace(/\\([1-9])/g, '$$$1');
            word = word.replace(new RegExp(pattern, 'g'), target);
        }
        word = word || pools.V.find(value => !!value)!;
        word = Array.from(word).slice(0, p.max_word ?? 18).join('');
        return matchSpeechCase(source, word);
    }

    speech(text: string, language: string): string {
        const p = this.profile(language), parts = Array.from(tokenizeSpeech(text)), output: string[] = [];
        for (let index = 0; index < parts.length; index++) {
            const source = parts[index]; if (!source.word) { output.push(source.text); continue; }
            let word = this.word(source.text, language);
            if (index + 2 < parts.length && p.join_rate) {
                const gap = parts[index + 1], next = parts[index + 2];
                if (!gap.word && /^[ \t]+$/.test(gap.text) && next.word && length(this.normalize(source.text)) <= 3 && length(this.normalize(next.text)) <= 3) {
                    const rng = new Stream(this.seed, this.data.version, p.lexicon ?? language, 'join', this.normalize(source.text), this.normalize(next.text));
                    if (rng.unit() < p.join_rate) { word += (p.joiner ?? '') + this.word(next.text, language); index += 2; }
                }
            }
            output.push(word);
        }
        return output.join('');
    }

    quoted(text: string, language: string): string { return mapQuoted(text, span => this.speech(span, language)); }
    render(text: string, language: string, spans: readonly SpeechSpan[]): string {
        return mapSpeechSpans(text, spans, span => this.speech(span, language));
    }
}
