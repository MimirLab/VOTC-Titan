import { AudioSettings, DeliveryCue } from '../../shared/audio';
import type { Message } from '../ts/conversation_interfaces';
import { parseControlledProse } from '../../shared/language/controlledProse';

/** These cues never become part of a Message, ledger or model memory. */
const cues = new WeakMap<Message, readonly DeliveryCue[]>();
const deliveryWords = new Set(('a an and as at but for from in into of on or than the then to toward towards with without ' +
    'slightly subtly gently very more less increasingly gradually restrained controlled natural naturally calm calmly measured steady steadily ' +
    'warm warmth warmly warming cool cold softly soft firm firmly firmness clear clearly clarity reassuring reassurance ' +
    'thoughtful thoughtful playful playfully wistful wistfully tender tenderness intimate intimately gentle quiet quietly hushed low lowered ' +
    'serious seriously stern sternly grave solemn solemnly direct dry wry ironic sarcastic cautious cautiously caution uncertain uncertainty ' +
    'hesitant hesitantly hesitation nervous nervously nervousness anxious anxiously anxiety worried worry weary wearily tired fatigue ' +
    'sad sadness sadly sorrow sorrowful melancholy mournful grieving regret regretful remorse remorseful bitter bitterness pained painful ' +
    'angry anger angrily indignant indignation annoyed annoyance irritated irritation frustrated frustration sharp sharply sharpening sharper ' +
    'urgent urgency urgently insistent insistence impatient impatiently impatient patience patient patiently deliberate deliberately ' +
    'confident confidently confidence assured assurance resolute resolution determined determination decisive decisively defensive guarded ' +
    'relieved relief hopeful hope optimism optimistic excited excitement enthusiastic enthusiasm joyful joy happy happiness delighted delight ' +
    'amused amusement affectionate affection caring care compassionate compassion compassionate concerned concern attentive attentively ' +
    'curious curiosity surprised surprise startled fearful fear frightened apprehensive apprehension tense tension strained strain ' +
    'emotion emotional expressive expression expressively inflection intonation tone tonal delivery cadence pace pacing emphasis ' +
    'slow slowly slower quick quickly quicker fast faster brisk briskly unhurried pauses pause brief light lightly breathy breathiness ' +
    'breathless breathlessness subdued understated muted faint faintly conversational speaking spoken soft-spoken intensity restrained ' +
    'rising falling softened softening slowing carefully careful dignified dignified proud pride respectful respectfully respectful ' +
    'neutral neutrally even evenness smooth smoothly flowing fluid fluidly reserved reserve composed composure shifting resonant resonance practical').split(/\s+/));
export const boundedDirection = (value: unknown): string => {
    if (typeof value !== 'string' || value.length > 240 || !/^[a-zA-Z ,.;:()!?-]+$/.test(value)) return '';
    const words = value.toLowerCase().match(/[a-z]+(?:-[a-z]+)*/g) ?? [];
    // Delivery instructions cannot smuggle canonical dialogue, names, age or a different identity to speech.
    return words.length && words.every(word => deliveryWords.has(word)) ? value.trim() : '';
};
export function audioCueInstruction(settings: AudioSettings): string {
    return 'Audio delivery metadata: preserve all existing reply and prose controls. After the complete literary reply append exactly one ' +
        '<titan_audio>' + (settings.cueMode === 'passage'
            ? '{"cues":[{"passage":0,"direction":"calm, measured"}]}'
            : '{"direction":"calm, measured"}') + '</titan_audio> block. ' +
        (settings.cueMode === 'passage' ? 'Number speech and private narration passages together from zero in their original order; omit observable narration. ' : '') +
        'Describe only the acting character\'s current audible emotion, inflection, pace and emphasis, briefly in English. ' +
        'Do not supply spoken text, names, voice identity, age, anatomy, narrator instructions or other characters\' cues. The host chooses speaker, age and whispers. ' +
        'A silent reply may use an empty direction. Never put audio instructions inside literary prose.';
}
export function splitAudioMetadata(raw: string): { prose: string; cues: readonly DeliveryCue[] } {
    const found: DeliveryCue[] = [];
    // Strip malformed/unclosed machine blocks as well: valid prose does not need a repair request for cues.
    const parseCues = (json: string): void => {
        if (json.length > 8192) return;
        try {
            const data = JSON.parse(json.trim());
            if (data && typeof data === 'object') {
                if (Array.isArray(data.cues)) for (const entry of data.cues.slice(0, 64)) {
                    if (!entry || !Number.isInteger(entry.passage) || entry.passage < 0 || entry.passage > 255) continue;
                    const direction = boundedDirection(entry.direction);
                    if (direction && !found.some(cue => cue.passage === entry.passage)) found.push({ passage: entry.passage, direction });
                }
                else { const direction = boundedDirection(data.direction); if (direction) found.push({ direction }); }
            }
        } catch { /* Missing cues use neutral delivery. Literary validation remains independent. */ }
        return;
    };
    let prose = raw.replace(/(?:\s*```(?:json|xml)?\s*)?<titan_audio\b([\s\S]*?)(?:<\/titan_audio\s*>|$)(?:\s*```)?/gi, (_block, fragment: string) => {
        const start = fragment.indexOf('{');
        if (start >= 0) parseCues(fragment.slice(start).trim());
        return '';
    }).replace(/<\/titan_audio\s*>/gi, '').trim();
    // A complete controlled reply followed by an unframed cue object is still valid prose.
    const tail = /\n\s*(?:```(?:json)?\s*)?\{\s*"(?:direction|cues)"\s*:[\s\S]*$/i.exec(prose);
    if (tail) {
        const prefix = prose.slice(0, tail.index).trim();
        try { parseControlledProse(prefix); const json = tail[0].replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '').trim(); parseCues(json); prose = prefix; }
        catch { /* Ordinary incomplete prose retains the existing writer recovery. */ }
    }
    return { prose, cues: found };
}
export function rememberAudioCues(message: Message, value: readonly DeliveryCue[]): void { cues.set(message, value); }
export function audioCuesFor(message: Message): readonly DeliveryCue[] { return cues.get(message) ?? []; }
export function cleanAudioMessage(message: Message): Message {
    const extracted = splitAudioMetadata(message.content);
    message.content = extracted.prose; rememberAudioCues(message, extracted.cues); return message;
}
