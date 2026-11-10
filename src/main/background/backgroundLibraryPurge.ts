export type BackgroundDomain = 'culture' | 'faith';
export interface BackgroundPurgeResult { success: boolean; canceled?: boolean; message: string }

/** Confirmation precedes all mutation; only the requested generated library is cleared. */
export async function requestBackgroundLibraryPurge(
    domain: unknown,
    confirm: (domain: BackgroundDomain) => Promise<boolean>,
    clear: Record<BackgroundDomain, () => Promise<number>>
): Promise<BackgroundPurgeResult> {
    if (domain !== 'culture' && domain !== 'faith')
        return { success: false, message: 'Choose the culture or faith library.' };
    const label = domain === 'culture' ? 'culture' : 'faith';
    try {
        if (!await confirm(domain)) return { success: false, canceled: true, message: 'Library unchanged.' };
        const removed = await clear[domain]();
        return { success: true, message: `Cleared ${removed} saved ${label} profile${removed === 1 ? '' : 's'}. Profiles will regenerate when needed again.` };
    } catch {
        return { success: false, message: `Could not clear the ${label} library. Please try again.` };
    }
}
