import { completeNativeLoreLookup, NativeLookupContext, nativeLookupMessages } from '../../src/main/lorebook/lorebookNativeLookup';
import { ApiConnection } from '../../src/shared/apiConnection';

const call=(id='read1',query='Human faith')=>({id,type:'function',function:{name:'lore_lookup',arguments:JSON.stringify({query})}});
const response=(content:string|null,tool_calls?:any[],reason='stop')=>({choices:[{message:{content,...(tool_calls?{tool_calls}:{})},finish_reason:reason}]});
function fixture(){
    let current=true;
    const finish=jest.fn(),read=jest.fn().mockResolvedValue([]),create=jest.fn().mockResolvedValue(response('"I can sit with you."'));
    const original=[{role:'system' as const,content:'Entire original portrayal, body, scene and instructions.'},{role:'user' as const,name:'Visitor',content:'Please stay.'}];
    const d:NativeLookupContext['delivery']={scope:{},channel:'chat',turns:[],preparing:true,required:true,isCurrent:()=>current,
        finishPreparation:finish,requestMore:read,accounts:[],accountWords:0,knowledge:{access:'not_requested'}};
    const context:NativeLookupContext={original,delivery:d};
    const api:ApiConnection=Object.assign(Object.create(ApiConnection.prototype),{type:'custom',model:'synthetic',forceInstruct:false,parameters:{temperature:.8,top_p:.9},
        config:{baseUrl:'https://synthetic.invalid/v1'},context:8192,work:'foreground',isChat:()=>true,calculateTokensFromText:()=>100,
        client:{baseURL:'https://synthetic.invalid/v1',chat:{completions:{create}}}});
    const options={parameters:{thinking_token_budget:512},maxOutputTokens:2200,isCurrent:()=>current,countTokens:(_messages:readonly unknown[])=>100};
    const add=(accounts:readonly string[],wordCount:number)=>{d.accounts=[...(d.accounts??[]),...accounts];d.accountWords!+=wordCount;return accounts;};
    return{context,d,api,options,finish,read,create,add,revoke:()=>{current=false;}};
}
beforeEach(()=>{for(const key of ['debug','log','warn','error'] as const)jest.spyOn(console,key).mockImplementation(()=>{});});
afterEach(()=>jest.restoreAllMocks());

