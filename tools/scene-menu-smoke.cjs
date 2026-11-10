// Probe the actual chat renderer with production scene options and disposable data.
// No conversation/model generation or game effect is started by this fixture.
const assert = require('assert/strict');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function probeSceneMenu(renderer, main) {
  const expected = ['titan_farraki_court', 'titan_region_tanaris_white_gold_dune_country'];
  const produced = await main.eval(`(() => {
    const e = process.mainModule.require('electron'), root = e.app.getAppPath();
    const load = p => process.mainModule.require(root + '/' + p);
    const {GameData} = load('dist/shared/gameData/GameData.js');
    const {Character} = load('dist/shared/gameData/Character.js');
    const {applySceneSnapshot, actionForScene} = load('dist/main/scenes/sceneRuntime.js');
    const {SCENE_CATALOGUE_DIGEST} = load('dist/shared/scenes/catalogue.generated.js');
    const game = new GameData(['1','Test player','2','Test visitor','600.1.1',
      'talk_scene_titan_farraki_court',"Zul'Farrak",'Test controller','0']);
    for (const [id,name,pronoun] of [[1,'Test player','he'],[2,'Test visitor','she']]) {
      const row = Array(27).fill(''); row[0] = String(id); row[1] = row[2] = name; row[4] = pronoun;
      game.characters.set(id, new Character(row));
    }
    applySceneSnapshot(game, {schema:1,catalogue:SCENE_CATALOGUE_DIGEST,mode:'goa',anchorId:1,
      selected:'titan_farraki_court',location:"Zul'Farrak",controller:'Test controller',
      terrain:'desert',style:'zulian',culture:'farraki',provinceId:1591,regions:['tanaris'],settled:true,coastal:false,riverside:false,
      worldStates:[],eligible:${JSON.stringify(expected)}});
    const action = actionForScene(load('default_userdata/scripts/actions/standard/changeLocation.js'), game);
    const chat = e.BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('chatWindow/chat.html'));
    global.titanSceneMenuFixture = {game,chat};
    chat.webContents.send('chat-start', {gameData:game,messages:[],narratives:[],historicalMetadata:[],
      actions:[{signature:action.signature,args:action.args,description:action.description,
        usesSource:false,usesTarget:false}],basePromptTokens:0});
    chat.webContents.send('chat-ready');
    return action.args[0].options.map(o => o.value);
  })()`);
  assert.deepEqual(produced, expected, 'Production action options must include both live-valid venues');
  await pause(700);
  const headerBefore = await renderer.eval('document.querySelector(".current-conversation-header").textContent');
  assert(headerBefore.includes('Scene: Sandstone Audience Court'));
  assert(!headerBefore.includes('titan_'), 'Chat header must use a readable scene name');
  const click = async selector => {
    const point = await renderer.eval(`(() => {
      const n = document.querySelector(${JSON.stringify(selector)}); if (!n) throw Error('Missing control');
      n.scrollIntoView({block:'nearest'}); const r = n.getBoundingClientRect();
      return {x:r.x+r.width/2,y:r.y+r.height/2};
    })()`);
    await renderer.call('Input.dispatchMouseEvent', {type:'mousePressed',button:'left',clickCount:1,...point});
    await renderer.call('Input.dispatchMouseEvent', {type:'mouseReleased',button:'left',clickCount:1,...point});
    await pause(120);
  };
  await renderer.eval(`(() => {
    const input = document.querySelector('.chat-input'); input.value = '/changeLocation';
    input.dispatchEvent(new Event('input', {bubbles:true}));
  })()`);
  await click('.slash-command-item[data-signature="changeLocation"]');
  const visibleList = await renderer.eval(`!!document.querySelector('.inline-action-form .scene-venue-select')`);
  if (!visibleList) await click('.inline-action-form .action-arg .custom-select-value');
  const opened = await renderer.eval(`(() => {
    const form = document.querySelector('.inline-action-form');
    const list = form.querySelector('.scene-venue-select') || form.querySelector('.action-arg .custom-select-options');
    return {kind:list.tagName,display:getComputedStyle(list).display,size:list.size,
      options:[...list.children].map(n => {
        const r = n.getBoundingClientRect(), hit = document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
        return {value:n.value || n.dataset.value,label:n.textContent,
          hit:r.width>0 && r.height>0 && (hit===n || hit===list)};
      })};
  })()`);
  assert.notEqual(opened.display, 'none', 'Venue choices must be visible');
  if (visibleList) assert(opened.size>=2, 'The venue list must expose both choices without a popup');
  assert.deepEqual(opened.options.map(o => o.value), expected);
  assert(opened.options.every(o => o.hit), 'Every venue option must receive clicks in the visible form');
  await click(visibleList ? '.scene-venue-select option[value="titan_region_tanaris_white_gold_dune_country"]' : '.inline-action-form [data-value="titan_region_tanaris_white_gold_dune_country"]');
  const selected = await renderer.eval(`(() => {
    const form = document.querySelector('.inline-action-form');
    const select = form.querySelector('.scene-venue-select');
    return select ? {value:select.value,label:select.selectedOptions[0].textContent} :
      {value:form.querySelector('.action-arg input').value,
        label:form.querySelector('.action-arg .custom-select-value').textContent};
  })()`);
  assert.equal(selected.value, 'titan_region_tanaris_white_gold_dune_country', 'Clicking the regional desert must select that venue');
  // Inspect the submitted IPC arguments without handing them to main/game code.
  await renderer.eval(`(() => {
    const ipc = require('electron').ipcRenderer, original = ipc.send;
    window.titanMenuProbe = {original};
    ipc.send = function(channel, ...args) {
      if (channel === 'execute-action') { window.titanMenuProbe.submitted = args; return; }
      return original.call(this, channel, ...args);
    };
  })()`);
  try {
    await click('.inline-action-form .action-execute-button');
    const submitted = await renderer.eval('window.titanMenuProbe.submitted');
    assert.deepEqual(submitted, ['changeLocation', [null, null, 'titan_region_tanaris_white_gold_dune_country']]);
    await main.eval(`(() => {
      const root = process.mainModule.require('electron').app.getAppPath();
      const {applySceneSnapshot,sceneUiState} = process.mainModule.require(root+'/dist/main/scenes/sceneRuntime.js');
      const {game,chat} = global.titanSceneMenuFixture;
      applySceneSnapshot(game, {...game.sceneSnapshot,selected:'titan_region_tanaris_white_gold_dune_country'});
      const action = process.mainModule.require(root+'/default_userdata/scripts/actions/standard/changeLocation.js');
      chat.webContents.send('scene-context-update',sceneUiState(game,[action]));
    })()`);
    await pause(150);
    const headerAfter = await renderer.eval('document.querySelector(".current-conversation-header").textContent');
    assert(headerAfter.includes("Location: Zul'Farrak") && headerAfter.includes('Scene: White-Gold Dunes'));
    assert(!headerAfter.includes('titan_'));
    return {productionOptions:produced,opened,selected,submitted,headerBefore,headerAfter,
      modelRequests:0,gameEffects:0,passed:true};
  } finally {
    await renderer.eval(`require('electron').ipcRenderer.send = window.titanMenuProbe.original; delete window.titanMenuProbe;`);
  }
}

