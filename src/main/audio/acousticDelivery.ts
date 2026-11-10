import { createHash } from 'crypto';
import { performancePreset, familyDelivery } from './familyPerformance';
import { AudioSegment } from '../../shared/audio';
import { demonFamily, demonDirection, WHISPER_DIRECTION } from './demonVoices';
import { castingCatalogue } from './castingCatalog';
import { UndeadPerformance, undeadDirection } from './undeadVoice';
import { tuskarrDirection } from './tuskarrVoice';

export interface AcousticDeliveryMetadata {
    direction?: string;
    familyKey?: string;
    undead?: UndeadPerformance;
    reviewedRaceDirection?: string;
    voice?: { sex?: 'male' | 'female'; anatomyId?: string; body?: string; cultureId?: string };
    faithDeliveryId?: string;
    literalDigest?: string;
    emphasis?: { start: number; end: number }[];
    pauses?: { offset: number; length: 'brief' | 'measured' | 'long' }[];
    events?: { offset: number; event: 'laugh' | 'cough' | 'clears throat' | 'sigh' }[];
}
export const literalDigest = (text: string): string => createHash('sha256').update(text).digest('hex');
function boundary(text: string, offset: number): boolean {
    return Number.isInteger(offset) && offset >= 0 && offset <= text.length &&
        !(offset > 0 && offset < text.length && /[\p{L}\p{N}]/u.test(text[offset - 1]) && /[\p{L}\p{N}]/u.test(text[offset]));
}
/** Takes the delivered literary segment, never a canonical source line or character biography. */
export function acousticDelivery(segment: AudioSegment, age: string, metadata: AcousticDeliveryMetadata = {}) {
    const text = segment.text;
    if (metadata.familyKey && segment.kind !== 'narration') {
        const preset = performancePreset(metadata.familyKey,metadata.voice ? {...metadata.voice,presentation:metadata.voice.sex} as any : undefined);
        if (preset?.key !== metadata.familyKey) throw new Error('The selected demon performance does not match this Race and Sex.');
        // Only current approved-family delivery takes this path. Historical plans
        // without this key retain the previous delivery, and named clones use cloneDelivery.
        const delivered = familyDelivery(preset, segment, age, metadata.direction);
        if(preset.reviewVersion){const undead=undeadDirection(metadata.undead,segment.kind==='thought');if(undead)delivered.instruction+=' '+undead;}
        if (metadata.faithDeliveryId) {
            const faith = castingCatalogue().faithDelivery[metadata.faithDeliveryId];
            if (!faith) throw new Error('Unknown explicitly selected faith delivery.');
            delivered.instruction += ' ' + faith.instruction;
        }
        return Object.freeze({literalText:text,literalDigest:literalDigest(text),...delivered,faithDeliveryId:metadata.faithDeliveryId});
    }
    const instructions = [segment.kind === 'narration' ? 'Consistent, clear storytelling narration.' : age];
    // The reference carries identity. Repeating the design paragraph here gives
    // a short thought a much longer block of unrelated language to condition on.
    if (segment.kind === 'thought' && metadata.voice?.sex)
        instructions.push(`The reference speaker is ${metadata.voice.sex}.`);
    if (segment.kind !== 'narration' && metadata.direction) instructions.push(metadata.direction);
    if (segment.kind !== 'narration' && metadata.voice && (metadata.voice.anatomyId
        ? metadata.voice.anatomyId === castingCatalogue().races.creature_goblin.default
        : metadata.voice.body === 'creature_goblin'))
        instructions.push("Use a pronounced goblin nasal honk: pinched forward resonance, buzzy brassy twang and sharp wiry consonants. Keep the reference speaker's sex and pitch range.");
    if (segment.kind !== 'narration') {
        const tuskarr=tuskarrDirection(metadata.voice);
        if(tuskarr)instructions.push(tuskarr);
        const demon = demonDirection(demonFamily(metadata.voice), segment.kind === 'thought');
        if (demon) instructions.push(demon);
        const undead=undeadDirection(metadata.undead,segment.kind==='thought');
        if(undead)instructions.push(undead);
    }
    if (metadata.faithDeliveryId) {
        const faith = castingCatalogue().faithDelivery[metadata.faithDeliveryId];
        if (!faith) throw new Error('Unknown explicitly selected faith delivery.');
        instructions.push(faith.instruction);
    }
    let renderText = text;
    const hasPositions = (metadata.emphasis?.length ?? 0) + (metadata.pauses?.length ?? 0) + (metadata.events?.length ?? 0) > 0;
    if (hasPositions) {
        if (metadata.literalDigest !== literalDigest(text)) throw new Error('Delivery positions belong to a different literary reading.');
        if ((metadata.emphasis?.length ?? 0) > 8 || (metadata.pauses?.length ?? 0) > 8 || (metadata.events?.length ?? 0) > 4)
            throw new Error('Too many explicit delivery positions.');
        for (const span of metadata.emphasis ?? []) {
            if (!boundary(text, span.start) || !boundary(text, span.end) || span.end <= span.start || span.end - span.start > 80)
                throw new Error('Emphasis must identify an existing bounded word span.');
            instructions.push('Emphasize this existing span: ' + JSON.stringify(text.slice(span.start, span.end)) + '.');
        }
        for (const pause of metadata.pauses ?? []) {
            if (!boundary(text, pause.offset) || !['brief', 'measured', 'long'].includes(pause.length)) throw new Error('Invalid explicit pause position.');
            const preceding = text.slice(0, pause.offset).match(/\S+(?:\s+\S+)?\s*$/)?.[0].trim();
            instructions.push(preceding ? `Make a ${pause.length} pause after the existing words ${JSON.stringify(preceding)}.` : `Begin after a ${pause.length} pause.`);
        }
        const events = [...(metadata.events ?? [])].sort((a, b) => b.offset - a.offset);
        const seen = new Set<number>();
        for (const event of events) {
            if (!boundary(text, event.offset) || !['laugh', 'cough', 'clears throat', 'sigh'].includes(event.event) || seen.has(event.offset))
                throw new Error('Invalid explicit vocal-event position.');
            seen.add(event.offset);
            renderText = renderText.slice(0, event.offset) + ` (${event.event}) ` + renderText.slice(event.offset);
        }
    }
    if (segment.kind === 'thought') instructions.push(WHISPER_DIRECTION);
    else if (segment.kind === 'speech') instructions.push('Speak aloud naturally.');
    if (segment.kind !== 'narration' && metadata.reviewedRaceDirection) instructions.push(metadata.reviewedRaceDirection);
    return Object.freeze({ literalText: text, renderText, literalDigest: literalDigest(text),
        instruction: instructions.join(' '), faithDeliveryId: metadata.faithDeliveryId });
}
