import path from 'path';
import { APP_DISPLAY_NAME } from './appIdentity';

const metadata = require('../../package.json');
export const TITAN_ORGANIZATION_URL = 'https://github.com/MimirLab';
export const CE_WORKSHOP_URL = 'https://steamcommunity.com/sharedfiles/filedetails/?id=3654567139';

export function maintenanceLinks(value: unknown = metadata.titanMaintenance): { organization: string; repository?: string; issues?: string } {
    const candidate = value && typeof value === 'object' ? (value as Record<string, unknown>).repositoryUrl : undefined;
    const repository = typeof candidate === 'string' && /^https:\/\/github\.com\/MimirLab\/[A-Za-z0-9_.-]+\/?$/.test(candidate) ?
        candidate.replace(/\/$/, '').replace(/\.git$/, '') : undefined;
    return { organization: TITAN_ORGANIZATION_URL, repository, issues: repository ? repository + '/issues' : undefined };
}
export function titanProviderHeaders(value?: unknown): Record<string, string> {
    const links = maintenanceLinks(value);
    return { 'HTTP-Referer': links.repository ?? links.organization, 'X-Title': APP_DISPLAY_NAME };
}
export function localTitanGuide(): string {
    return path.resolve(__dirname, '../../docs/launcher-only-installation.md');
}
