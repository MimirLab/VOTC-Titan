import path from 'path';
import { GameData } from '../src/shared/gameData/GameData';
import type { GoaSnapshot } from '../src/shared/gameData/GoaSnapshot';
import { character } from './culture/fixtures';
import { formatActionNotice } from '../src/main/conversation/actionNotice';
import { characterPronounVariables } from '../src/shared/characterPronouns';
import { getVerifiedGoaSnapshot } from '../src/main/goa/goaRuntime';
import { checkActions } from '../src/main/conversation/checkActions';
import { Conversation } from '../src/main/conversation/Conversation';

jest.mock('../src/main/goa/goaRuntime', () => ({
    getVerifiedGoaSnapshot: jest.fn(),
    composeGoaContext: (description: string) => ({ description }),
    finishGoaContext: (text: string) => text
}));
jest.mock('../src/main/conversation/promptBuilder', () => ({
    getEffectivePrompts: () => ({ actionPrompt: '' }), convertMessagesToString: () => ''
}));
jest.mock('../default_userdata/scripts/prompts/description/standard/pList.js', () => () => '');
jest.mock('../src/main/conversation/ActionEffectWriter', () => ({ ActionEffectWriter: { appendEffect: jest.fn() } }));
jest.mock('../src/main/compactedMemoryStore', () => ({ compactedMemoryStore: {} }));

let game: GameData;
const moduleFor = (name: string) => require(`../default_userdata/scripts/actions/standard/${name}.js`);
const render = (name: string, args: string[] = [], source = 1, target = 2, language = 'en') =>
    formatActionNotice(moduleFor(name), args, game, source, target, language);
