import { AudioSegment, AudioSettings, DeliveryCue } from '../../shared/audio';
import { parseControlledProse } from '../../shared/language/controlledProse';
import { quotedSpeechSpans } from '../../shared/language/speechSpans';
import { playerSpeechSpans } from '../../shared/language/playerSpeech';
import type { Message } from '../ts/conversation_interfaces';
import { phraseAudioText } from './audioPhrasing';

interface AudioPassage { segment: AudioSegment; paragraphBefore: boolean }
const paragraph = (text: string): boolean => /\r?\n[\t ]*\r?\n/.test(text);

/** Accept ONLY the player's projected literary view; never canonical controls/source speech. */
function projectAudioLayout(view: Message): AudioPassage[] {
    const segments: AudioPassage[] = []; let passage = 0;
    // Reader projections intentionally omit the backend encoding flag. Their editor
    // text already contains only delivered words, with public/private boundaries.
    if (view.editableContent !== undefined) {
        let paragraphBefore = false;
        for (const segment of parseControlledProse(view.editableContent).segments) {
            if (segment.kind === 'gap') { paragraphBefore ||= paragraph(segment.text); continue; }
            const kind = segment.kind === 'speech' ? 'speech' : segment.kind === 'private' ? 'thought' : 'narration';
            const index = kind === 'narration' ? -1 : passage++;
            segments.push({ segment: { kind, text: segment.text, passage: index }, paragraphBefore });
            paragraphBefore = false;
        }
        return segments;
    }
    // Old prose has no trustworthy thought boundary. Never infer private thoughts from italics.
    const speech = view.perceivedSpeechSpans ?? (view.role === 'user' ? playerSpeechSpans(view.content) : quotedSpeechSpans(view.content));
    let cursor = 0;
    for (const span of speech) {
        if (view.role !== 'user' && span.start > cursor)
            segments.push({ segment: { kind: 'narration', text: view.content.slice(cursor, span.start), passage: -1 }, paragraphBefore: false });
        segments.push({ segment: { kind: 'speech', text: view.content.slice(span.start, span.end), passage: passage++ },
            paragraphBefore: paragraph(view.content.slice(cursor, span.start)) }); cursor = span.end;
    }
    if (view.role !== 'user' && cursor < view.content.length)
        segments.push({ segment: { kind: 'narration', text: view.content.slice(cursor), passage: -1 }, paragraphBefore: false });
    return segments.filter(({ segment }) => /[\p{L}\p{N}]/u.test(segment.text));
}

const audible = (segment: AudioSegment, settings: AudioSettings): boolean =>
    segment.kind === 'speech' || (segment.kind === 'thought' ? settings.thoughts : settings.narrator);

export function projectAudioSegments(view: Message, settings: AudioSettings): AudioSegment[] {
    return projectAudioLayout(view).map(part => part.segment).filter(segment => audible(segment, settings));
}

/** Plan from the full delivered view before muting anything; never from backend source prose. */
export function projectAudioUtterances(view: Message, settings: AudioSettings, cues: readonly DeliveryCue[] = []): AudioSegment[] {
    const joined: AudioSegment[] = [];
    const direction = (segment: AudioSegment): string => cues.find(c => c.passage === segment.passage)?.direction ??
        cues.find(c => c.passage === undefined)?.direction ?? 'Speak naturally.';
    let barrier = false;
    for (const { segment, paragraphBefore } of projectAudioLayout(view)) {
        barrier ||= paragraphBefore;
        if (!audible(segment, settings)) {
            // Muted actions may interrupt one spoken sentence. Muted thoughts still
            // mark a change of performance; never blend spoken and private delivery.
            barrier ||= segment.kind === 'thought' || paragraph(segment.text);
            continue;
        }
        const previous = joined[joined.length - 1];
        if (previous && !barrier && previous.kind === segment.kind && direction(previous) === direction(segment)) {
            const next = segment.text.trimStart();
            previous.text = previous.text.trimEnd() + (/^[,.;:!?…\)\]\}]/u.test(next) ? '' : ' ') + next;
        } else joined.push({ ...segment });
        barrier = false;
    }
    return joined.flatMap((segment, index) => phraseAudioText(segment.text, index === 0 && segment.kind === 'narration').map(text => ({ ...segment, text })));
}
