import { shell } from 'electron';
import { localTitanGuide, maintenanceLinks } from '../shared/projectMaintenance';
export function openTitanHelp(): Promise<unknown> {
    const issues = maintenanceLinks().issues;
    return issues ? shell.openExternal(issues) : shell.openPath(localTitanGuide());
}