beforeEach(() => {
    (getVerifiedGoaSnapshot as jest.Mock).mockReset();
    game = new GameData(['1', 'Arthas', '2', 'Aegwynn', '1066.9.15', 'votc_scene_council', 'Synthetic county', 'Arthas', '0']);
    game.characters.set(1, character(1, 'Arthas'));
    const female = character(2, 'Aegwynn'); female.sheHe = 'she'; game.characters.set(2, female);
    game.character1Name = 'Old source'; game.character2Name = 'Old target';
    jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test.each([
    ['addPrestige', 'honor_minor', 'Arthas honored Aegwynn, raising her prestige.'],
    ['addPrestige', 'humiliate_minor', 'Arthas humiliated Aegwynn, costing her prestige.'],
    ['addPiety', 'bless_minor', 'Arthas blessed Aegwynn, granting her piety.'],
    ['addPiety', 'shame_minor', 'Arthas shamed Aegwynn, costing her piety.'],
    ['changeStress', 'soothe_minor', 'Arthas soothed Aegwynn, easing her stress.'],
    ['changeStress', 'rattle_minor', 'Arthas rattled Aegwynn, unsettling her.'],
    ['inviteToCourt', '', 'Arthas invited Aegwynn to his court.'],
    ['removeHook', '', 'Arthas forgave the hook he held on Aegwynn.'],
    ['promoteCulture', '', "Arthas championed his culture in Aegwynn's capital county."],
    ['addDread', 'reassure_minor', 'Arthas reassured Aegwynn, reducing his dread.'],
    ['addDynastyPrestige', 'humiliate_minor', "Arthas humiliated Aegwynn's dynasty, costing the dynasty prestige."],
    ['changeCulture', '', "Aegwynn adopted his culture under Arthas's influence."]
])('%s binds its notice to the actual effect owner (%s)', (name, arg, expected) => {
    expect(render(name, arg ? [arg] : [])).toBe(expected);
    expect(game.character1Name).toBe('Old source'); expect(game.character2Name).toBe('Old target');
    expect('character1Possessive' in game).toBe(false);
});

test('reverse, same-sex and self-directed actions do not inherit another character’s pronouns', () => {
    expect(render('inviteToCourt', [], 2, 1)).toBe('Aegwynn invited Arthas to her court.');
    expect(render('changeStress', ['soothe_minor'], 2, 1)).toBe('Aegwynn soothed Arthas, easing his stress.');
    expect(render('addPrestige', ['honor_minor'], 1, 1)).toBe('Arthas honored Arthas, raising his prestige.');
    game.characters.get(1)!.sheHe = 'she';
    expect(render('changeStress', ['soothe_minor'])).toBe('Arthas soothed Aegwynn, easing her stress.');
});

test('unknown sex and missing participants use neutral fallback without stale stored snapshots', () => {
    const target = game.characters.get(2)!;
    target.sheHe = ''; target.sex = 'female';
    target.goaSnapshot = snapshot(['creature_voidwalker'], { sex: 'male' });
    expect(render('changeStress', ['soothe_minor'])).toBe('Arthas soothed Aegwynn, easing their stress.');
    expect(render('changeStress', ['rattle_minor'], 1, 99)).toBe('Arthas rattled someone, unsettling them.');
});

function snapshot(traitIds: string[], extra: Partial<GoaSnapshot> = {}): GoaSnapshot {
    return { version: 1, digest: 'a'.repeat(64), characterId: 2, sex: 'female', traitIds, facts: {}, ...extra };
}

test('scene notices use readable catalogue names while custom templates still receive canonical IDs', () => {
    expect(render('changeLocation', ['titan_desert'])).toBe('Scene changed to Open Desert');
    const template = jest.fn((args: string[]) => ({ en: `Selected ${args[0]}` }));
    expect(formatActionNotice({ signature: 'changeLocation', chatMessage: template }, ['titan_farraki_court'],
        game, 1, 2, 'en')).toBe('Selected Sandstone Audience Court');
    expect(template).toHaveBeenCalledWith(['titan_farraki_court']);
});
test.each([
    [['creature_voidwalker'], {}, 'their'],
    [['creature_voidwalker', 'cat_form'], {}, 'her'],
    [['creature_voidwalker'], { currentBody: 'creature_human' }, 'her'],
    [['creature_elemental', 'being_demon', 'being_undead'], {}, 'her'],
    [['creature_sayaadi'], { currentBody: 'creature_sayaadi', sexlessBody: true }, 'her'],
    [['creature_dryad'], { currentBody: 'creature_dryad', sexlessBody: true, sex: 'male' }, 'his'],
    [['creature_elemental'], { currentBody: 'creature_elemental', sexlessBody: true }, 'their']
] as [string[], Partial<GoaSnapshot>, string][])('verified current-body policy for %s (%s)', (ids, extra, possessive) => {
    (getVerifiedGoaSnapshot as jest.Mock).mockImplementation(c => c.id === 2 ? snapshot(ids, extra) : undefined);
    expect(render('changeStress', ['soothe_minor'])).toBe(`Arthas soothed Aegwynn, easing ${possessive} stress.`);
});

test('legacy/custom templates, localization fallback and explicit culture choices still resolve', () => {
    const custom = { chatMessage: () => ({ en: '{{character1Name}} greeted {{character2Name}}; {{character2Reflexive}}; {{playerName}}.' }) };
    expect(formatActionNotice(custom, [], game, 1, 2, 'missing')).toBe('Arthas greeted Aegwynn; herself; Arthas.');
    expect(formatActionNotice({ chatMessage: () => '{{character1Name}} rested {{character1Reflexive}}.' }, [], game, 1, 1, 'en'))
        .toBe('Arthas rested himself.');
    expect(render('changeStress', ['soothe_minor'], 1, 2, 'fr')).toBe(moduleFor('changeStress').chatMessage(['soothe_minor']).fr
        .replace('{{character1Name}}', 'Arthas').replace('{{character2Name}}', 'Aegwynn'));
    expect(render('changeCulture', ['', 'custom_culture'])).toBe("Aegwynn adopted the custom_culture culture under Arthas's influence.");
});

test('archived letter participants can resolve the new placeholders without a main-process lookup', () => {
    const template = moduleFor('changeStress').chatMessage(['soothe_minor']).en;
    const vars = { character1Name: 'Arthas', character2Name: 'Aegwynn',
        ...characterPronounVariables('character1', 'he'), ...characterPronounVariables('character2', 'she') };
    expect(template.replace(/{{([^}]+)}}/g, (_: string, key: string) => vars[key as keyof typeof vars]))
        .toBe('Arthas soothed Aegwynn, easing her stress.');
});

function conversation(actionName: string, response: string, manual = false): any {
    return Object.assign(Object.create(Conversation.prototype), {
        config: { language: 'en', selectedDescScript: 'standard/pList.js', manualActionApproval: manual },
        gameData: game, votcDataPath: path.resolve('default_userdata'), actions: [moduleFor(actionName)],
        messages: [{ id: 'reply', role: 'assistant', name: 'Aegwynn', content: 'A synthetic reply.' }],
        actionsApiConnection: { isChat: () => true, complete: jest.fn().mockResolvedValue(response) },
        chatWindow: { window: { webContents: { send: jest.fn() } } },
        runFileManager: { append: jest.fn() }, currentTurnTriggeredActions: new Set(),
        pendingActions: new Map(), executedActions: new Map()
    });
}
test.each([false, true])('real action/approval path uses returned IDs rather than the starting speaker (manual=%s)', async manual => {
    const conv = conversation('changeStress', '<rationale>Comfort.</rationale><actions>changeStress(2,1,soothe_minor)</actions>', manual);
    const responses = await checkActions(conv, 1, 2);
    if (manual) {
        const approval = conv.chatWindow.window.webContents.send.mock.calls.find((c: any[]) => c[0] === 'action-approval-request');
        expect(approval[2][0].chatMessage).toBe('Aegwynn soothed Arthas, easing his stress.');
        await conv.executeApprovedAction('reply', 'changeStress');
        expect(conv.executedActions.get('reply')[0].chatMessage).toBe('Aegwynn soothed Arthas, easing his stress.');
        expect(conv.pendingActions.size).toBe(0);
    } else expect(responses[0].chatMessage).toBe('Aegwynn soothed Arthas, easing his stress.');
    expect(game.character1Name).toBe('Old source'); expect(game.character2Name).toBe('Old target');
});
test.each([false, true])('a delayed action result cannot execute or request approval after its encounter closes (manual=%s)', async manual => {
    const conv = conversation('changeStress', '', manual);
    conv.isOpen = true;
    conv.actionsApiConnection.complete.mockImplementation(async () => {
        conv.isOpen = false;
        return '<rationale>Comfort.</rationale><actions>changeStress(2,1,soothe_minor)</actions>';
    });
    expect(await checkActions(conv, 1, 2)).toEqual([]);
    expect(conv.runFileManager.append).not.toHaveBeenCalled();
    expect(conv.pendingActions.size).toBe(0);
    expect(conv.currentTurnTriggeredActions.size).toBe(0);
});
test('an aborted action request is rejected even when the provider returns prose and clears the controller', async () => {
    const conv = conversation('changeStress', '');
    const controller = new AbortController(); conv.abortController = controller;
    conv.actionsApiConnection.complete.mockImplementation(async () => {
        controller.abort(); conv.abortController = null;
        return '<rationale>Comfort.</rationale><actions>changeStress(2,1,soothe_minor)</actions>';
    });
    expect(await checkActions(conv, 1, 2)).toEqual([]);
    expect(conv.runFileManager.append).not.toHaveBeenCalled();
});
test('an action decision cannot execute against a changed source turn', async () => {
    const conv = conversation('changeStress', '');
    let revision = 1; conv.getEncounterRevision = () => revision;
    conv.actionsApiConnection.complete.mockImplementation(async () => {
        revision++;
        return '<rationale>Comfort.</rationale><actions>changeStress(2,1,soothe_minor)</actions>';
    });
    expect(await checkActions(conv, 1, 2)).toEqual([]);
    expect(conv.runFileManager.append).not.toHaveBeenCalled();
});

test.each([['false',60,40],['true',10,90]])('ordinary conversion parser honors Boolean string %s', async (value, secret, publicWeight) => {
    const conv=conversation('convertReligion',`<rationale>Conversion.</rationale><actions>convertReligion(1,2,${value})</actions>`);
    game.characters.get(1)!.faith='source_faith';game.characters.get(2)!.faith='target_faith';
    const writer=require('../src/main/conversation/ActionEffectWriter').ActionEffectWriter.appendEffect as jest.Mock;
    writer.mockClear();await checkActions(conv,1,2);
    const effect=writer.mock.calls[0][4];expect(effect).toMatch(new RegExp(`\\b${secret} = \\{`));expect(effect).toMatch(new RegExp(`\\b${publicWeight} = \\{`));
    const slashEffect=jest.fn(); moduleFor('convertReligion').run(game,slashEffect,[value],1,2);
    expect(slashEffect.mock.calls[0][0]).toBe(effect);
});
test('conversion rejects invalid Boolean values before writing an effect',()=>{
    const emit=jest.fn();expect(()=>moduleFor('convertReligion').run(game,emit,['perhaps'],1,2)).toThrow('true or false');expect(emit).not.toHaveBeenCalled();
});

test('same-signature approvals execute only the selected proposal and leave the other available',async()=>{
    const conv=conversation('changeStress','<rationale>Two different participants.</rationale><actions>changeStress(1,2,soothe_minor), changeStress(2,1,rattle_minor)</actions>',true);
    await checkActions(conv,1,2);
    const proposals=conv.pendingActions.get('reply');expect(proposals).toHaveLength(2);expect(proposals[0].proposalId).not.toBe(proposals[1].proposalId);
    const original=proposals[0], chosen=proposals[1];
    await conv.executeApprovedAction('reply','changeStress');expect(conv.pendingActions.get('reply')).toHaveLength(2);expect(conv.executedActions.size).toBe(0);
    await conv.executeApprovedAction('reply',chosen.proposalId);expect(conv.executedActions.get('reply')[0].chatMessage).toContain('Aegwynn rattled Arthas');expect(conv.pendingActions.get('reply')).toEqual([original]);
    await conv.executeApprovedAction('reply',original.proposalId);expect(conv.executedActions.get('reply')).toHaveLength(2);expect(conv.pendingActions.size).toBe(0);
});
