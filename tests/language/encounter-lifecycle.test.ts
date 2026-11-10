import fs from 'fs';
import vm from 'vm';
import { EventEmitter } from 'events';
import ts from 'typescript';
import path from 'path';
import { bindEncounterChatWindow } from '../../src/main/conversation/encounterUi';

const file = ts.createSourceFile('main.ts', fs.readFileSync(require.resolve('../../src/main/main'), 'utf8'), ts.ScriptTarget.Latest, true);
function handler(receiver: string, event: string): string {
    let found = '';
    const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
            node.expression.expression.getText(file) === receiver && ['on', 'once'].includes(node.expression.name.text) &&
            ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === event)
            found = node.arguments[1].getText(file);
        ts.forEachChild(node, visit);
    };
    visit(file);
    if (!found) throw new Error('Missing production handler: ' + event);
    return ts.transpileModule('(' + found + ')', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}
function context() {
    const ipcMain = new EventEmitter(), send = jest.fn();
    const chatWindow = { show: jest.fn(), hide: jest.fn(), window: { isDestroyed: () => false, webContents: { send, isDestroyed: () => false } } };
    return vm.createContext({ ipcMain, chatWindow, conversation: null, pendingMessages: [], isConversationReady: true, conversationGeneration: 0,
        pendingChatSetup: undefined, bindEncounterChatWindow, console: { log: jest.fn(), error: jest.fn() } });
}
test('a delayed real message handler never pushes its old input into a replacement encounter', async () => {
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    const old = { prepareMessageIngress: () => wait, pushMessage: jest.fn(), generateAIsMessages: jest.fn() };
    const next = { pushMessage: jest.fn(), generateAIsMessages: jest.fn() };
    const ctx = context(); ctx.conversation = old;
    const callback = vm.runInContext(handler('ipcMain', 'message-send'), ctx);
    const pending = callback({}, { content: 'The old private input.' });
    ctx.conversation = next; ctx.conversationGeneration++;
    release(); await pending;
    expect(next.pushMessage).not.toHaveBeenCalled();
    expect(old.pushMessage).not.toHaveBeenCalled();
});
test.each(['parseLog', 'loadHistory', 'initialize', 'queued-invalid'])('setup boundary %s keeps the current encounter usable without publishing stale data', async phase => {
    let release!: (value?: any) => void;
    const gate = new Promise<any>(resolve => { release = resolve; });
    const ctx = context();
    const snapshot = (marker: string) => ({ playerID: 1, aiID: 2, date: '1066.9.15', marker });
    const old = snapshot('old'), next = snapshot('new');
    let parses = 0;
    const instances: any[] = [];
    class FakeConversation {
        isOpen = true; actions = []; letterManager = { importLettersFromLog: async () => {} };
        constructor(public gameData: any, _config: any, public chatWindow: any) { instances.push(this); chatWindow.conversation = this; }
        retireWithoutGame() { this.isOpen = false; }
        loadHistory() { return phase === 'loadHistory' && this.gameData === old ? gate : Promise.resolve(); }
        initialize() { return ['initialize', 'queued-invalid'].includes(phase) && this.gameData === old ? gate : Promise.resolve(); }
        prepareMessageIngress() { return Promise.resolve(); }
        pushMessage() { throw new Error('Invalid control syntax'); }
        generateAIsMessages() { return Promise.resolve(); }
        calculateBasePromptTokens() { return Promise.resolve(10); }
        getHistory() { return []; }
    }
    Object.assign(ctx, { config: { userFolderPath: '/tmp/not-a-game' }, fs: { existsSync: () => false }, path,
        sleep: async () => {}, parseLog: async () => ++parses === 1 ? phase === 'parseLog' ? gate : old : next,
        currentSessionPlayerId: '1', setCachedGameData: jest.fn(), broadcastCurrentSessionPlayer: jest.fn(), processQueuedApprovals: jest.fn(),
        updateCurrentDate: jest.fn(), Conversation: FakeConversation, votcDataPath: '/tmp/not-userdata', tiktokenEncoder: null,
        sendMemoriesChanged: jest.fn(), setLogPollInterval: jest.fn(), sceneUiState: (_: unknown, actions: unknown) => ({ actions }) });
    const start = vm.runInContext(handler('clipboardListener', 'VOTC:IN'), ctx);
    const ready = () => { const callback = ctx.pendingChatSetup; ctx.ipcMain.removeListener('chat-window-ready', callback); return callback(); };
    await start(); const pending = ready();
    for (let i = 0; i < 16; i++) await Promise.resolve();
    if (phase === 'queued-invalid') {
        ctx.pendingMessages = [{ content: 'Invalid private-control input.' }];
        release(old); await pending;
        expect(ctx.isConversationReady).toBe(true);
        expect(ctx.pendingMessages).toEqual([]);
        expect(ctx.chatWindow.window.webContents.send.mock.calls.some((args: unknown[]) => args[0] === 'generation-finished')).toBe(true);
        return;
    }
    await start(); await ready();
    release(old); await pending;
    expect(ctx.conversation.gameData.marker).toBe('new');
    expect(ctx.isConversationReady).toBe(true);
    const starts = ctx.chatWindow.window.webContents.send.mock.calls.filter((args: unknown[]) => args[0] === 'chat-start');
    expect(starts.every((args: any[]) => args[1].gameData.marker === 'new')).toBe(phase !== 'initialize');
    // At initialize, the old header was legitimately shown before replacement; it never appears afterward.
    expect(starts.at(-1)[1].gameData.marker).toBe('new');
    if (phase !== 'parseLog') expect(instances.find(instance => instance.gameData.marker === 'old').isOpen).toBe(false);
});
test('the real new-chat handler retires its predecessor before replacing the main pointer', async () => {
    const old = { isOpen: true, retireWithoutGame: jest.fn(() => { old.isOpen = false; }) };
    const ctx = context(); ctx.conversation = old;
    await vm.runInContext(handler('clipboardListener', 'VOTC:IN'), ctx)();
    expect(old.retireWithoutGame).toHaveBeenCalledTimes(1);
    expect(old.isOpen).toBe(false);
});
test('repeated starts replace only the owned ready listener, preserving other listeners', async () => {
    const ctx = context(), spectator = jest.fn(); ctx.ipcMain.on('chat-window-ready', spectator);
    const start = vm.runInContext(handler('clipboardListener', 'VOTC:IN'), ctx);
    await start(); await start();
    expect(ctx.ipcMain.listenerCount('chat-window-ready')).toBe(2);
    expect(ctx.ipcMain.listeners('chat-window-ready')).toContain(spectator);
});
test('shared-window sends and hide are owned by the current encounter, with original method receivers', () => {
    let active = true;
    const sent: unknown[] = [];
    const wc: any = { send(...values: unknown[]) { expect(this).toBe(wc); sent.push(values); }, isDestroyed: () => false };
    const window: any = { webContents: wc, getBounds() { expect(this).toBe(window); return { x: 1 }; } };
    const host: any = { window, hide: jest.fn(), conversation: undefined };
    const scoped = bindEncounterChatWindow(host, () => active);
    scoped.conversation = 'current'; expect(host.conversation).toBe('current');
    scoped.window.webContents.send('message-receive', 'Current prose.');
    expect(scoped.window.getBounds()).toEqual({ x: 1 });
    active = false;
    scoped.window.webContents.send('generation-finished'); scoped.hide();
    expect(sent).toEqual([['message-receive', 'Current prose.']]);
    expect(host.hide).not.toHaveBeenCalled();
});
test('an old suggestions callback cannot replace suggestions belonging to the new chat', async () => {
    let release!: (values: string[]) => void;
    const pending = new Promise<string[]>(resolve => { release = resolve; });
    const ctx = context(); ctx.conversation = { generateSuggestions: () => pending };
    const event = { reply: jest.fn() };
    const result = vm.runInContext(handler('ipcMain', 'get-suggestions'), ctx)(event);
    ctx.conversation = {}; ctx.conversationGeneration++;
    release(['Old suggested words.']); await result;
    expect(event.reply).not.toHaveBeenCalled();
});
test('duplicate stop notifications preserve the first close lease, and a new encounter revokes it', async () => {
    const ctx = context(); ctx.setLogPollInterval = jest.fn(); ctx.checkAndDeliverLetters = jest.fn();
    const old = { isOpen: true, gameData: {}, cleanup: jest.fn(), closeEffectAllowed: undefined as undefined | (() => boolean),
        saveHistoryAndTriggerSummarization: jest.fn(async () => { old.isOpen = false; }) };
    ctx.conversation = old;
    const stop = vm.runInContext(handler('ipcMain', 'chat-stop'), ctx);
    stop(); stop();
    expect(old.saveHistoryAndTriggerSummarization).toHaveBeenCalledTimes(1);
    expect(old.closeEffectAllowed!()).toBe(true);
    await vm.runInContext(handler('clipboardListener', 'VOTC:IN'), ctx)();
    expect(old.closeEffectAllowed!()).toBe(false);
});
