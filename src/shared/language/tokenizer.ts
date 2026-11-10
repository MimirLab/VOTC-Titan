/** The prototype's lexical segmentation: Unicode letters/numbers/marks and internal apostrophes. */
export interface SpeechToken { word: boolean; text: string }
export type SpeechTokenizer = (text: string) => Iterable<SpeechToken>;

const wordCharacter = new RegExp('^[\\p{L}\\p{N}\\p{M}]$', 'u');
const wordStart = new RegExp('^[\\p{L}\\p{N}]$', 'u');

export function* tokenizeSpeech(text: string): Iterable<SpeechToken> {
    const characters = Array.from(text);
    let index = 0;
    while (index < characters.length) {
        const start = index;
        const word = wordStart.test(characters[index]);
        index++;
        if (word) {
            while (index < characters.length) {
                if (wordCharacter.test(characters[index])) index++;
                else if (['\'', '’'].includes(characters[index]) && index + 1 < characters.length &&
                    wordCharacter.test(characters[index + 1])) index += 2;
                else break;
            }
        } else {
            while (index < characters.length && !wordStart.test(characters[index])) index++;
        }
        yield { word, text: characters.slice(start, index).join('') };
    }
}

/** Match the prototype's ALL CAPS/title-initial convention without normalizing source offsets. */
export function matchSpeechCase(source: string, result: string): string {
    if (Array.from(source).length > 1 && source === source.toUpperCase() && source !== source.toLowerCase())
        return result.toUpperCase();
    const first = Array.from(source)[0];
    if (first && first === first.toUpperCase() && first !== first.toLowerCase()) {
        const generated = Array.from(result);
        return generated[0].toUpperCase() + generated.slice(1).join('');
    }
    return result;
}
