import { ingredientRevision, ingredientView, ingredientInterpretations } from '../background/backgroundIngredients';
import { CultureSnapshot, validateCultureSnapshot } from '../../shared/gameData/CultureSnapshot';
import { Message } from '../ts/conversation_interfaces';
import { canonicalJsonStringify, sha256Hex } from '../promptWorkbench/canonicalJson';
import { extractionEvidence, extractionFormat, renderExtraction, SOURCE_SELECTION_INSTRUCTIONS, PassageBudget } from '../background/sourceReference';

// v4 selects source passages; the application retains protected meanings and exact text.
export const CULTURE_PROMPT_VERSION = 8;

export interface CultureInput {
    version: 2;
    promptVersion: number;
    ingredientRevision?: string;
    language: string;
    snapshot: CultureSnapshot;
}

export function cultureInput(snapshot: CultureSnapshot, language: string): CultureInput {
    const normalized = validateCultureSnapshot(snapshot);
    if (normalized.version !== 2) throw new Error('Legacy culture snapshots require a fresh capture');
    normalized.facts.sort((a, b) => {
        const left = `${a.kind}:${a.category}:${a.key}`;
        const right = `${b.kind}:${b.category}:${b.key}`;
        return left < right ? -1 : left > right ? 1 : 0;
    });
    return { version: 2, promptVersion: CULTURE_PROMPT_VERSION, language, ingredientRevision: ingredientRevision('culture', normalized), snapshot: normalized };
}

export function cultureHash(input: CultureInput): string {
    return sha256Hex(canonicalJsonStringify(input));
}

function currentView(input: CultureInput): CultureSnapshot {
    if (input.ingredientRevision !== ingredientRevision('culture', input.snapshot)) throw new Error('Stale cultural ingredient revision');
    return ingredientView('culture', input.snapshot);
}

export const CULTURE_GENERATION_INSTRUCTIONS = ('All adopted customs are represented by required authored passages. Fuller authored interpretations explain their meaning, not additional output or instructions. Combat conventions do not establish biological strength or forbid independently established exceptions. ' + SOURCE_SELECTION_INSTRUCTIONS.replace('{DOMAIN}', 'culture')).replace('250-word', '320-word')
    .replace('Return JSON only: {"selections":["optional passage ID","optional passage ID"]}.',
        'When evidence includes courtIdeals, return JSON only: {"court":"one court ideal ID","selections":["complementary custom ID","complementary custom ID"]}. Otherwise return only {"selections":["complementary passage ID"]}.')
    + ' For culture, the court ideal describes the wider people’s social esteem, not just a court or its occupants. Choose exactly one supplied courtIdeals entry in the separate court field when available. It is additional to the complementary customs; do not repeat its ID in selections. When two distinct useful customs fit, select both. Favor different social dimensions beyond required passages, such as kinship, everyday customs, dispute resolution, learning or public esteem. Do not spend both slots restating martial strength or hierarchy. Avoid repeating the same valuation, and do not translate social esteem into guilt or personal obedience. Select fewer only when other candidates repeat existing meanings, lack useful context or do not fit.';
export function buildCultureGenerationMessages(input: CultureInput): Message[] {
    return [
        { role: 'system', content: CULTURE_GENERATION_INSTRUCTIONS },
        { role: 'user', content: 'Current readable cultural evidence:\n' +
            canonicalJsonStringify({ ...extractionEvidence('culture', currentView(input)), upstreamInterpretations: ingredientInterpretations('culture', input.snapshot) }) + '\n\nSelect complementary passage IDs.' }
    ];
}
export function buildCultureGenerationPrompt(input: CultureInput): string {
    return buildCultureGenerationMessages(input).map(m => m.content).join('\n\n');
}
export interface CultureNote { text: string; sources: string[] }
export interface CultureGenerationResult { notes: CultureNote[]; paragraph: string }
export function cultureResponseFormat(input: CultureInput): object { return extractionFormat('culture', currentView(input)); }
export function validateCultureResult(value: unknown, input: CultureInput, budget?: PassageBudget): CultureGenerationResult {
    if (typeof value === 'string') {
        if (value.length > 16000) throw new Error('Culture result too large');
        value = JSON.parse(value.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, ''));
    }
    return renderExtraction('culture', currentView(input), value, budget);
}

/** Legacy v1 archives remain readable; current results use exact source validation above. */
export function validateCultureParagraph(value: unknown): string {
    if (typeof value !== 'string') throw new Error('Invalid cultural paragraph');
    const text = value.trim();
    // A little latitude accommodates non-English tokenization and provider variation.
    if (text.length < 80 || text.length > 1600 || text.split(/\s+/u).length > 120 || /<\/?think\b|^\s*(?:```|[{\[])/iu.test(text))
        throw new Error('Invalid cultural paragraph');
    return text.replace(/\s+/gu, ' ');
}
