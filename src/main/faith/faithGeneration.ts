import { ApiConnection } from '../../shared/apiConnection';
import { generateBackgroundProfile } from '../culture/cultureGeneration';
import { FaithInput, FaithGenerationResult, buildFaithGenerationMessages, faithResponseFormat, validateFaithResult } from './faithIdentity';
export function generateFaithProfile(api: ApiConnection, input: FaithInput, signal: AbortSignal): Promise<FaithGenerationResult> {
    return generateBackgroundProfile(api, buildFaithGenerationMessages(input), faithResponseFormat(input), signal,
        response => validateFaithResult(response, input, { maximumTokens: 500, countTokens: text => api.calculateTokensFromText(text) }), 500);
}
