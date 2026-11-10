import { ApiConnection } from '../../src/shared/apiConnection';
import { nativeChatMessages, NativeChatMessage } from '../../src/shared/nativeChat';
import { textProviderLane } from '../../src/shared/providerActivity';

const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
const call=(id='read1')=>({id,type:'function' as const,function:{name:'lore_lookup',arguments:'{ "query": "Human craft" }'}});
const prompt=():NativeChatMessage[]=>[{role:'system',content:'Complete original portrayal.'},{role:'user',name:'Visitor',content:'What would you suggest?'}];
function fixture(){
    const create=jest.fn().mockResolvedValue({choices:[{message:{content:'A normal reply.'},finish_reason:'stop'}]});
    const api:any=Object.assign(Object.create(ApiConnection.prototype),{type:'custom',model:'synthetic',forceInstruct:false,
        parameters:{temperature:.8,top_p:.9},config:{baseUrl:'https://synthetic.invalid/v1',key:'synthetic-only'},
        work:'foreground',isChat:()=>true,client:{baseURL:'https://synthetic.invalid/v1',apiKey:'synthetic-only',chat:{completions:{create}}}});
    return{api,create};
}
beforeEach(()=>{for(const key of ['debug','log','warn','error'] as const)jest.spyOn(console,key).mockImplementation(()=>{});});
afterEach(()=>jest.restoreAllMocks());

