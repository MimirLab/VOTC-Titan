import path from 'path';

/** Only translate the two CK3 filesystem settings; never touch provider URLs. */
export function ck3RuntimePath(value: string, platform: string = process.platform): string {
    if (platform === 'linux' && /^z:[\\/]/i.test(value)) {
        return value.slice(2).replace(/\\/g, '/');
    }
    if (platform === 'win32' && value.startsWith('/')) {
        return 'Z:' + value.replace(/\//g, '\\');
    }
    return value;
}

/** The override is the root containing votc_data, not votc_data itself. */
export function resolveUserDataRoot(appData: string, legacyName: string, override?: string): string {
    if (!override) return path.join(appData, legacyName);
    if (!path.isAbsolute(override)) throw new Error('VOTC_TITAN_USER_DATA_ROOT must be absolute');
    return path.normalize(override);
}
