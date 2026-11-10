// Production SQLite/vector/lore code under Electron's Linux Node ABI, synthetic stores only.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const [appRoot, manifestPath, resultPath] = process.argv.slice(2);
const root = path.resolve(__dirname, '..');
function fixture(domain) {
    const witnesses = JSON.parse(fs.readFileSync(path.join(root, 'tools/native-background-fixtures.json')));
    assert.equal(witnesses.synthetic, true);
    const identity = require(path.join(appRoot, 'dist/main', domain, domain + 'Identity'));
    const { ingredientView } = require(path.join(appRoot, 'dist/main/background/backgroundIngredients'));
    const { passagePlan } = require(path.join(appRoot, 'dist/main/background/sourceReference'));
    const snapshot = () => structuredClone(witnesses[domain]);
    return { snapshot, result() {
        const input = identity[domain + 'Input'](snapshot(), 'en');
        const plan = passagePlan(domain, ingredientView(domain, input.snapshot));
        const court = domain === 'culture' ? plan.passages.find(p => p.kind === 'associated court ideal') : undefined;
        return identity['validate' + (domain === 'culture' ? 'Culture' : 'Faith') + 'Result'](
            { selections: [], ...(court && { court: court.id }) }, input);
    } };
}
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'titan-native-libraries-'));
try {
    assert.equal(process.platform, 'linux'); assert.equal(process.versions.modules, '130');
    const load = name => require(path.join(appRoot, 'dist/main', name));
    const c = fixture('culture'); const f = fixture('faith');
    const { CultureLibrary } = load('culture/CultureLibrary');
    const { cultureInput } = load('culture/cultureIdentity');
    const { FaithLibrary } = load('faith/FaithLibrary');
    const { faithInput } = load('faith/faithIdentity');
    const { MemoryManager } = load('memoryManager');
    for (const [Library, input, snapshot, result, name] of [
        [CultureLibrary, cultureInput, c.snapshot, c.result, 'culture'],
        [FaithLibrary, faithInput, f.snapshot, f.result, 'faith']
    ]) {
        const file = path.join(temp, name + '.sqlite'); let library = new Library(file);
        const hash = library.encounter(input(snapshot(), 'en'), 0);
        const job = library.claim(hash, 0); assert(job);
        library.finish(job, result(), 1); const text = library.ready(hash); assert(text);
        library.close(); library = new Library(file);
        assert.equal(library.encounter(input(snapshot(), 'en'), 2), hash);
        assert.equal(library.ready(hash), text); assert.equal(library.claim(hash, 2), undefined); library.close();
    }
    let memory = new MemoryManager(temp, 3); assert(memory.isVecAvailable());
    assert.deepEqual(memory.getStoredEmbeddingDimensions(), []);
    memory.insertMemory({ id: 'native-test', characterId: 'synthetic', playerId: 'synthetic', text: 'Synthetic persistent memory',
        vector: [1, 0, 0], timestamp: 1, emotion: 'neutral', decay: 0, accessCount: 0, lastAccessed: 1 });
    memory.close(); memory = new MemoryManager(temp, 3);
    assert.equal(memory.getMemory('native-test').text, 'Synthetic persistent memory');
    assert.equal(memory.searchSimilar('synthetic', [1, 0, 0], { topK: 1 })[0].id, 'native-test');
    assert.deepEqual(memory.getStoredEmbeddingDimensions(), [3]);
    // An older differently sized base-table vector must not be hidden by the newest row.
    const Database = require(path.join(appRoot, 'node_modules/better-sqlite3'));
    const fixtureDb = new Database(path.join(temp, 'memory/memories.db'));
    const insert = fixtureDb.prepare('INSERT INTO memories (id, character_id, text, embedding, timestamp) VALUES (?, ?, ?, ?, ?)');
    insert.run('older-dimension', 'synthetic', 'Synthetic dimension fixture', Buffer.from(new Float32Array([1, 0]).buffer), 0);
    insert.run('empty-vector', 'synthetic', 'Synthetic empty-vector fixture', Buffer.alloc(0), 0);
    fixtureDb.close();
    assert.deepEqual(memory.getStoredEmbeddingDimensions(), [2, 3]); memory.close();
    const manifest = JSON.parse(fs.readFileSync(manifestPath));
    const { game, ck3 } = manifest;
    assert.equal(load('culture/cultureCatalog').buildCultureCatalog(game, ck3).digest, manifest.catalog_digest);
    assert.equal(load('faith/faithCatalog').buildFaithCatalog(game, ck3).digest, manifest.faith_catalog_digest);
    const goa = load('goa/goaBridge').buildGoaCaptureCatalog(game, ck3); assert.equal(goa?.digest ?? null, manifest.goa_catalog_digest);
    if (goa) {
        const { resolveGoaLore } = load('goa/goaResolver');
        const base = { version: 1, digest: goa.digest, characterId: 2, sex: 'female', facts: {} };
        assert(resolveGoaLore('Synthetic', { ...base, traitIds: ['creature_sayaadi'] }).text.includes('She is a succubus'));
        assert.equal(resolveGoaLore('Synthetic', { ...base, sex: 'male', traitIds: ['fallen_demon_hunter'] }).identityPolicy, 'fallen_controller');
    }
    const report = { passed: true, platform: process.platform, electron: process.versions.electron,
        abi: process.versions.modules, cultureFaithCacheReopen: true, vectorMemoryReopenAndRetrieval: true,
        storedDimensionCheckEmptyAndMixed: true,
        sameGameCatalogues: true, goaSexAndControllerRules: goa ? true : null };
    fs.writeFileSync(resultPath, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