test('ordinary complete retains standard-only body, string result and finish-only observer',async()=>{
    const f=fixture(),observe=jest.fn(),messages:any=[{role:'user',name:'Visitor',content:'Hello.',characterId:2,rawContent:'NEVER_SENT'}];
    f.create.mockResolvedValue({choices:[{message:{content:'Hello.',tool_calls:[call()]},finish_reason:'stop'}]});
    expect(await f.api.complete(messages,false,{max_tokens:2200},undefined,undefined,undefined,undefined,observe)).toBe('Hello.');
    expect(f.create.mock.calls[0][0]).toEqual({model:'synthetic',messages:[{role:'user',name:'Visitor',content:'Hello.'}],stream:false,temperature:.8,top_p:.9,max_tokens:2200});
    expect(observe).toHaveBeenCalledWith({finishReason:'stop'});expect(f.create.mock.calls[0][1]).not.toHaveProperty('maxRetries');
});
test.each(['stop','tool_calls'])('native call metadata and result IDs roundtrip on provider finish %s',async finish=>{
    const f=fixture(),first={choices:[{message:{content:null,tool_calls:[{...call(),rawContent:'NEVER_SENT'}]},finish_reason:finish}]};
    f.create.mockResolvedValueOnce(first).mockResolvedValueOnce({choices:[{message:{content:'The supplied craft account helps.'},finish_reason:'stop'}]});
    const messages=prompt(),args={tools:[{type:'function',function:{name:'lore_lookup'}}],max_tokens:2200};
    const initial=await f.api.completeWithTools(messages,args,{isCurrent:()=>true});
    expect(initial).toEqual({content:'',finishReason:finish,toolCalls:[call()]});
    const next:any=[...messages,{role:'assistant',content:null,tool_calls:initial.toolCalls,id:'PRIVATE',rawContent:'NEVER_SENT'},
        {role:'tool',tool_call_id:'read1',content:'Whole permitted account.',characterId:2,rawContent:'NEVER_SENT'}];
    expect((await f.api.completeWithTools(next,args,{isCurrent:()=>true})).content).toBe('The supplied craft account helps.');
    expect(f.create.mock.calls[1][0].messages).toEqual([...messages,{role:'assistant',content:null,tool_calls:[call()]},{role:'tool',tool_call_id:'read1',content:'Whole permitted account.'}]);
    expect(JSON.stringify(f.create.mock.calls)).not.toContain('NEVER_SENT');expect(f.create.mock.calls[0][1].maxRetries).toBe(0);
    initial.toolCalls[0].function.arguments='changed';expect(first.choices[0].message.tool_calls[0].function.arguments).toBe(call().function.arguments);
});
test.each(['source','provider','prompt','parameters'])('queued native work rechecks %s before contacting provider',async fault=>{
    const f=fixture(),messages=prompt(),parameters={max_tokens:2200};let release!:()=>void,current=true;
    const blocker=textProviderLane.run('foreground',()=>new Promise<void>(resolve=>{release=resolve;}));await tick();
    const pending=f.api.completeWithTools(messages,parameters,{isCurrent:()=>current});await tick();expect(f.create).not.toHaveBeenCalled();
    if(fault==='source')current=false;if(fault==='provider')f.api.model='changed';
    if(fault==='prompt')messages[0].content='changed';if(fault==='parameters')parameters.max_tokens=1000;
    release();await expect(pending).rejects.toThrow('changed');await blocker;expect(f.create).not.toHaveBeenCalled();expect(textProviderLane.foregroundBusy).toBe(false);
});
test.each(['source','provider','prompt','parameters'])('native %s changes during response withhold its result',async fault=>{
    const f=fixture(),messages=prompt(),parameters={max_tokens:2200};let release!:(v:any)=>void,current=true;
    f.create.mockImplementation(()=>new Promise(resolve=>{release=resolve;}));
    const pending=f.api.completeWithTools(messages,parameters,{isCurrent:()=>current});await tick();
    if(fault==='source')current=false;if(fault==='provider')f.api.client={...f.api.client};
    if(fault==='prompt')messages[0].content='changed';if(fault==='parameters')parameters.max_tokens=1000;
    release({choices:[{message:{content:'STALE'},finish_reason:'stop'}]});await expect(pending).rejects.toThrow('changed');expect(f.create).toHaveBeenCalledTimes(1);
});
test('a cancelled queued native turn sends nothing',async()=>{
    const f=fixture(),controller=new AbortController();let release!:()=>void;
    const blocker=textProviderLane.run('foreground',()=>new Promise<void>(resolve=>{release=resolve;}));await tick();
    const pending=f.api.completeWithTools(prompt(),{max_tokens:2200},{isCurrent:()=>true,signal:controller.signal});controller.abort();
    await expect(pending).rejects.toHaveProperty('name','AbortError');expect(f.create).not.toHaveBeenCalled();release();await blocker;
});
test('an endpoint ignoring cancellation still cannot return a private result',async()=>{
    const f=fixture(),controller=new AbortController();let release!:(v:any)=>void;
    f.create.mockImplementation(()=>new Promise(resolve=>{release=resolve;}));
    const pending=f.api.completeWithTools(prompt(),{max_tokens:2200},{isCurrent:()=>true,signal:controller.signal});await tick();controller.abort();
    release({choices:[{message:{content:'CANCELLED'},finish_reason:'stop'}]});await expect(pending).rejects.toHaveProperty('name','AbortError');expect(f.create).toHaveBeenCalledTimes(1);
});
test.each(['HTTP','bad-function'])('native %s failure is not resampled by either retry layer',async mode=>{
    const f=fixture();if(mode==='HTTP')f.create.mockRejectedValue(Object.assign(new Error('Unavailable'),{status:503}));
    else f.create.mockResolvedValue({choices:[{message:{content:null,tool_calls:[{...call(),type:'custom'}]},finish_reason:'tool_calls'}]});
    await expect(f.api.completeWithTools(prompt(),{max_tokens:2200},{isCurrent:()=>true})).rejects.toBeDefined();expect(f.create).toHaveBeenCalledTimes(1);expect(f.create.mock.calls[0][1].maxRetries).toBe(0);
});
test.each(['orphan','missing','reused','null-user','unknown-role'])('malformed private history %s never contacts provider',async mode=>{
    const f=fixture(),messages:any=prompt();
    if(mode==='orphan')messages.push({role:'tool',tool_call_id:'absent',content:'secret'});
    if(mode==='missing')messages.push({role:'assistant',content:null,tool_calls:[call()]});
    if(mode==='reused')messages.push({role:'assistant',content:null,tool_calls:[call()]},{role:'tool',tool_call_id:'read1',content:'a'},{role:'assistant',content:null,tool_calls:[call()]},{role:'tool',tool_call_id:'read1',content:'b'});
    if(mode==='null-user')messages.push({role:'user',content:null});if(mode==='unknown-role')messages.push({role:'function',content:'bad'});
    await expect(f.api.completeWithTools(messages,{max_tokens:2200},{isCurrent:()=>true})).rejects.toThrow();expect(f.create).not.toHaveBeenCalled();
});
test.each(['gemini','force','instruct'])('unsupported %s mode retains the ordinary adapter path only',async mode=>{
    const f=fixture();if(mode==='gemini')f.api.type='gemini';if(mode==='force')f.api.forceInstruct=true;if(mode==='instruct')f.api.isChat=()=>false;
    await expect(f.api.completeWithTools(prompt(),{max_tokens:2200},{isCurrent:()=>true})).rejects.toThrow('custom chat');expect(f.create).not.toHaveBeenCalled();
});
test('standard projection is detached and retains exact heard words',()=>{
    const messages:any=[{role:'user',content:'PARTLY-HEARD WORDS',rawContent:'ORIGINAL-UNHEARD',characterId:2,perceptionPurpose:'knowledge'}];
    const clean=nativeChatMessages(messages);expect(clean).toEqual([{role:'user',content:'PARTLY-HEARD WORDS'}]);clean[0].content='changed';expect(messages[0].content).toBe('PARTLY-HEARD WORDS');
});
