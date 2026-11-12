import { ApiConnection } from '../../shared/apiConnection';
import { generateBackgroundProfile } from '../culture/cultureGeneration';
import { FaithInput, FaithGenerationResult, buildFaithGenerationMessages, faithResponseFormat, validateFaithResult } from './faithIdentity';
import { ingredientView } from '../background/backgroundIngredients';
import { faithReferenceLimits } from '../background/sourceReference';
export function generateFaithProfile(api: ApiConnection, input: FaithInput, signal: AbortSignal): Promise<FaithGenerationResult> {
    const limits = faithReferenceLimits(ingredientView('faith', input.snapshot), text => api.calculateTokensFromText(text));
    return generateBackgroundProfile(api, buildFaithGenerationMessages(input), faithResponseFormat(input), signal,
        response => validateFaithResult(response, input, { maximumTokens: limits.maximumTokens, countTokens: text => api.calculateTokensFromText(text) }), limits.maximumTokens);
}
