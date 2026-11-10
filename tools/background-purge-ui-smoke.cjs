// Runs only inside verify-native's disposable application/userdata, never the live store.
const assert = require('assert/strict');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
exports.probeBackgroundPurge = async (renderer, main) => {
    await main.eval(`(() => {
        const e = process.mainModule.require('electron');
        const fs = process.mainModule.require('fs'), path = process.mainModule.require('path');
        const data = e.app.getPath('userData');
        if (!data.includes('votc-native-verification-')) throw Error('Purge probe requires disposable userdata');
        const Database = process.mainModule.require('better-sqlite3');
        globalThis.purgeProbe = { original: e.dialog.showMessageBox, calls: [], response: 1, waiting: false, data };
        for (const [dir, file, table] of [['culture','cultures.sqlite','culture_profiles'], ['religion','faiths.sqlite','faith_profiles']]) {
            const db = new Database(path.join(data, 'votc_data', dir, file));
            if (db.prepare('SELECT COUNT(*) AS n FROM '+table).get().n) throw Error('Expected empty disposable library');
            db.prepare('INSERT INTO '+table+' (hash,input_json,status,paragraph,created_at,updated_at) VALUES (?,?,?,?,0,0)')
                .run('synthetic-purge-fixture', '{}', 'ready', 'Synthetic cached text'); db.close();
        }
        const fileHashes = () => {
            const crypto = process.mainModule.require('crypto'), output = {};
            const walk = dir => { for (const item of fs.readdirSync(dir, {withFileTypes:true})) {
                const file = path.join(dir,item.name), relative = path.relative(data,file);
                if (relative === 'votc_data/culture' || relative === 'votc_data/religion') continue;
                if (item.isDirectory()) walk(file);
                else if (['configs','memories','conversation_summaries','conversation_history','scripts']
                    .some(part=>relative.startsWith('votc_data/'+part+'/')) || relative.endsWith('.sqlite'))
                    output[relative] = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
            }}; walk(data); return output;
        };
        purgeProbe.fileHashes = fileHashes; purgeProbe.before = fileHashes();
        e.dialog.showMessageBox = async (_window, options) => {
            purgeProbe.calls.push(options);
            if (purgeProbe.waiting) return new Promise(resolve => { purgeProbe.resolve = resolve; });
            return { response: purgeProbe.response };
        };
    })()`);
    const counts = () => main.eval(`(() => {
        const Database = process.mainModule.require('better-sqlite3'), path = process.mainModule.require('path');
        const result = {};
        for (const [key,dir,file,table] of [['culture','culture','cultures.sqlite','culture_profiles'],['faith','religion','faiths.sqlite','faith_profiles']]) {
            const db = new Database(path.join(purgeProbe.data,'votc_data',dir,file));
            result[key] = db.prepare('SELECT COUNT(*) AS n FROM '+table).get().n; db.close();
        } return result;
    })()`);
    const waitMessage = async text => {
        for (let attempt = 0; attempt < 40; attempt++) {
            if (await renderer.eval(`document.querySelector('#background-clear-status').textContent.includes(${JSON.stringify(text)})`)) return;
            await pause(50);
        }
        throw Error('No purge result: '+text);
    };
    try {
        const controls = await renderer.eval(`['culture','faith'].map(d=>({text:document.querySelector('#clear-'+d+'-library').textContent,disabled:document.querySelector('#clear-'+d+'-library').disabled}))`);
        assert.deepEqual(controls.map(c=>c.text), ['Clear culture library','Clear faith library']);
        assert(controls.every(c=>!c.disabled));
        const invalid = await renderer.eval(`require('electron').ipcRenderer.invoke('clear-background-library','../memories')`);
        assert.equal(invalid.success,false);
        const foreign = await main.eval(`process.mainModule.require('electron').BrowserWindow.getAllWindows()
            .find(w=>w.webContents.getURL().endsWith('chatWindow/chat.html')).webContents.executeJavaScript(
            "require('electron').ipcRenderer.invoke('clear-background-library','culture')")`);
        assert.equal(foreign.success,false);
        await renderer.eval(`document.querySelector('#clear-culture-library').click()`);
        await waitMessage('Library unchanged.');
        assert.deepEqual(await counts(), {culture:1,faith:1});
        const confirmation = await main.eval(`purgeProbe.calls[0]`);
        assert.equal(confirmation.defaultId,1); assert.equal(confirmation.cancelId,1);
        assert(confirmation.detail.includes('older recipe versions') && confirmation.detail.includes('all campaigns'));
        await main.eval(`purgeProbe.waiting=true`);
        await renderer.eval(`document.querySelector('#clear-culture-library').click()`);
        await pause(80);
        assert(await renderer.eval(`document.querySelector('#clear-culture-library').disabled && document.querySelector('#clear-faith-library').disabled`));
        await main.eval(`purgeProbe.resolve({response:0});purgeProbe.waiting=false;purgeProbe.response=0`);
        await waitMessage('Cleared 1 saved culture profile.');
        assert.deepEqual(await counts(), {culture:0,faith:1});
        assert(await renderer.eval(`document.querySelector('#culture-status').textContent.includes('0 ready, 0 pending, 0 awaiting retry.')`));
        await renderer.eval(`document.querySelector('#clear-faith-library').click()`);
        await waitMessage('Cleared 1 saved faith profile.');
        assert.deepEqual(await counts(), {culture:0,faith:0});
        assert(await renderer.eval(`document.querySelector('#faith-status').textContent.includes('0 ready, 0 pending, 0 awaiting retry.')`));
        assert(await main.eval(`JSON.stringify(purgeProbe.before) === JSON.stringify(purgeProbe.fileHashes())`));
        assert(await renderer.eval(`!document.querySelector('#clear-culture-library').disabled && !document.querySelector('#clear-faith-library').disabled`));
        return { passed:true, syntheticOnly:true, canceledPreservesProfiles:true, separateLibraries:true,
            cancelDefault:true, buttonsDisabledWhileAwaitingConfirmation:true, countsRefresh:true,
            settingsMemoriesConversationsScriptsPreserved:true, invalidDomainRejected:true, nonSettingsWindowRejected:true, modelRequests:0 };
    } finally {
        await main.eval(`process.mainModule.require('electron').dialog.showMessageBox=purgeProbe.original;delete globalThis.purgeProbe`);
    }
};
