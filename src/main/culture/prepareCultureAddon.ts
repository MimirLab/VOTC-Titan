import { buildGoaCaptureCatalog } from '../goa/goaBridge';
import path from 'path';
import { buildFaithCatalog } from '../faith/faithCatalog';
import { buildCultureCatalog } from './cultureCatalog';
import { writeCultureAddon } from './cultureBridge';

// Development CLI writes only to an explicit output directory. It never installs or enables a mod.
if (require.main === module) {
    const [installation, userFolder, destination] = process.argv.slice(2);
    if (!installation || !userFolder || !destination) {
        console.error('Usage: node dist/main/culture/prepareCultureAddon.js <CK3 installation> <CK3 user folder> <output folder>');
        process.exitCode = 1;
    } else {
        try {
            const catalog = buildCultureCatalog(installation, userFolder);
            const faithCatalog = buildFaithCatalog(installation, userFolder);
            writeCultureAddon(catalog, path.resolve(destination), faithCatalog, buildGoaCaptureCatalog(installation, userFolder));
            console.log(`Prepared culture and faith capture addon (${catalog.facts.length} cultural definitions; ${faithCatalog.doctrines.length} doctrines). Enable it alongside VOTC in the matching CK3 playset.`);
        } catch (error) {
            console.error(error instanceof Error ? error.message : 'Could not prepare cultural capture.');
            process.exitCode = 1;
        }
    }
}
