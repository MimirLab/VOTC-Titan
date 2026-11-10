import { cultureReferenceLimits } from '../background/sourceReference';
import { ingredientView } from '../background/backgroundIngredients';
import { ApiConnection } from '../../shared/apiConnection';
import { CultureInput, CultureGenerationResult, buildCultureGenerationMessages, cultureResponseFormat, validateCultureResult } from './cultureIdentity';
import { sha256Hex } from '../promptWorkbench/canonicalJson';
import { Message } from '../ts/conversation_interfaces';

const capabilities = new Map<string, { expires: number; context?: number; schemaUnsupported?: boolean }>();
export function isUnsupportedCultureSchema(error: unknown): boolean {
    const e = error as { status?: number; code?: number; message?: string; error?: { message?: string } };
    return [400, 422].includes(e?.status ?? e?.code ?? 0) &&
        /response_format|json_schema|structured.?outputs/i.test(e.message ?? e.error?.message ?? '') &&
        /unsupported|not supported|not allowed|unknown|unrecognized|extra inputs|not permitted/i.test(e.message ?? e.error?.message ?? '');
}

/** A separate instance: neither normal chat budgets nor saved settings are changed. */
export async function generateCultureProfile(api: ApiConnection, input: CultureInput, signal: AbortSignal): Promise<CultureGenerationResult> {
    const limits = cultureReferenceLimits(ingredientView('culture', input.snapshot), text => api.calculateTokensFromText(text));
    if (limits.neededWords > limits.maximumWords || limits.neededTokens > limits.maximumTokens) throw new Error('Protected cultural meanings exceed bounded guidance capacity');
    return generateBackgroundProfile(api, buildCultureGenerationMessages(input), cultureResponseFormat(input), signal,
        response => validateCultureResult(response, input, { maximumTokens: limits.maximumTokens, countTokens: text => api.calculateTokensFromText(text) }), limits.maximumTokens);
}

/** Shared provider capabilities/budgets; domain prompts, identities and validators remain separate. */
export async function generateBackgroundProfile<T extends { paragraph: string }>(
    api: ApiConnection, messages: Message[], responseFormat: object, signal: AbortSignal, validate: (response: unknown) => T, guidanceTokenLimit = 400
): Promise<T> {
    const key = sha256Hex(JSON.stringify([api.config?.baseUrl, api.model, api.config?.key, !!api.config?.overwriteContext]));
    let capability = capabilities.get(key);
    if (!capability || capability.expires < Date.now()) {
        capability = { expires: Date.now() + 600_000 };
        capabilities.set(key, capability);
        if (api.type === 'custom' && api.overwriteWarning && !api.config.overwriteContext && api.client?.models?.list) {
            try {
                const metadataSignal = AbortSignal.any([signal, AbortSignal.timeout(5000)]);
                const listing = await api.client.models.list({ signal: metadataSignal, timeout: 5000, maxRetries: 0 });
                const length = listing.data?.find((m: any) => m.id === api.model)?.max_model_len;
                if (Number.isSafeInteger(length) && length >= 1024 && length <= 2_097_152) capability.context = length;
            } catch { /* Model metadata is optional; retain the configured context. */ }
        }
    }
    if (signal.aborted) throw new Error('Interrupted cultural generation');
    if (!api.config?.overwriteContext && api.overwriteWarning && capability.context) api.context = capability.context;
    const inputTokens = api.calculateTokensFromText(messages.map(m => m.content).join('\n\n'));
    const outputBudget = Math.min(8192, api.context - inputTokens - 128);
    if (outputBudget < 1024) throw new Error('Cultural facts exceed provider context');
    const supportsSchema = ['custom', 'openai', 'openrouter', 'nvidia', 'grok', 'deepseek'].includes(api.type) && api.isChat();
    const complete = (schema: boolean) => api.complete(messages, false, {
        max_tokens: outputBudget, ...(schema ? { response_format: responseFormat } : {})
    }, undefined, signal, 120_000);
    let response: unknown;
    try { response = await complete(supportsSchema && !capability.schemaUnsupported); }
    catch (error) {
        if (!supportsSchema || capability.schemaUnsupported || signal.aborted || !isUnsupportedCultureSchema(error)) throw error;
        capability.schemaUnsupported = true;
        response = await complete(false);
    }
    const result = validate(response);
    if (api.calculateTokensFromText(result.paragraph) > guidanceTokenLimit) throw new Error('Cultural guidance is too long');
    return result;
}
