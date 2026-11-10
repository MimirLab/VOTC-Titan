jest.mock('../../src/main/lorebook/lorebookNativeLookup',()=>({completeNativeLoreLookup:jest.fn()}));
import { completeNativeLoreLookup } from '../../src/main/lorebook/lorebookNativeLookup';
import { completeNativeLoreChat,nativeLoreChatEnabled } from '../../src/main/lorebook/lorebookNativeChat';
import { spokenPublicationSessions } from '../../src/main/lorebook/lorebookSpokenPublication';

function fixture(){
    let current=true;
    const actor:any={id:2},api:any={type:'custom',forceInstruct:false,isChat:()=>true};
    const conv:any={textGenApiConnection:api,config:{maxTokens:2200,stream:false},messages:[]};
    const context:any={actor,original:[{role:'system',content:'Entire original.'},{role:'user',name:'Visitor',content:'Question.'}],delivery:{},isCurrent:()=>current};
    const result={reply:'Final RP.',validate:jest.fn(),commit:jest.fn(),providerCalls:1,lookups:[]};
    (completeNativeLoreLookup as jest.Mock).mockResolvedValue(result);
    return{actor,api,conv,context,result,revoke:()=>{current=false;}};
}
afterEach(()=>{delete process.env.VOTC_LORE_NATIVE_CHAT_STUDY;delete process.env.VOTC_LORE_NATIVE_THINKING_BUDGET;});
test('player-selected uncapped Mimir reasoning retains the ordinary total output limit and original prompt',async()=>{
    const f=fixture();f.api.model='mimir-bigbrain';f.conv.config.maxTokens=5000;
    process.env.VOTC_LORE_NATIVE_THINKING_BUDGET='-1';
    const original=JSON.stringify(f.context.original);
    const r=await completeNativeLoreChat(f.conv,f.actor,f.context,{max_tokens:5000});
    expect((completeNativeLoreLookup as jest.Mock).mock.calls.at(-1)[2]).toMatchObject({parameters:{max_tokens:5000,thinking_token_budget:-1},maxOutputTokens:5000});
    expect(JSON.stringify(f.context.original)).toBe(original);r!.finish(false);
    await completeNativeLoreChat(f.conv,f.actor,f.context,{max_tokens:5000,thinking_token_budget:512});
    expect((completeNativeLoreLookup as jest.Mock).mock.calls.at(-1)[2].parameters.thinking_token_budget).toBe(512);
});
test.each(['-2','0','63','2049','NaN','1.5'])('invalid Mimir allowance %s is rejected before lookup',async value=>{
    const f=fixture();f.api.model='mimir-bigbrain';process.env.VOTC_LORE_NATIVE_THINKING_BUDGET=value;
    await expect(completeNativeLoreChat(f.conv,f.actor,f.context,{max_tokens:5000})).rejects.toThrow('reasoning allowance');
    expect(completeNativeLoreLookup).not.toHaveBeenCalled();
});
test('playtest Mimir allowance leaves room for prose and respects explicit provider parameters',async()=>{
    const f=fixture();f.api.model='mimir-bigbrain';process.env.VOTC_LORE_NATIVE_THINKING_BUDGET='1024';
    await completeNativeLoreChat(f.conv,f.actor,f.context,{max_tokens:2200});
    expect((completeNativeLoreLookup as jest.Mock).mock.calls.at(-1)[2]).toMatchObject({parameters:{max_tokens:2200,thinking_token_budget:1024},maxOutputTokens:2200});
    await completeNativeLoreChat(f.conv,f.actor,f.context,{max_tokens:2200,thinking_token_budget:512});
    expect((completeNativeLoreLookup as jest.Mock).mock.calls.at(-1)[2].parameters.thinking_token_budget).toBe(512);
    f.api.model='another-model';await completeNativeLoreChat(f.conv,f.actor,f.context,{max_tokens:2200});
    expect((completeNativeLoreLookup as jest.Mock).mock.calls.at(-1)[2].parameters).not.toHaveProperty('thinking_token_budget');
    f.api.model='mimir-bigbrain';process.env.VOTC_LORE_NATIVE_THINKING_BUDGET='2200';
    await expect(completeNativeLoreChat(f.conv,f.actor,f.context,{max_tokens:2200})).rejects.toThrow('reasoning allowance');
});
test('isolated opt-in leaves ordinary streaming and unsupported connections alone',()=>{
    const f=fixture();expect(nativeLoreChatEnabled(f.conv)).toBe(false);
    process.env.VOTC_LORE_NATIVE_CHAT_STUDY='1';expect(nativeLoreChatEnabled(f.conv)).toBe(true);
    f.conv.config.stream=true;expect(nativeLoreChatEnabled(f.conv)).toBe(false);
    f.conv.config.stream=false;f.api.forceInstruct=true;expect(nativeLoreChatEnabled(f.conv)).toBe(false);
});
test('completion defers cursor through normal engine validation without enabling failed name-prefix cue',async()=>{
    const f=fixture(),r=await completeNativeLoreChat(f.conv,f.actor,f.context,{max_tokens:2200});
    expect(r?.reply).toBe('Final RP.');expect(f.result.commit).not.toHaveBeenCalled();
    expect((completeNativeLoreLookup as jest.Mock).mock.calls.at(-1)[2]).not.toHaveProperty('currentTurn');
    r!.validate();expect(f.result.validate).toHaveBeenCalledTimes(1);
    const message:any={role:'assistant',characterId:2,content:'Final RP.'};r!.finish(true,message);r!.finish(false);
    expect(f.result.commit).toHaveBeenCalledTimes(1);expect(f.result.commit).toHaveBeenCalledWith(true,expect.any(Function));
    const retained=f.result.commit.mock.calls[0][1];expect(retained()).toBe(false);
    f.conv.messages.push(message);expect(retained()).toBe(true);
    message.content='Edited later.';expect(retained()).toBe(false);
    message.content='Final RP.';f.conv.messages=[];expect(retained()).toBe(false);
});
test('publication receipt binds actor, encoding and recipients and never accepts another message copy',async()=>{
    const f=fixture(),r=await completeNativeLoreChat(f.conv,f.actor,f.context,{});
    const message:any={role:'assistant',characterId:2,content:'Final RP.',targetCharacterIds:[1]};r!.finish(true,message);
    const retained=f.result.commit.mock.calls[0][1];f.conv.messages=[{...message}];expect(retained()).toBe(false);
    f.conv.messages=[message];expect(retained()).toBe(true);
    message.targetCharacterIds=[3];expect(retained()).toBe(false);message.targetCharacterIds=[1];
    message.proseEncoding='controls-v1';expect(retained()).toBe(false);delete message.proseEncoding;
    f.conv.isOpen=false;expect(retained()).toBe(false);
});
test('spoken publication receipt survives working-context compaction but requires canonical retention',async()=>{
    const f=fixture(),canonical:any[]=[];f.conv.getCanonicalEncounterMessagesForLore=()=>canonical;
    f.context.delivery.spokenAudience={};
    const r=await completeNativeLoreChat(f.conv,f.actor,f.context,{}),message:any={role:'assistant',characterId:2,content:'Final RP.'};
    r!.finish(true,message);const retained=f.result.commit.mock.calls[0][1];
    f.conv.messages=[message];expect(retained()).toBe(false);
    canonical.push(message);f.conv.messages=[];expect(retained()).toBe(true);
    canonical.splice(0);expect(retained()).toBe(false);
});
test('budget-omitted optional lore does not queue a spoken source after its reader has been released',async()=>{
    const f=fixture();f.context.omittedLore=true;
    const queue=jest.spyOn(spokenPublicationSessions,'queue');
    try{
        const r=await completeNativeLoreChat(f.conv,f.actor,f.context,{});
        r!.finish(true,{role:'assistant',characterId:2,content:'Final RP.'});
        expect(queue).not.toHaveBeenCalled();
    }finally{queue.mockRestore();}
});
test('acceptance without the actual acting-character message releases the pending context',async()=>{
    const f=fixture(),r=await completeNativeLoreChat(f.conv,f.actor,f.context,{});
    expect(()=>r!.finish(true,{role:'assistant',characterId:3,content:'Other.'})).toThrow('actual acting');
    expect(f.result.commit).toHaveBeenCalledWith(false);
});
test('normal codec may clone and append recovery instruction but never lose original content',async()=>{
    const f=fixture(),request=[...f.context.original.map((m:any)=>({...m})),{role:'system',content:'Normal format recovery.'}];
    const r=await completeNativeLoreChat(f.conv,f.actor,f.context,{},undefined,request);r!.finish(false);
    const modified=request.map((m:any)=>({...m}));modified[0].content='Other persona';
    await expect(completeNativeLoreChat(f.conv,f.actor,f.context,{},undefined,modified)).rejects.toThrow('original RP');
});
test.each(['after-response','before-publication','provider-replaced','actor-mismatch'])('invalid %s state never accepts cursor',async phase=>{
    const f=fixture();
    if(phase==='actor-mismatch')await expect(completeNativeLoreChat(f.conv,{id:2}as any,f.context,{})).rejects.toThrow('changed');
    else if(phase==='after-response'){
        (completeNativeLoreLookup as jest.Mock).mockImplementation(async()=>{f.revoke();return f.result;});
        await expect(completeNativeLoreChat(f.conv,f.actor,f.context,{})).rejects.toThrow('changed');expect(f.result.commit).toHaveBeenCalledWith(false);
    }else{
        const r=await completeNativeLoreChat(f.conv,f.actor,f.context,{});
        if(phase==='before-publication')f.revoke();else f.conv.textGenApiConnection={...f.api};
        expect(()=>r!.validate()).toThrow('changed');expect(()=>r!.finish(true)).toThrow('changed');expect(f.result.commit).toHaveBeenCalledWith(false);
    }
    expect(f.result.commit).not.toHaveBeenCalledWith(true);
});
