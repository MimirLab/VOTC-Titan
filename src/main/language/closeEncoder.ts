import { matchSpeechCase, SpeechTokenizer, tokenizeSpeech } from '../../shared/language/tokenizer';
import { CloseProfiles } from './closeProfiles';

const letters = /[A-Za-z]/g;
const asciiLower = (value: string): string => value.replace(/[A-Z]/g, char => char.toLowerCase());
function replacementCase(source: string, replacement: string, token: string, start: number): string {
    if (token === token.toUpperCase() && token !== token.toLowerCase()) return replacement.toUpperCase();
    if (start === 0 && /^[A-Z]/.test(token) && token.slice(1) === token.slice(1).toLowerCase())
        return matchSpeechCase(token, replacement.toLowerCase());
    if (source === source.toUpperCase()) return replacement.toUpperCase();
    if (source === source.toLowerCase()) return replacement.toLowerCase();
    if (/^[A-Z]/.test(source) && source.slice(1) === source.slice(1).toLowerCase())
        return matchSpeechCase(source, replacement.toLowerCase());
    return Array.from(replacement, (char, i) => /[A-Z]/.test(source[Math.min(i, source.length - 1)])
        ? char.toUpperCase() : char.toLowerCase()).join('');
}

export class CloseEncoder {
    constructor(readonly profiles: CloseProfiles, private readonly tokenize: SpeechTokenizer = tokenizeSpeech) {}

    word(source: string, language: string): string {
        const candidates: { start: number; end: number; order: number; replacement: string; cadence: boolean }[] = [];
        for (const rule of this.profiles.rules(language)) {
            // JS without Unicode case folding preserves the original UTF-16 match positions.
            const regex = rule.regex;
            regex.lastIndex = 0;
            let match: RegExpExecArray | null;
            while ((match = regex.exec(source)) !== null) {
                if (!match[0].length) throw new Error('CLOSE rule matched an empty source range');
                if (!/^[A-Za-z]+$/.test(match[0])) continue;
                if (asciiLower(match[0]) === asciiLower(rule.replacement)) continue;
                candidates.push({ start: match.index, end: match.index + match[0].length, cadence: !!rule.cadence,
                    order: rule.order, replacement: replacementCase(match[0], rule.replacement, source, match.index) });
            }
        }
        // A bounded authored cadence supplies the audible ending before ordinary
        // correspondences spend the same existing one/two-rewrite allowance.
        candidates.sort((a, b) => Number(b.cadence) - Number(a.cadence) || a.start - b.start || a.order - b.order);
        const allowance = (source.match(letters)?.length ?? 0) < 8 ? 1 : 2;
        const selected: typeof candidates = [];
        for (const candidate of candidates) {
            if (candidate.cadence && selected.some(match => match.cadence)) continue;
            if (selected.some(match => candidate.start < match.end && candidate.end > match.start)) continue;
            selected.push(candidate);
            if (selected.length === allowance) break;
        }
        if (!selected.length) return source;
        selected.sort((a, b) => a.start - b.start);
        let output = source;
        for (let index = selected.length - 1; index >= 0; index--) {
            const match = selected[index];
            output = output.slice(0, match.start) + match.replacement + output.slice(match.end);
        }
        return output;
    }

    speech(text: string, language: string, locale = this.profiles.sourceLocale): string {
        if (locale.toLowerCase().split(/[-_]/)[0] !== this.profiles.sourceLocale)
            throw new Error('CLOSE English display rules require an English source locale');
        this.profiles.rules(language);
        return Array.from(this.tokenize(text), token => token.word ? this.word(token.text, language) : token.text).join('');
    }
}
