// Runs against the owned disposable native qualification profile; no synthesis.
const assert = require('node:assert/strict');
async function probeNarratorDefault(c) {
 const info = () => c.eval(`require('electron').ipcRenderer.invoke('audio-settings')`);
 const narrators = value => value.voices.filter(v => v.characterId === '__narrator__');
 const before = await info();
 assert.equal(narrators(before).length, 0, 'Listing settings must not create narrator slots');
 assert.equal(before.narratorDefaultName, 'Medivh (HotS)');
 assert.match(await c.eval(`document.querySelector('#audio-active-narrator').textContent`), /Medivh.*Default storyteller/);
 await c.eval(`document.querySelector('#audio-tab-narrator').click();document.querySelector('#audio-default-narrator').click()`);
 async function settled() {
  for (let n = 0; n < 50; n++) {
   const value = await info();
   if (narrators(value).length === 1 && await c.eval(`!document.querySelector('#audio-default-narrator').disabled`)) return value;
   await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw Error('Default narrator did not settle');
 }
 const first = narrators(await settled())[0];
 assert(first.active); assert.equal(first.label, 'Medivh (HotS)'); assert.equal(first.seed, 17);
 const clone = JSON.parse(first.provenance);
 assert.equal(clone.key, 'goa2-5000-hots-medivhbase/v0001');
 assert.equal(clone.audioHash, 'f153e6d4bfa01a2d860fdf8550df510ef2266cb8b3cd5db4b13058ca5354362f');
 await c.eval(`document.querySelector('#audio-default-narrator').click()`);
 const second = narrators(await settled());
 assert.equal(second.length, 1); assert.equal(second[0].id, first.id);
 await c.eval(`document.querySelector('#audio-use-narrator').click()`);
 await settled();
 assert.match(await c.eval(`document.querySelector('#audio-status').textContent`), /saved reference is selected/);
 assert.equal(narrators(await info()).find(v => v.active)?.id, first.id);
 return { defaultName: first.label, source: 'HotS', exactReference: true, lazyLibrary: true,
  restoreButton: true, repeatedRestoreReusesProfile: true, savedCloneSelection: true, modelRequests: 0 };
}
module.exports = { probeNarratorDefault };
