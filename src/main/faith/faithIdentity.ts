import { ingredientRevision, ingredientView, ingredientInterpretations } from '../background/backgroundIngredients';
import { FaithSnapshot, validateFaithSnapshot } from '../../shared/gameData/FaithSnapshot';
import { Message } from '../ts/conversation_interfaces';
import { canonicalJsonStringify, sha256Hex } from '../promptWorkbench/canonicalJson';
import { extractionEvidence, extractionFormat, renderExtraction, SOURCE_SELECTION_INSTRUCTIONS, PassageBudget } from '../background/sourceReference';

export const FAITH_PROMPT_VERSION = 7;
export interface FaithInput { domain: 'faith'; version: 1; promptVersion: number; ingredientRevision?: string; language: string; snapshot: FaithSnapshot }
export interface FaithNote { text: string; sources: string[] }
export interface FaithGenerationResult { notes: FaithNote[]; paragraph: string }
export function faithInput(snapshot: FaithSnapshot, language: string): FaithInput {
    const normalized = validateFaithSnapshot(snapshot);
    normalized.facts.sort((a, b) => {
        const left = a.kind + ':' + a.key, right = b.kind + ':' + b.key;
        return left < right ? -1 : left > right ? 1 : 0;
    });
    return { domain: 'faith', version: 1, promptVersion: FAITH_PROMPT_VERSION, language, ingredientRevision: ingredientRevision('faith', normalized), snapshot: normalized };
}
export function faithHash(input: FaithInput): string { return sha256Hex(canonicalJsonStringify(input)); }
export function faithSourceIds(snapshot: FaithSnapshot): string[] { return snapshot.facts.map(f => f.kind + ':' + f.key); }

function currentView(input: FaithInput): FaithSnapshot {
    if (input.ingredientRevision !== ingredientRevision('faith', input.snapshot)) throw new Error('Stale religious ingredient revision');
    return ingredientView('faith', input.snapshot);
}

export const FAITH_GENERATION_INSTRUCTIONS = SOURCE_SELECTION_INSTRUCTIONS.replace('{DOMAIN}', 'faith').replace('250-word', '380-word') + " Further protected teachings, when present, are retained automatically alongside supplied office restrictions. Select complementary meanings without repeating them. Current authored core-tenet names, their complete reviewed meanings and supplied high-god/creator vocabulary are retained automatically. Choose complete passages that explain distinctive meanings or qualifications beyond those labels. Preserve the actual subject, conditions and limits; vocabulary does not establish cosmic fact or personal devotion.";
export function buildFaithGenerationMessages(input: FaithInput): Message[] {
    return [
        { role: 'system', content: FAITH_GENERATION_INSTRUCTIONS },
        { role: 'user', content: 'Current readable religious evidence:\n' +
            canonicalJsonStringify({ ...extractionEvidence('faith', currentView(input)), upstreamInterpretations: ingredientInterpretations('faith', input.snapshot) }) + '\n\nSelect complementary passage IDs.' }
    ];
}
export function faithResponseFormat(input: FaithInput): object { return extractionFormat('faith', currentView(input)); }
export function validateFaithResult(value: unknown, input: FaithInput, budget?: PassageBudget): FaithGenerationResult {
    if (typeof value === 'string') {
        if (value.length > 16000) throw new Error('Faith result too large');
        value = JSON.parse(value.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, ''));
    }
    return renderExtraction('faith', currentView(input), value, budget);
}
