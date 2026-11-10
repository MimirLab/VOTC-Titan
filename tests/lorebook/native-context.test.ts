jest.mock('../../src/main/characterDescription',()=>({getEffectiveCharacterDescription:jest.fn()}));
jest.mock('../../src/main/culture/cultureRuntime',()=>({getCultureBackground:jest.fn()}));
jest.mock('../../src/main/faith/faithRuntime',()=>({getFaithBackground:jest.fn(),getFaithLiveContext:jest.fn()}));
jest.mock('../../src/main/goa/goaRuntime',()=>({getVerifiedGoaSnapshot:jest.fn()}));
import { getEffectiveCharacterDescription } from '../../src/main/characterDescription';
import { getCultureBackground } from '../../src/main/culture/cultureRuntime';
import { getFaithBackground,getFaithLiveContext } from '../../src/main/faith/faithRuntime';
import { getVerifiedGoaSnapshot } from '../../src/main/goa/goaRuntime';
import { nativeLoreSourceCurrent,captureNativeLorePrompt } from '../../src/main/lorebook/lorebookNativeContext';

function fixture(){
    const actor={id:2,fullName:'Mara',traits:['human']},player={id:1,fullName:'Visitor'};
    const state:any={personal:{1:'Player portrait.',2:'Patient artisan.'},culture:'Ready culture.',faith:'Ready faith.',live:{},goa:{body:'human'}};
    (getEffectiveCharacterDescription as jest.Mock).mockImplementation((_data,_player,id)=>state.personal[id]);
    (getCultureBackground as jest.Mock).mockImplementation(()=>state.culture);
    (getFaithBackground as jest.Mock).mockImplementation(()=>state.faith);
    (getFaithLiveContext as jest.Mock).mockImplementation(()=>state.live);
    (getVerifiedGoaSnapshot as jest.Mock).mockImplementation(()=>state.goa);
    const game:any={characters:new Map([[1,player],[2,actor]]),playerID:1,aiID:2,date:'582.12.31',gameDate:{totalDays:123},location:'Inn',scene:'Council',silencedCharacterIds:new Set()};
    const conv:any={gameData:game,config:{faithRoleplayEnabled:true},messages:[{role:'user',name:'Visitor',content:'Stay.'}],isOpen:true};
    return{actor,player,state,game,conv,current:nativeLoreSourceCurrent(conv,actor as any,'/tmp/synthetic-lore')};
}
test('source reads stay current and empty unrendered faith expiry is equivalent to absence',()=>{
    const f=fixture();expect(f.current()).toBe(true);f.state.live=undefined;expect(f.current()).toBe(true);
});
test.each(['actor','participant','history','personal','other-personal','culture','faith','live','clock','scene','perspective','config','closed'])('source %s mutation invalidates the pending reply',kind=>{
    const f=fixture();
    if(kind==='actor')f.actor.traits.push('naga');
    if(kind==='participant')f.game.characters.set(1,{...f.player});
    if(kind==='history')f.conv.messages.push({role:'user',content:'Different request.'});
    if(kind==='personal')f.state.personal[2]='Changed conviction.';
    if(kind==='other-personal')f.state.personal[1]='Changed player portrayal.';
    if(kind==='culture')f.state.culture='Changed culture.';
    if(kind==='faith')f.state.faith='Changed faith.';
    if(kind==='live')f.state.live={fervor:20};
    if(kind==='clock')f.game.gameDate.totalDays++;
    if(kind==='scene')f.game.location='Another town';
    if(kind==='perspective')f.game.playerID=2;
    if(kind==='config')f.conv.config.faithRoleplayEnabled=false;
    if(kind==='closed')f.conv.isOpen=false;
    expect(f.current()).toBe(false);
});
test('nonempty current faith context expiring invalidates the prior source',()=>{
    const f=fixture();f.state.live={fervor:70};const current=nativeLoreSourceCurrent(f.conv,f.actor as any,'/tmp/synthetic-lore');
    f.state.live=undefined;expect(current()).toBe(false);
});
test('capture binds the actual retained current perceived turn and exact owned lore',()=>{
    const f=fixture(),turn:any=f.conv.messages[0],lore:any={role:'system',content:'Wrapper\nHuman\nKnown craft.'};
    const delivery:any={accounts:['Human\nKnown craft.']},capture:any={preparing:true},original=[turn,lore];
    expect(captureNativeLorePrompt(capture,original,f.actor as any,delivery,[turn],lore,f.current)).toBe(original);
    expect(capture.value).toMatchObject({original,actor:f.actor,delivery,omittedLore:false,currentTurn:turn});
    const dropped:any={};captureNativeLorePrompt(dropped,[{...turn},{...lore}],f.actor as any,delivery,[turn],lore,f.current);
    expect(dropped.value.currentTurn).toBeUndefined();expect(dropped.value.omittedLore).toBe(true);
});
test('changed source and mismatched account metadata cannot be captured as valid',()=>{
    const f=fixture(),lore:any={role:'system',content:'Other account.'};
    expect(()=>captureNativeLorePrompt({},[lore],f.actor as any,{accounts:['Known fact.']}as any,[],lore,f.current)).toThrow('builder-owned');
    f.state.personal[2]='Changed.';expect(()=>captureNativeLorePrompt({},[],f.actor as any,{}as any,[],undefined,f.current)).toThrow('changed');
});
