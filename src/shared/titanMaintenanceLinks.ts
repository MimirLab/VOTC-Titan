import { shell } from 'electron';
import { localTitanGuide, maintenanceLinks } from './projectMaintenance';
const bind = () => {
    document.querySelectorAll<HTMLAnchorElement>('[data-titan-maintenance]').forEach(link => {
        const kind = link.dataset.titanMaintenance;
        const links = maintenanceLinks();
        const url = kind === 'organization' ? links.organization : kind === 'issues' ? links.issues : links.repository;
        link.href = url ?? '#titan-local-help';
        link.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            if (kind !== 'docs' && url) void shell.openExternal(url);
            else void shell.openPath(localTitanGuide());
        });
    });
};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true });
else bind();
