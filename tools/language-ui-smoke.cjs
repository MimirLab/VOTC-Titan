const assert = require('node:assert/strict');
exports.probeLanguages = async (renderer, main) => {
    assert(await main.eval(`process.mainModule.require('electron').app.getPath('userData').includes('votc-native-verification-')`));
    const info = await renderer.eval(`(() => { const element=document.querySelector('config-checkbox[confid="languageRoutingEnabled"]');
        const input=element?.shadowRoot?.querySelector('input'); const label=element?.shadowRoot?.querySelector('label');
        return {present:!!input, checked:input?.checked, label:label?.textContent, visible:element?.getBoundingClientRect().height>0}; })()`);
    assert(info.present && info.visible); assert.equal(info.label, 'Roleplay Languages'); assert.equal(info.checked, true);
    for (const expected of [false, true]) {
        await renderer.eval(`document.querySelector('config-checkbox[confid="languageRoutingEnabled"]').shadowRoot.querySelector('label').click()`);
        let actual;
        for (let attempt=0;attempt<30;attempt++) {
            actual=await main.eval(`(() => { const e=process.mainModule.require('electron'),fs=process.mainModule.require('fs'),path=process.mainModule.require('path');
                return JSON.parse(fs.readFileSync(path.join(e.app.getPath('userData'),'votc_data/configs/config.json'))).languageRoutingEnabled; })()`);
            if(actual===expected)break;
            await new Promise(resolve=>setTimeout(resolve,100));
        }
        assert.equal(actual,expected);
        assert.equal(await renderer.eval(`(async()=> (await require('electron').ipcRenderer.invoke('get-config')).languageRoutingEnabled)()`),expected);
    }
    return { visible:true, labelClickable:true, defaultEnabled:true, offAndOnPersisted:true, syntheticOnly:true };
};
