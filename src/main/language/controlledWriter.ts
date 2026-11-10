import { Message } from '../ts/conversation_interfaces';
import { ControlledProseError, parseControlledProse } from '../../shared/language/controlledProse';

export type ResponseProseEncoding = 'legacy' | 'controls-v1';

/** A standalone explicit phonetic control already declares speech; label that gap without guessing any prose. */
export function repairControlledPhoneticGaps(source: string): string {
    const pattern = /<<[^<>\n]{1,240}>>/gu;
    const markers = [...source.matchAll(pattern)];
    if (!markers.length) return source;
    // Punctuation placeholders retain every UTF-16 offset and cannot make other unlabelled words valid.
    const masked = source.replace(pattern, marker => '·'.repeat(marker.length));
    const gaps = parseControlledProse(masked).segments.filter(segment => segment.kind === 'gap');
    const standalone = markers.filter(marker => gaps.some(gap => marker.index! >= gap.start && marker.index! + marker[0].length <= gap.end));
    let result = source;
    for (const marker of standalone.reverse()) result = result.slice(0, marker.index!) + '""' + marker[0] + '""' + result.slice(marker.index! + marker[0].length);
    return result;
}

/** Exact convention used by the distinct-control Mimir study; one ordinary prose generation. */
export const CONTROLLED_WRITER_INSTRUCTION = 'For this reply use three distinct host control delimiters: **observable action or narration**, ""words spoken aloud"", and ~~private thoughts or narration~~. ' +
    'Every prose clause must use one of these three forms. **...** may describe only externally observable movement, expression, surroundings or voice. ' +
    'Describe a voice\'s tone in **...**, and put its actual spoken words in ""...""; an attribution such as \'she repeats\' never makes the spoken words an action. Replies may remain entirely nonverbal when appropriate. A change of delimiter does not start a new line or paragraph. ' +
    'Only words newly spoken by the current character use ""..."". Do not replay another participant\'s speech as part of this reply. You may repeat a sound you actually heard: wrap only that exact phonetic fragment in <<...>> within your own ""speech"", without inventing its translation. The host displays it as an ordinary quotation. Ordinary single quotes remain ordinary quotations. ' +
    'All unspoken thoughts, feelings, motives, memories and concealed facts belong in ~~...~~, including hidden objects beside visible gestures. ' +
    'Split visible gestures from their unspoken interpretation and concealed details. ' +
    'A witness cannot identify a concealed item or know what touching it feels like. Keep visible movement public and its private explanation in ~~...~~. ' +
    'Use ordinary single quotes for quotations within speech. Preserve the full literary prose, emotional depth and natural paragraph flow, weaving all three forms together within each paragraph. ' +
    'The host cleans these delimiters for the player while retaining their meanings for other characters. ';

/** Adapt only the recognisable stock aliChat example shape. Custom scripts and trait prose stay authored. */
export function controlledTraitExamples(messages: Message[]): Message[] {
    const result = messages.map(message => ({ ...message }));
    const examples = result.filter(message => message.role === 'assistant');
    if (examples.length !== 3 || !examples[0].name?.trim() || examples.some(message => message.name !== examples[0].name)) return messages;
    const first = examples[0].content.match(/^(\*[^*]+\*) (.*?) \*([^*]+)\* ([\s\S]*)$/);
    const second = examples[1].content.match(/^(Yes,) \*([^*]+)\* ([\s\S]*)$/);
    const third = examples[2].content;
    if (!first || !second || !third.startsWith('*No, I am also')) return messages;
    const firstPause = first[3].match(/^(.*?) takes a short pause thinking$/);
    const secondPause = second[2].match(/^(.*?) pauses again thinking about what else to say$/);
    if (!firstPause || !secondPause) return messages;
    const name = examples[0].name!;
    examples[0].content = '**' + first[1].slice(1, -1) + '** ""' + first[2] + '"" **' + firstPause[1] +
        ' takes a short pause.** ~~' + name + ' considers an answer.~~ ""' + first[4] + '""';
    examples[1].content = '""' + second[1] + '"" **' + secondPause[1] + ' pauses again.** ~~' + name +
        ' considers what else to say.~~ ""' + second[3] + '""';
    examples[2].content = '""' + third.slice(1) + '""';
    return result;
}