test('ordinary personal interaction uses one normal call with full original and no extra rule tail',async()=>{
    const f=fixture(),r=await completeNativeLoreLookup(f.context,f.api,f.options);
    expect(r).toMatchObject({reply:'"I can sit with you."',providerCalls:1,lookups:[],assurance:'guarded-input-only'});
    expect(f.create.mock.calls[0][0].messages).toEqual(f.context.original);expect(f.create.mock.calls[0][0]).toMatchObject({temperature:.8,top_p:.9,thinking_token_budget:512,tool_choice:'auto'});
    expect(f.read).not.toHaveBeenCalled();expect(f.finish).not.toHaveBeenCalled();r!.commit(true);expect(f.finish).toHaveBeenCalledWith(false,{initialFocusOnly:true});
});
test('a necessary private read uses actual adapter and sends no speculative pre-tool words onward',async()=>{
    const f=fixture();f.d.accounts=['Human guild\nKnown craft.'];f.d.accountWords=2;
    f.context.original[0].content+='\nHuman guild\nKnown craft.';
    f.create.mockResolvedValueOnce(response('PRIVATE-SPECULATION',[call()],'tool_calls')).mockResolvedValueOnce(response('"I can explain the supplied custom."'));
    f.read.mockImplementation(async(query,room)=>{expect(query).toBe('Human faith');expect(room).toEqual({maxWords:348,maxAccounts:2});return f.add(['Human faith\nA lay belief is no personal miracle.'],7);});
    const r=await completeNativeLoreLookup(f.context,f.api,f.options);
    expect(r).toMatchObject({providerCalls:2,lookups:[{query:'Human faith',accountsAdded:1}]});expect(f.context.original).toHaveLength(2);
    const messages=f.create.mock.calls[1][0].messages;expect(messages.slice(0,2)).toEqual(f.context.original);
    expect(messages[2]).toEqual({role:'assistant',content:null,tool_calls:[call()]});expect(messages[3]).toMatchObject({role:'tool',tool_call_id:'read1'});
    expect(JSON.parse(messages[3].content)).toMatchObject({status:'provided',accounts:['Human faith\nA lay belief is no personal miracle.']});
    expect(JSON.stringify(messages)).not.toContain('PRIVATE-SPECULATION');expect(r!.reply).not.toContain('PRIVATE-SPECULATION');
    r!.commit(true);expect(f.finish).toHaveBeenCalledWith(true,{initialFocusOnly:true});
});
test('uncapped reasoning survives the actual SDK adapter and a private lookup without changing other request settings',async()=>{
    const f=fixture();f.api.model='mimir-bigbrain';f.options.parameters.thinking_token_budget=-1;f.options.maxOutputTokens=5000;
    f.create.mockResolvedValueOnce(response('PRIVATE-DRAFT',[call()],'tool_calls')).mockResolvedValueOnce(response('"I can explain the supplied custom."'));
    f.read.mockImplementation(async()=>f.add(['Human faith\nA lay belief is no personal miracle.'],7));
    const original=JSON.stringify(f.context.original),r=await completeNativeLoreLookup(f.context,f.api,f.options);
    expect(f.create).toHaveBeenCalledTimes(2);
    for(const [request] of f.create.mock.calls){
        expect(request).toMatchObject({thinking_token_budget:-1,max_tokens:5000,temperature:.8,top_p:.9});
        expect(request.messages.slice(0,2)).toEqual(f.context.original);
    }
    expect(JSON.stringify(f.context.original)).toBe(original);expect(r!.reply).not.toContain('PRIVATE-DRAFT');r!.commit(false);
});
test('an empty permitted result adds no facts and does not prevent normal uncertainty',async()=>{
    const f=fixture();f.create.mockResolvedValueOnce(response(null,[call()])).mockResolvedValueOnce(response('"I do not know those details."'));
    const r=await completeNativeLoreLookup(f.context,f.api,f.options);expect(r!.lookups[0].accountsAdded).toBe(0);
    expect(JSON.parse(f.create.mock.calls[1][0].messages[3].content)).toMatchObject({status:'not_available',accounts:[]});r!.commit(false);
});
test('clear miss distinguishes no additional evidence from an answer already in the original',async()=>{
    const f=fixture();f.context.original[0].content+=' The witnessed particular agreement is three silver coins.';
    f.create.mockResolvedValueOnce(response(null,[call()])).mockResolvedValueOnce(response('"Our particular agreement says three silver coins."'));
    const original=JSON.stringify(f.context.original),r=await completeNativeLoreLookup(f.context,f.api,f.options);
    const messages=f.create.mock.calls[1][0].messages,packet=JSON.parse(messages[3].content);
    expect(messages).toHaveLength(4);expect(packet).toMatchObject({status:'not_available',accounts:[]});
    expect(packet.guidance).toContain('facts already established in the original context');
    expect(packet.guidance).toContain('If those do not establish the requested detail');
    expect(packet.guidance).not.toContain('YOU DO NOT KNOW');expect(packet.guidance).not.toContain('no price');
    expect(JSON.stringify(f.context.original)).toBe(original);expect(r?.reply).toContain('three silver');r!.commit(false);
});
test('clear miss stays private with no added system layer or speculative draft words',async()=>{
    const f=fixture();f.create.mockResolvedValueOnce(response('PRIVATE-DRAFT',[call()])).mockResolvedValueOnce(response('"I cannot verify the price."'));
    const r=await completeNativeLoreLookup(f.context,f.api,f.options),messages=f.create.mock.calls[1][0].messages;
    expect(messages.slice(0,2)).toEqual(f.context.original);expect(messages).toHaveLength(4);
    const packet=JSON.parse(messages[3].content);expect(packet.guidance).toContain('This read establishes no new fact.');
    expect(JSON.stringify(messages)).not.toContain('PRIVATE-DRAFT');expect(r?.lookups[0].accountsAdded).toBe(0);r!.commit(false);
});
test('provided private accounts keep their existing exact guidance and no extra system message',async()=>{
    const f=fixture();f.create.mockResolvedValueOnce(response(null,[call()])).mockResolvedValueOnce(response('"The supplied account says so."'));
    f.read.mockImplementation(async()=>f.add(['One source\nKnown words.'],3));
    const r=await completeNativeLoreLookup(f.context,f.api,f.options),messages=f.create.mock.calls[1][0].messages;
    expect(messages).toHaveLength(4);expect(JSON.parse(messages[3].content)).toMatchObject({status:'provided',accounts:['One source\nKnown words.'],
        guidance:'Use the supplied accounts for established setting claims, retaining exceptions, uncertainty and roles. Put additional details into present proposals or questions. Community customs grant no personal powers or compulsory choices.'});
    r!.commit(false);
});
test('private reader result must fit the same context budget before a second writer call',async()=>{
    const f=fixture();f.create.mockResolvedValueOnce(response(null,[call()]));
    f.options.countTokens=(messages:any)=>messages.length>2?f.api.context-f.options.maxOutputTokens+1:100;
    await expect(completeNativeLoreLookup(f.context,f.api,f.options)).rejects.toThrow('context budget');
    expect(f.create).toHaveBeenCalledTimes(1);expect(f.finish).toHaveBeenCalledWith(false,{initialFocusOnly:true});
});
test('two optional reads remain bounded and the third completion cannot request another',async()=>{
    const f=fixture();f.d.accounts=['Original\nKnown fact.'];f.d.accountWords=2;
    f.context.original[0].content+='\nOriginal\nKnown fact.';
    f.create.mockResolvedValueOnce(response(null,[call('one')])).mockResolvedValueOnce(response(null,[call('two','Human craft')])).mockResolvedValueOnce(response('"Here is what I know."'));
    f.read.mockImplementation(async(q)=>f.add([q+'\nOne allowed account.'],3));
    const r=await completeNativeLoreLookup(f.context,f.api,f.options);expect(r!.providerCalls).toBe(3);expect(f.read).toHaveBeenCalledTimes(2);
    expect(f.create.mock.calls[2][0]).not.toHaveProperty('tools');r!.commit(false);
});
test.each(['third','parallel','wrong-function','wrong-arguments','reused-id'])('invalid %s request publishes nothing and never starts an extra read',async mode=>{
    const f=fixture();
    if(mode==='parallel')f.create.mockResolvedValue(response(null,[call('a'),call('b')]));
    if(mode==='wrong-function')f.create.mockResolvedValue(response(null,[{...call(),function:{name:'other',arguments:'{}'}}]));
    if(mode==='wrong-arguments')f.create.mockResolvedValue(response(null,[{...call(),function:{name:'lore_lookup',arguments:'{"query":"Human","grant":true}'}}]));
    if(mode==='reused-id'||mode==='third'){
        f.create.mockResolvedValueOnce(response(null,[call('one')])).mockResolvedValueOnce(response(null,[call(mode==='third'?'two':'one')])).mockResolvedValueOnce(response(null,[call('three')]));
        f.read.mockImplementation(async(q)=>f.add(['Account '+f.read.mock.calls.length+'\nAllowed fact.'],2));
    }
    await expect(completeNativeLoreLookup(f.context,f.api,f.options)).rejects.toThrow();expect(f.read.mock.calls.length).toBeLessThanOrEqual(mode==='third'?2:mode==='reused-id'?1:0);
    expect(f.finish).toHaveBeenCalledWith(false,{initialFocusOnly:true});
});
test.each(['words','accounts','duplicate','accounting'])('reader %s budget corruption is rejected before final generation',async mode=>{
    const f=fixture();f.create.mockResolvedValueOnce(response(null,[call()]));
    if(mode==='duplicate'){f.d.accounts=['Repeated'];f.d.accountWords=1;f.context.original[0].content+='\nRepeated';}
    f.read.mockImplementation(async()=>{
        if(mode==='words')return f.add(['Too large\nBody.'],351);
        if(mode==='accounts')return f.add(['a','b','c','d'],4);
        if(mode==='duplicate')return f.add(['Repeated'],1);
        return['Not recorded by the reader'];
    });
    await expect(completeNativeLoreLookup(f.context,f.api,f.options)).rejects.toThrow();expect(f.create).toHaveBeenCalledTimes(1);expect(f.finish).toHaveBeenCalledWith(false,{initialFocusOnly:true});
});
test.each(['response','lookup','commit','provider','prompt'])('ownership is rechecked at %s boundary',async phase=>{
    const f=fixture();
    if(phase==='response')f.create.mockImplementation(async()=>{f.revoke();return response('STALE');});
    if(phase==='lookup'){f.create.mockResolvedValue(response(null,[call()]));f.read.mockImplementation(async()=>{f.revoke();return[];});}
    if(['commit','provider','prompt'].includes(phase)){
        const r=await completeNativeLoreLookup(f.context,f.api,f.options);
        if(phase==='commit')f.revoke();if(phase==='provider')f.api.model='changed';if(phase==='prompt')(f.context.original[0]as any).content='changed';
        expect(()=>r!.commit(true)).toThrow('changed');
    }else await expect(completeNativeLoreLookup(f.context,f.api,f.options)).rejects.toThrow('changed');
    expect(f.finish).toHaveBeenCalledWith(false,{initialFocusOnly:true});
});
test.each(['token-budget','missing-word-count','cancel'])('invalid preparation %s starts no generation',async mode=>{
    const f=fixture();if(mode==='token-budget')f.options.countTokens=()=>8192;if(mode==='missing-word-count')delete f.d.accountWords;
    if(mode==='cancel'){const controller=new AbortController();controller.abort();(f.options as any).signal=controller.signal;}
    await expect(completeNativeLoreLookup(f.context,f.api,f.options)).rejects.toBeDefined();expect(f.create).not.toHaveBeenCalled();
});
test('optional lore omitted by final budgeting yields to the complete original with no tools or cursor advance',async()=>{
    const f=fixture();f.context.omittedLore=true;f.d.accounts=['Omitted account\nNever sent.'];f.d.accountWords=3;
    const before=JSON.stringify(f.context.original),r=await completeNativeLoreLookup(f.context,f.api,f.options);
    expect(f.create).toHaveBeenCalledTimes(1);expect(f.create.mock.calls[0][0]).not.toHaveProperty('tools');
    expect(f.create.mock.calls[0][0].messages).toEqual(f.context.original);expect(f.read).not.toHaveBeenCalled();
    expect(JSON.stringify(f.context.original)).toBe(before);r!.commit(true);expect(f.finish).toHaveBeenCalledWith(false,{initialFocusOnly:true});
});
test('one total deadline covers a slow private read and prevents the follow-up provider call',async()=>{
    const f=fixture();f.create.mockResolvedValue(response(null,[call()]));
    let resolveRead!:(value:string[])=>void;f.read.mockImplementation(()=>new Promise(resolve=>{resolveRead=resolve;}));
    const result=completeNativeLoreLookup(f.context,f.api,{...f.options,timeoutMs:20}).then(()=>undefined,error=>error);
    const error=await result;expect(error.message).toContain('deadline');expect(f.create).toHaveBeenCalledTimes(1);
    expect(f.finish).toHaveBeenCalledWith(false,{initialFocusOnly:true});resolveRead([]);await Promise.resolve();expect(f.create).toHaveBeenCalledTimes(1);
});
test('a provider which ignores cancellation cannot keep the caller waiting past the shared deadline',async()=>{
    const f=fixture();let resolveResponse!:(value:any)=>void;
    f.create.mockImplementation(()=>new Promise(resolve=>{resolveResponse=resolve;}));
    const result=completeNativeLoreLookup(f.context,f.api,{...f.options,timeoutMs:20}).then(()=>undefined,error=>error);
    const error=await result;expect(error.message).toContain('deadline');expect(f.finish).toHaveBeenCalledWith(false,{initialFocusOnly:true});
    resolveResponse(response('LATE PROSE'));await new Promise(resolve=>setTimeout(resolve,5));expect(f.create).toHaveBeenCalledTimes(1);
});
test('publication after the total deadline rejects the prepared reply',async()=>{
    const f=fixture(),r=await completeNativeLoreLookup(f.context,f.api,{...f.options,timeoutMs:20});
    await new Promise(resolve=>setTimeout(resolve,25));expect(()=>r!.commit(true)).toThrow('deadline');expect(f.finish).toHaveBeenCalledWith(false,{initialFocusOnly:true});
});
test('explicit study tool omission retains the complete ordinary prompt and source guard',async()=>{
    const f=fixture();f.d.knowledge={access:'not_requested',intent:'none'};
    const r=await completeNativeLoreLookup(f.context,f.api,{...f.options,offerTools:false});expect(f.create.mock.calls[0][0]).not.toHaveProperty('tools');
    expect(f.create.mock.calls[0][0].messages).toEqual(f.context.original);expect(f.read).not.toHaveBeenCalled();
    f.revoke();expect(()=>r!.commit(true)).toThrow('changed');expect(f.finish).toHaveBeenCalledWith(false,{initialFocusOnly:true});
});
test.each(['none','query','continue',undefined] as const)('reader intent %s alone does not suppress a possible narrative lookup',async intent=>{
    const f=fixture();f.d.knowledge={access:'not_requested',intent};
    const r=await completeNativeLoreLookup(f.context,f.api,f.options);expect(f.create.mock.calls[0][0]).toHaveProperty('tools');r!.commit(false);
});
test('a narrative memorial action can request a real setting detail despite reader no-query grammar',async()=>{
    const f=fixture();f.context.original[1].content='I place the servant’s work beside the coral memorial and wait for you to begin.';
    f.d.knowledge={access:'not_requested',intent:'none'};
    f.create.mockResolvedValueOnce(response(null,[call('narrative','Naga mourning customs')])).mockResolvedValueOnce(response('"We could ask her patron to name her."'));
    f.read.mockImplementation(async()=>f.add(['Naga custom\nServants are remembered collectively unless a patron singles one out.'],12));
    const r=await completeNativeLoreLookup(f.context,f.api,f.options);expect(r?.lookups[0].accountsAdded).toBe(1);expect(f.read).toHaveBeenCalledTimes(1);r!.commit(false);
});
test('unsupported provider and absent reader use no new path or calls',async()=>{
    const f=fixture();f.api.type='gemini';expect(await completeNativeLoreLookup(f.context,f.api,f.options)).toBeNull();
    expect(await completeNativeLoreLookup(undefined,f.api,f.options)).toBeNull();expect(f.create).not.toHaveBeenCalled();
});
test('only the owned current speaker name moves into content; original words and prior names remain',()=>{
    const history:any=[{role:'assistant',name:'Tova',content:'Earlier reply.',rawContent:'NOT_SENT'},
        {role:'user',name:'Rian',content:'What does my master require?',id:'current',tool_calls:[call()]}];
    const before=JSON.stringify(history),result=nativeLookupMessages(history,history[1]);
    expect(result).toEqual([{role:'assistant',name:'Tova',content:'Earlier reply.'},{role:'user',content:'Rian: What does my master require?'}]);
    expect(JSON.stringify(history)).toBe(before);expect(JSON.stringify(result)).not.toContain('NOT_SENT');
});
test('stored RP fields cannot smuggle native calls or a tool result into the original prompt',()=>{
    const message:any={role:'assistant',content:'Ordinary past speech.',tool_calls:[call()]};
    expect(nativeLookupMessages([message])).toEqual([{role:'assistant',content:'Ordinary past speech.'}]);
    expect(()=>nativeLookupMessages([{role:'tool',tool_call_id:'unknown',content:'bad'}]as any)).toThrow('original RP');
});
test('a current speaker reference must be the actual retained message, not matching copied text or a system instruction',()=>{
    const f=fixture();expect(()=>nativeLookupMessages(f.context.original,{...f.context.original[1]})).toThrow('owned');
    expect(()=>nativeLookupMessages(f.context.original,f.context.original[0])).toThrow('owned');
});
test('the actual adapter sends the current participant label without altering the saved prompt',async()=>{
    const f=fixture();(f.options as any).currentTurn=f.context.original[1];const before=JSON.stringify(f.context.original);
    const r=await completeNativeLoreLookup(f.context,f.api,f.options);expect(f.create.mock.calls[0][0].messages[1]).toEqual({role:'user',content:'Visitor: Please stay.'});
    expect(JSON.stringify(f.context.original)).toBe(before);r!.commit(false);
});
test('only the explicit controlled-prose caller may pass a partial final reply to its existing format recovery',async()=>{
    const f=fixture();f.create.mockResolvedValue(response('Partial **reply',undefined,'length'));
    await expect(completeNativeLoreLookup(f.context,f.api,f.options)).rejects.toThrow('Incomplete');
    const g=fixture();g.create.mockResolvedValue(response('Partial **reply',undefined,'length'));
    const r=await completeNativeLoreLookup(g.context,g.api,{...g.options,allowIncomplete:true});expect(r?.finishReason).toBe('length');r!.commit(false);
});
test.each(['budget','context','source-callback'])('pending %s ownership cannot change before publication',async kind=>{
    const f=fixture(),r=await completeNativeLoreLookup(f.context,f.api,f.options);
    if(kind==='budget')f.options.maxOutputTokens++;
    if(kind==='context')f.api.context++;
    if(kind==='source-callback')f.options.isCurrent=()=>true;
    expect(()=>r!.validate()).toThrow('changed');expect(()=>r!.commit(true)).toThrow('changed');
    expect(f.finish).toHaveBeenCalledWith(false,{initialFocusOnly:true});
});
