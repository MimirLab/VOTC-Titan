/** Audio-owned performance interpretations of the player's revised race guide.
 * Source SHA-256: 06907a92c0d68eaa80f5f6a36c34385c093a066156f327c9fa9fcb65afe0d21a.
 * These are vocal choices, not additional lore, personality, accents or spoken words.
 */
export const DEMON_GUIDE_SHA256 = '06907a92c0d68eaa80f5f6a36c34385c093a066156f327c9fa9fcb65afe0d21a';
const performances = {
    dreadlord: {
        speech: 'Keep a velvet-dark core, a cold hollow undertone and a fine dry rasp. Let the resonance feel unnaturally deep behind close, precise consonants.',
        thought: 'Retain the hollow, velvety color in the breath, with finely edged consonants.' },
    eredar: {
        speech: 'Use polished metallic resonance and a faint doubled sorcerous undertone. Keep sustained vowels smooth and each consonant precise within the speaker\'s own range.',
        thought: 'Retain the polished, metallic color and precise articulation in the whispered breath.' },
    doomguard: {
        speech: 'Use broad iron-dark chest resonance, a flinty throat rasp and heavy, clean consonant edges. Keep a steady speech core beneath the roughness.',
        thought: 'Keep the broad, flinty throat texture in the breath, with weighted but quiet consonants.' },
    pitlord: {
        speech: 'Carry immense chest-and-throat resonance, a coarse low growl and a furnace-like rasp. Keep every supplied word clear above the rumble.',
        thought: 'Keep the cavernous, furnace-dry throat color in the breath; do not turn the whisper into a growl.' },
    imp: {
        speech: 'Use a tight, sharp nasal ring, brittle scratch and wiry consonant attacks. Keep the small, agile voice clearly articulated rather than squealing.',
        thought: 'Keep pinched nasal color and small, wiry sibilants in the whispered breath.' },
    satyr: {
        speech: 'Retain smooth elven vowels beneath a dry goat-throat rasp, a faint nasal bleat and caught consonant edges. Preserve clear supplied words.',
        thought: 'Keep the dry goat-throat color and caught consonants in the breath, retaining the elven vowel shapes.' },
    sayaad: {
        speech: 'Use close velvet resonance, a smoky breath edge and a slender uncanny overtone. Retain the speaker\'s own register and clear words without making ordinary speech a whisper.',
        thought: 'Keep the close, smoky velvet texture in an intimate whispered breath.' },
    shivarra: {
        speech: 'Use tall, ringing resonance with a silken edge and a faint choral overtone. Preserve one clear speaker, the original register and exact articulation.',
        thought: 'Keep the silken, ringing color within one clear whispered voice.' },
    observer: {
        speech: 'Give the voice rounded, wet-edged alien resonance, a narrow nasal focus and small shifting overtones. Keep a single intelligible speech center.',
        thought: 'Keep rounded, wet-edged color and narrow nasal articulation in the breath.' },
    voidwalker: {
        speech: 'Use deep, hollow, diffuse resonance with a smooth unearthly undertone. Preserve every supplied word above the low resonance.',
        thought: 'Keep a hollow, diffuse breath resonance while preserving intelligible whispered words.' },
    felorc: {
        speech: 'Keep the heavy orcish chest core, adding dense guttural gravel and an abrasive, scorched throat edge. Retain the individual register and learned accent.',
        thought: 'Keep the heavy, scorched throat texture in the whispered breath, without a full-voice growl.' },
    felblood: {
        speech: 'Retain the elven vowels, adding a taut metallic ring and a scorched dry rasp. Keep the existing accent and the speaker\'s individual vocal texture.',
        thought: 'Retain elven vowel shapes with dry, metallic color in the whispered breath.' },
    metamorphosis: {
        speech: 'Use a large hollow resonance and a rough fel-edged undertone, with one clear speech layer. Preserve the individual articulation and learned accent.',
        thought: 'Keep the large hollow color and rough fel edge in a single whispered breath.' }
} as const;
export type DemonFamily = keyof typeof performances;
export const isDemonFamily = (value: unknown): value is DemonFamily => typeof value === 'string' && Object.prototype.hasOwnProperty.call(performances, value);
const anatomy: Record<string, DemonFamily> = { '013':'felorc', '034':'satyr', '084':'doomguard', '085':'dreadlord', '086':'eredar', '088':'pitlord', '091':'imp', '092':'sayaad', '093':'voidwalker', '166':'felblood', '185':'observer', '189':'shivarra' };
const bodies: Record<string, DemonFamily> = { creature_fel_orc:'felorc', creature_satyr:'satyr', creature_eredruin:'doomguard', creature_nathrezim:'dreadlord', creature_manari:'eredar', creature_annihilan:'pitlord', creature_imp:'imp', creature_sayaadi:'sayaad', creature_voidwalker:'voidwalker', creature_observer:'observer', creature_shivarra:'shivarra', metamorphosis:'metamorphosis' };
export function demonFamily(voice?: { anatomyId?: string; body?: string }): DemonFamily | undefined {
    // An explicit/saved Race choice has priority over the original observed body.
    return voice?.anatomyId ? anatomy[voice.anatomyId] : voice?.body ? bodies[voice.body] : undefined;
}
export function demonDirection(family: DemonFamily | undefined, thought = false): string {
    return family ? performances[family][thought ? 'thought' : 'speech'] : '';
}
export const WHISPER_DIRECTION = 'Whisper throughout with unvoiced breath and quiet, crisp consonants. Keep the reference speaker\'s vocal texture and accent; do not use a normal speaking voice.';