/** Catch explicit concealment/cognition misplaced beside gestures. This is a narrow guard, not a semantic classifier. */
export function repairControlledPrivateClauses(source: string): string {
    const parsed = parseControlledProse(source);
    const privateSignal = (text: string): boolean => {
        // A party already in a hidden place can see its surroundings. Its name alone is not an actor's secret.
        const classification = text.replace(/\b(?:hidden|concealed|secret)\s+(?:garden|shrine|temple|passage|valley|cave|grotto|spring|chamber|room|archive|library|entrance)\b/gi, '')
            .replace(/\b(?:hair|(?:a |the )?(?:strand|curl|braid))\s+tucked\s+behind\s+(?:her|his|their|an?)\s+ear\b/gi, '');
        return /\b(?:hidden|concealed|secret|privately|unspoken|inwardly|remembers?|recalls?|thinks?|knows?|hopes?|fears?)\b/i.test(classification) ||
            /\b(?:tucked|stowed|secreted|nestled)\s+(?:away\s+)?(?:beneath|under|inside|within|behind)\b/i.test(classification) ||
            /\b(?:beneath|under|inside|within)\b[\s\S]{0,70}\b(?:coat|boot|tunic|pocket|clothing|hem)\b/i.test(classification);
    };
    return parsed.segments.map(segment => {
        if (segment.kind === 'gap') return segment.text;
        const token = segment.kind === 'speech' ? '""' : segment.kind === 'private' ? '~~' : '**';
        if (segment.kind !== 'action') return token + segment.text + token;
        // An explicit disclosure/hiding act may legitimately reveal an item or its location.
        if (/\b(?:shows?|reveals?|displays?|exposes?|unveils?|uncovers?|hides?|conceals?)\b/i.test(segment.text))
            return token + segment.text + token;
        const split = /(?:,|;)\s+(?=(?:remembering|recalling|thinking|knowing|hoping|fearing|feeling)\b)/i.exec(segment.text) ??
            (privateSignal(segment.text) ? /,\s+(?=a\s+(?:habitual|familiar|small|slight|gentle)\s+motion\b)/i.exec(segment.text) : null);
        if (split) {
            const boundary = split.index + 1;
            const after = segment.text.slice(boundary), whitespace = after.match(/^\s*/)![0];
            const publicPart = segment.text.slice(0, boundary), publicToken = privateSignal(publicPart) ? '~~' : '**';
            return publicToken + publicPart + publicToken + whitespace + '~~' + after.slice(whitespace.length) + '~~';
        }
        if (privateSignal(segment.text))
            return '~~' + segment.text + '~~';
        return token + segment.text + token;
    }).join('');
}

/** Reject explicit attributed dialogue in action controls, without inferring speech from first-person prose. */
export function validateControlledSpeechLabels(source: string, proseLanguage = 'en'): void {
    if (proseLanguage !== 'en') return;
    const attribution = '(?:says?|said|asks?|asked|replies|replied|answers?|answered|whispers?|whispered|shouts?|shouted|murmurs?|murmured|utters?|uttered)';
    const quoted = '["“‘\'][^"”’\'\\n]+["”’\']';
    const before = new RegExp('\\b' + attribution + '\\s*[,;:]?\\s*' + quoted, 'i');
    const after = new RegExp(quoted + "\\s*[,;:]?\\s*(?:(?:he|she|they|[A-Z][\\p{L}\\p{M}'-]+)\\s+)" + attribution + '\\b', 'iu');
    const repeatedWords = /,\s*(?:he|she|they)\s+(?:repeats|echoes)\b[^.!?]{0,120}\bwords?\b/i;
    let previousAction: string | undefined;
    for (const segment of parseControlledProse(source).segments) {
        if (segment.kind !== 'action') {
            if (segment.kind !== 'gap' || /\r?\n[\t ]*\r?\n/.test(segment.text)) previousAction = undefined;
            continue;
        }
        const quotedOnly = previousAction && /^\s*(?:"[^"]+"|“[^”]+”|'[^']+'|‘[^’]+’)\s*[,;:]?\s*$/u.test(previousAction);
        const explicitSilence = /^\s*(?:he|she|they|[A-Z][\p{L}\p{M}'-]+)\s+(?:says?|said)\s+(?:nothing|no\s+words|not\s+a\s+word)\b/iu.test(segment.text);
        if (quotedOnly && !explicitSilence && after.test(previousAction + ' ' + segment.text))
            throw new ControlledProseError('Attributed spoken words were split across observable-action controls', 'speech-label');
        if (before.test(segment.text) || after.test(segment.text) || repeatedWords.test(segment.text))
            throw new ControlledProseError('Attributed spoken words were placed inside observable-action controls', 'speech-label');
        previousAction = segment.text;
    }
}

/** Narrow recovery trigger for wholly coded-looking English replies, not a general language detector. */
export function validateControlledSourceSpeech(source: string, proseLanguage = 'en'): void {
    if (proseLanguage !== 'en') return;
    // Delivery verifies marked fragments against audible history before any message can be committed.
    const speech = parseControlledProse(source).segments.filter(segment => segment.kind === 'speech')
        .map(segment => segment.text.replace(/<<[^<>\n]{1,240}>>/gu, ''));
    const anchors = new Set(('a an the i you we he she they it me us him her them my your our his its their ' +
        'am is are was were be been being have has had do does did will would shall should can could may might must ' +
        'not no yes and or but if then so to of from for in on at by with as this that these those what who how why when where ' +
        'thou thee thy thine ye art dost doth hath shalt wilt ' +
        'stand wait listen leave return drink rest eat sleep walk ride remember stop go come help look welcome hello goodbye thanks').split(' '));
    for (const text of [...speech, speech.join(' ')]) {
        const words = text.match(/[\p{L}]+(?:['’][\p{L}]+)*/gu) ?? [];
        if (words.length < 10 || words.filter(word => /^\p{Lu}/u.test(word)).length >= words.length * 0.75) continue;
        if (!words.some(word => anchors.has(word.toLowerCase().split(/['’]/)[0])))
            throw new ControlledProseError('The reply copied foreign-looking syllables instead of source-English speech', 'source');
    }
}
