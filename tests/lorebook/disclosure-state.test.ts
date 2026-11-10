import { DisclosureSessions, LoreDelivery, visibleLoreQuery, loreKnowledgeBoundary } from '../../src/main/lorebook/lorebookDisclosure';
const turn = (id: string, content = id) => ({ id, role: 'user', content });
test('follow-ups deepen only after context admission; retries reuse their original starting point', () => {
    const sessions = new DisclosureSessions(), scope = {}, a: LoreDelivery = { scope, channel: 'chat', turns: [turn('a')] };
    const first = sessions.prepare(a, 2, 'binding'); expect(first.previous).toBeUndefined(); first.commit(true, { focus: 'overview' });
    expect(sessions.prepare(a, 2, 'binding').previous).toBeUndefined();
    const next = sessions.prepare({ ...a, turns: [turn('a'), turn('b')] }, 2, 'binding');
    // An unfinished redraw does not erase the previously admitted context.
    expect(next.previous).toEqual({ focus: 'overview' });
    next.commit(true, { focus: 'chapter' });
    const third = sessions.prepare({ ...a, turns: [turn('a'), turn('b'), turn('c')] }, 2, 'binding');
    expect(third.previous).toEqual({ focus: 'chapter' }); third.commit(false, {});
    const retry = sessions.prepare({ ...a, turns: [turn('a'), turn('b'), turn('d')] }, 2, 'binding');
    expect(retry.previous).toEqual({ focus: 'chapter' });
});
test('actor, channel, encounter, edition/report and edited history isolate progression', () => {
    for (const change of ['actor','channel','encounter','binding','edit','undo']) {
        const sessions = new DisclosureSessions(), scope = {};
        const a: LoreDelivery = { scope, channel: 'chat', turns: [turn('a'), turn('b')] };
        sessions.prepare(a, 2, 'one').commit(true, { focus: 'secret-old-scope' });
        const next: LoreDelivery = { ...a, turns: [...a.turns, turn('c')] };
        if (change === 'channel') next.channel = 'letter';
        if (change === 'encounter') next.scope = {};
        if (change === 'edit') next.turns = [turn('a', 'edited'), turn('b'), turn('c')];
        if (change === 'undo') next.turns = [turn('a')];
        expect(sessions.prepare(next, change === 'actor' ? 3 : 2, change === 'binding' ? 'two' : 'one').previous).toBeUndefined();
    }
});
test('a late asynchronous completion cannot overwrite a newer request', () => {
    const sessions = new DisclosureSessions(), d: LoreDelivery = { scope: {}, channel: 'chat', turns: [turn('a')] };
    const old = sessions.prepare(d, 2, 'b'), current = sessions.prepare(d, 2, 'b');
    current.commit(true, { focus: 'current' }); old.commit(true, { focus: 'stale' }); old.forget();
    expect(sessions.prepare({ ...d, turns: [turn('a'),turn('b')] }, 2, 'b').previous).toEqual({ focus: 'current' });
});
test('an accepted generation that was never retained does not advance public progress',()=>{
    const sessions=new DisclosureSessions(),d:LoreDelivery={scope:{},channel:'chat',turns:[turn('a')]};
    const first=sessions.prepare(d,2,'binding');
    (first.commit as any)(true,{focus:'unpublished'},()=>false);
    expect(sessions.prepare({...d,turns:[...d.turns,turn('b')]},2,'binding').previous).toBeUndefined();
});
test('only an unchanged retained publication keeps advancement; preview cannot consume it',()=>{
    const sessions=new DisclosureSessions(),d:LoreDelivery={scope:{},channel:'chat',turns:[turn('a')]};
    let retained=false;const first=sessions.prepare(d,2,'binding');
    (first.commit as any)(true,{focus:'published'},()=>retained);
    const next={...d,turns:[...d.turns,turn('b')]};
    expect(sessions.prepare({...next,preview:true},2,'binding').previous).toBeUndefined();
    retained=true;expect(sessions.prepare({...next,preview:true},2,'binding').previous).toEqual({focus:'published'});
    retained=false;expect(sessions.prepare(next,2,'binding').previous).toBeUndefined();
});
test('a failing publication receipt withdraws progress without blocking ordinary preparation',()=>{
    const sessions=new DisclosureSessions(),d:LoreDelivery={scope:{},channel:'chat',turns:[turn('a')]};
    (sessions.prepare(d,2,'binding').commit as any)(true,{focus:'invalid'},()=>{throw Error('stale publication');});
    expect(sessions.prepare({...d,turns:[...d.turns,turn('b')]},2,'binding').previous).toBeUndefined();
});
test('preview reads preserve an active turn and cannot advance, erase or reserve its progressive state',()=>{
    const sessions=new DisclosureSessions(),d:LoreDelivery={scope:{},channel:'chat',turns:[turn('a')]};
    const first=sessions.prepare(d,2,'binding');first.commit(true,{focus:'overview'});
    const followup={...d,turns:[...d.turns,turn('b')]},active=sessions.prepare(followup,2,'binding');
    const preview=sessions.prepare({...followup,preview:true},2,'binding');
    expect(preview.previous).toEqual({focus:'overview'});expect(active.isCurrent()).toBe(true);
    preview.commit(true,{focus:'wrong'});preview.forget();sessions.clear({...followup,preview:true},2);
    expect(active.isCurrent()).toBe(true);active.commit(true,{focus:'chapter'});
    expect(sessions.prepare({...followup,turns:[...followup.turns,turn('c')]},2,'binding').previous).toEqual({focus:'chapter'});
    expect(preview.isCurrent()).toBe(false);
});
test('an unrelated topic clears focus while an omitted-budget proposal can still retry', () => {
    const sessions=new DisclosureSessions(),scope={},a={id:'a',content:'Tell me about humans.'};
    sessions.prepare({scope,channel:'chat',turns:[a]},2,'binding').commit(true,{focus:'human'});
    const unrelated=sessions.prepare({scope,channel:'chat',turns:[a,{id:'b',content:'Pass the bread.'}]},2,'binding');
    unrelated.forget();
    expect(sessions.prepare({scope,channel:'chat',turns:[a,{id:'b',content:'Pass the bread.'},{id:'c',content:'More.'}]},2,'binding').previous).toBeUndefined();
});
test('host language-perception instructions are not retrieval topic words', () => {
    expect(visibleLoreQuery('[Language perception: Speech is partly intelligible. Spoken language: Dwarven.]\n"Brung water."')).toBe('"Brung water."');
    expect(visibleLoreQuery('The dwarves asked about water.')).toBe('The dwarves asked about water.');
});
test('unintelligible speech cannot become a lore topic, while observed labels remain available', () => {
    expect(visibleLoreQuery('"Brung fal dor."',{speechComprehension:'unintelligible',comprehensionMode:'FAR'})).toBe('');
    const speech='"Brung fal dor."',prefix='[Language perception: Speech is unintelligible.]\n';
    const query=visibleLoreQuery(prefix+speech+' *Points to a diagram labelled Ironforge.*',{
        speechComprehension:'unintelligible',perceivedSpeechSpans:[{start:prefix.length,end:prefix.length+speech.length}]
    });
    expect(query).toContain('Ironforge');expect(query).not.toContain('Brung');expect(query).not.toContain('Language perception');
});
test('mixed speech excludes opaque sound ranges without removing understood context', () => {
    const content='Explain Brungfal and the history of Ironforge.';
    expect(visibleLoreQuery(content,{primarySpeechComprehension:'clear',perceivedOpaqueSpeechSpans:[{start:8,end:16}]})).toContain('history of Ironforge');
    expect(visibleLoreQuery(content,{perceivedOpaqueSpeechSpans:[{start:8,end:16}]})).not.toContain('Brungfal');
});
test('knowledge guidance binds the actual numeric date without deriving one from display text', () => {
    const value=loreKnowledgeBoundary('Mara',{year:582,month:12,day:31,totalDays:100,display:'Not a date'});
    expect(value).toContain('0582-12-31');expect(value).toContain('later canonical history');expect(value).not.toContain('Not a date');
    expect(loreKnowledgeBoundary('Mara')).not.toContain('0582');
});
test('prepared native recall treats missing initial retrieval as provisional, retaining the knowledge boundary',()=>{
    const value=(loreKnowledgeBoundary as any)('Mara',undefined,{access:'not_established'},true);
    expect(value).toContain('lore_lookup');expect(value).toContain('initial');
    expect(value).not.toContain('YOU DO NOT KNOW');expect(value).toContain('personal powers');
    expect(value).toContain('later canonical history');
});
test('missing-account recall guidance never applies to unavailable sources or an already provided account',()=>{
    for(const access of ['unavailable','provided','existing','continuation'] as const)
        expect((loreKnowledgeBoundary as any)('Mara',undefined,{access},true)).toBe(loreKnowledgeBoundary('Mara',undefined,{access}));
    expect(loreKnowledgeBoundary('Mara',undefined,{access:'not_established'})).toContain('YOU DO NOT KNOW');
});
