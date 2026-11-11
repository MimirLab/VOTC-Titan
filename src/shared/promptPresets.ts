/** Accept the original flat preset file without rewriting or losing scoped presets. */
export function normalizePromptPresets(value: unknown): Record<string, any> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { global: {} };
    const source = value as Record<string, any>;
    const scoped: Record<string, any> = { global: {} };
    for (const [name, item] of Object.entries(source)) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        if (Object.values(item).some(field => typeof field === 'string')) scoped.global[name] = item;
        else scoped[name] = { ...(scoped[name] ?? {}), ...item };
    }
    return scoped;
}
