import fs from 'fs';
import os from 'os';
import path from 'path';
import { createHash } from 'crypto';
import { validateLauncherSceneSources } from '../../src/main/scenes/launcherSceneSources';
import { canonicalJsonStringify } from '../../src/main/promptWorkbench/canonicalJson';
import { SCENE_CATALOGUE_DIGEST } from '../../src/shared/scenes/catalogue.generated';

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'titan-scene-sources-')); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
function fixture(): string {
    const goa = path.join(root, 'goa'), ce = path.join(root, 'ce');
    fs.mkdirSync(path.join(goa, 'common/buildings'), { recursive: true });
    fs.mkdirSync(ce); fs.mkdirSync(path.join(root, 'mod'));
    fs.writeFileSync(path.join(goa, 'common/buildings/site.txt'), 'observed = { }');
    fs.writeFileSync(path.join(root, 'mod/goa.mod'), 'path="' + goa + '"\nversion="0.6.5"\nremote_file_id="2949767945"');
    fs.writeFileSync(path.join(root, 'mod/ce.mod'), 'path="' + ce + '"\nremote_file_id="3654567139"');
    fs.writeFileSync(path.join(root, 'dlc_load.json'), JSON.stringify({ enabled_mods: ['mod/goa.mod', 'mod/ce.mod'] }));
    const policy = { format: 'titan_launcher_scenes_v1', mod_version: '0.6.5', historical_calendar_grants: false,
        catalogue_sha256: SCENE_CATALOGUE_DIGEST, source_pins: { 'common/buildings/site.txt': sha('observed = { }') } };
    const file = path.join(root, 'policy.json');
    fs.writeFileSync(file, JSON.stringify({ ...policy, digest: sha(canonicalJsonStringify(policy)) }));
    return file;
}
test('supports unchanged subscribed sources without writing them or adding a mod', () => {
    const file = fixture(), before = fs.readFileSync(path.join(root, 'dlc_load.json'));
    expect(validateLauncherSceneSources(root,file)).toBe(true);
    expect(fs.readFileSync(path.join(root, 'dlc_load.json'))).toEqual(before);
    expect(fs.readdirSync(path.join(root,'mod')).sort()).toEqual(['ce.mod','goa.mod']);
});
test('unsupported or missing sources leave the adapter unavailable', () => {
    const file = fixture();
    fs.writeFileSync(path.join(root, 'mod/goa.mod'), fs.readFileSync(path.join(root, 'mod/goa.mod'),'utf8').replace('0.6.5','0.7'));
    expect(validateLauncherSceneSources(root,file)).toBe(false);
    fs.writeFileSync(path.join(root,'dlc_load.json'),JSON.stringify({enabled_mods:['mod/goa.mod']}));
    expect(validateLauncherSceneSources(root,file)).toBe(false);
});
test.each(['changed source', 'later override', 'later replacement'])('rejects %s rather than interpreting stale scene definitions', mode => {
    const file = fixture();
    if (mode === 'changed source') fs.writeFileSync(path.join(root,'goa/common/buildings/site.txt'),'changed');
    else {
        const folder=path.join(root,'later');fs.mkdirSync(folder);
        fs.writeFileSync(path.join(root,'mod/later.mod'),'path="'+folder+'"\n'+(mode==='later replacement'?'replace_path="common/buildings"':''));
        fs.writeFileSync(path.join(root,'dlc_load.json'),JSON.stringify({enabled_mods:['mod/goa.mod','mod/ce.mod','mod/later.mod']}));
        if(mode==='later override') {
            fs.mkdirSync(path.join(folder,'common/buildings'),{recursive:true});
            fs.writeFileSync(path.join(folder,'common/buildings/site.txt'),'changed');
        }
    }
    expect(()=>validateLauncherSceneSources(root,file)).toThrow();
});
