import { bindLoreDisclosureFocus } from '../../src/main/lorebook/lorebookDisclosure';

function fixture(){
    const previous={version:'titan-progressive-lore-v2',context:'current-binding',root:'scholars',focus:'herbs',
        focus_title:'Scholars — Herbal Practice',focus_origin:'scene',shown:['herbs']};
    const result={actor_id:'2',context_fingerprint:'current-binding',words:0,passages:[] as any[],state:{...previous},
        disclosure:{version:'titan-progressive-lore-v2',mode:'scene_continue',access:'not_requested',intent:'none'}};
    return{previous,result};
}

test('contextual continuation retains only navigation and makes no information/exhaustion claim',()=>{
    const f=fixture();expect(bindLoreDisclosureFocus(f.result,2,'Go on.',f.previous)).toBeUndefined();
});

test.each(['actor','context','origin','cursor','body','access','budget','extra-state'] as const)(
    'contextual continuation refuses changed %s binding',change=>{
        const {previous,result}=fixture(),bad:any=JSON.parse(JSON.stringify(result));
        if(change==='actor')bad.actor_id='3';
        if(change==='context')bad.context_fingerprint='old';
        if(change==='origin')bad.state.focus_origin='requested';
        if(change==='cursor')bad.state.focus='other';
        if(change==='body')bad.passages=[{text:'Unexpected account'}];
        if(change==='access')bad.disclosure.access='continuation';
        if(change==='budget')bad.words=1;
        if(change==='extra-state')bad.state.extra='new';
        expect(()=>bindLoreDisclosureFocus(bad,2,'Go on.',previous)).toThrow('Contextual lore');
    });