async function probeSceneRefresh(main) {
  return main.eval(`(async () => {
    const root = process.mainModule.require('electron').app.getAppPath(), load = p => process.mainModule.require(root+'/'+p);
    const builder = load('dist/main/conversation/sceneDescriptionBuilder.js');
    const original = builder.generateSceneDescription;
    const {Conversation} = load('dist/main/conversation/Conversation.js');
    const {applySceneSnapshot} = load('dist/main/scenes/sceneRuntime.js');
    const {game,chat} = global.titanSceneMenuFixture;
    applySceneSnapshot(game,{...game.sceneSnapshot,selected:'titan_farraki_court'});
    const scenes = [], events = [];
    const conv = Object.assign(Object.create(Conversation.prototype), {isOpen:true,gameData:game,actions:[],
      config:{autoGenerateSuggestions:false},messages:[],isGenerating:false,isGeneratingScene:false,
      abortController:null,sceneRefreshPending:false,sceneRequestAbort:null,pendingPlayerRequest:false,
      encounterLifetime:new AbortController(),encounterCapture:Promise.resolve(true),
      chatWindow:{window:{webContents:{send:(...args)=>events.push(args)}}}});
    let oldSignal;
    builder.generateSceneDescription = (c,signal) => {
      scenes.push(c.gameData.scene);
      if(scenes.length===1){oldSignal=signal;return new Promise((resolve,reject)=>signal.addEventListener('abort',
        ()=>reject(new DOMException('Superseded','AbortError')),{once:true}));}
      return Promise.resolve('Synthetic desert narration after the confirmed switch.');
    };
    let job;
    try {
      job=conv.generateSceneDescription(true);
      for(let i=0;i<12;i++)await Promise.resolve();
      if(scenes.length!==1)throw Error('Initial narration did not start');
      applySceneSnapshot(game,{...game.sceneSnapshot,selected:'titan_region_tanaris_white_gold_dune_country'});
      conv.sceneContextChanged();
      if(!oldSignal.aborted)throw Error('Stale intro request was not interrupted');
      await job;
      const published=events.filter(e=>e[0]==='scene-description'&&e[1]).map(e=>e[1].content);
      if(JSON.stringify(scenes)!==JSON.stringify(['titan_farraki_court','titan_region_tanaris_white_gold_dune_country'])||published.length!==1||
        !published[0].includes('desert'))throw Error('Confirmed venue did not get fresh narration');
      return {scenes,published:published.length,staleIntroAborted:true,locksReleased:!conv.isGenerating&&!conv.isGeneratingScene,
        modelRequests:0,passed:true};
    } finally {
      conv.cancelGeneration();if(job)await job.catch(()=>{});builder.generateSceneDescription=original;
      delete global.titanSceneMenuFixture;
    }
  })()`);
}

module.exports = {probeSceneMenu,probeSceneRefresh};
