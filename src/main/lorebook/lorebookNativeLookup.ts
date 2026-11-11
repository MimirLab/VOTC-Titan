import type { ApiConnection } from '../../shared/apiConnection';
import { NativeChatMessage, nativeChatMessages } from '../../shared/nativeChat';
import type { Message } from '../ts/conversation_interfaces';
import type { LoreDelivery } from './lorebookDisclosure';
import { rememberedTurningNotes } from './loreMutationDisclosure';
import { currentStateAccountNotes } from './loreGameStateDisclosure';

export const LORE_LOOKUP_TOOL={type:'function',function:{name:'lore_lookup',strict:true,
    description:'Privately read an additional relevant Warcraft account only when this reply needs a missing setting detail. The reader limits this character and date. A read that returns no account adds no new facts. Ordinary gestures, company and personal choices need no lookup. Keep searches private and return normal in-character RP.',
    parameters:{type:'object',properties:{query:{type:'string',minLength:1,maxLength:256}},required:['query'],additionalProperties:false}}};
export interface NativeLookupContext { original:readonly Message[]; delivery:LoreDelivery; omittedLore?:boolean }
export interface NativeLookupResult {
    reply:string; providerCalls:number; lookups:readonly {query:string;accountsAdded:number}[];
    assurance:'guarded-input-only'; finishReason?:string|null; validate:()=>void; commit:(accepted:boolean,retainedPublication?:()=>boolean)=>void;
}

/** A stored RP record cannot introduce native control messages. The actual
 * current participant may be labelled in content for endpoints with weak name
 * cues; keep every original utterance and leave the stored prompt unchanged.
 */
export function nativeLookupMessages(original:readonly Message[],currentTurn?:Message):NativeChatMessage[]{
    const projected:NativeChatMessage[]=original.map(message=>{
        if(!['system','user','assistant'].includes(message.role)||typeof message.content!=='string')throw new Error('Invalid original RP message.');
        return{role:message.role,content:message.content,...(typeof message.name==='string'&&message.name.trim()?{name:message.name}:{})};
    });
    if(currentTurn){
        const index=original.indexOf(currentTurn);
        if(index<0||!['user','assistant'].includes(currentTurn.role))throw new Error('Current speaker turn is not an owned conversation message.');
        if(currentTurn.name?.trim()){
            projected[index].content=currentTurn.name+': '+projected[index].content;
            delete projected[index].name;
        }
    }
    return nativeChatMessages(projected);
}

/** No selector/reviewer/realizer call: one ordinary completion, optional bounded reads.
 * Private lookup focus is not evidence that the character spoke those accounts.
 */
export async function completeNativeLoreLookup(context:NativeLookupContext|undefined,api:ApiConnection,options:{
    parameters:Record<string,unknown>;maxOutputTokens:number;signal?:AbortSignal;isCurrent:()=>boolean;
    currentTurn?:Message;
    /** The existing controlled-prose validator owns its one format recovery. */
    allowIncomplete?:boolean;
    /** One budget for the complete writer/read chain, including provider queue waits. */
    timeoutMs?:number;
    /** Explicit research control. Query grammar alone cannot prove lore unnecessary. */
    offerTools?:boolean;
    countTokens?:(messages:readonly NativeChatMessage[],tools:readonly unknown[])=>number;
}):Promise<NativeLookupResult|null>{
    if(!context)return null;
    const d=context.delivery;
    if(!d.required&&!d.isCurrent)return null;
    if(api.type!=='custom'||api.forceInstruct||!api.isChat())return null;
    if(!d.preparing||!d.isCurrent||!d.requestMore||!d.finishPreparation)
        throw new Error('Native lookup needs a complete prepared actor-bound prompt.');
    const current=d.isCurrent,read=d.requestMore,finish=d.finishPreparation;
    const originalBinding=JSON.stringify(context.original),parameterBinding=JSON.stringify(options.parameters);
    const providerBinding=()=>JSON.stringify([api.type,api.model,api.forceInstruct,api.config,api.parameters,api.client?.baseURL,api.client?.apiKey]);
    const provider=providerBinding(),client=api.client;
    const currentTurn=options.currentTurn;
    const maxOutputTokens=options.maxOutputTokens,allowIncomplete=options.allowIncomplete,countTokens=options.countTokens,sourceCurrent=options.isCurrent,contextSize=api.context;
    const omittedLore=context.omittedLore,configuredTimeout=options.timeoutMs,offerTools=options.offerTools;
    let deadlineTimer:ReturnType<typeof setTimeout>|undefined,signal=options.signal,deadlineAt=0;
    let finished=false;
    const clearDeadline=()=>{if(deadlineTimer!==undefined){clearTimeout(deadlineTimer);deadlineTimer=undefined;}};
    const release=()=>{if(!finished){finished=true;clearDeadline();finish(false,{initialFocusOnly:true});}};
    const check=()=>{
        signal?.throwIfAborted();
        if(deadlineAt&&Date.now()>=deadlineAt)throw new Error('Native lore turn deadline exceeded.');
        if(options.isCurrent!==sourceCurrent||!sourceCurrent()||options.maxOutputTokens!==maxOutputTokens||options.allowIncomplete!==allowIncomplete||
            options.timeoutMs!==configuredTimeout||options.offerTools!==offerTools||context.omittedLore!==omittedLore||options.countTokens!==countTokens||api.context!==contextSize||options.currentTurn!==currentTurn||d.isCurrent!==current||d.requestMore!==read||d.finishPreparation!==finish||!current()||
            JSON.stringify(context.original)!==originalBinding||JSON.stringify(options.parameters)!==parameterBinding||api.client!==client||providerBinding()!==provider)
            throw new Error('Character knowledge or provider changed during native lookup.');
    };
    const bounded=<T>(operation:Promise<T>):Promise<T>=>new Promise((resolve,reject)=>{
        const onAbort=()=>{cleanup();reject(signal?.reason??new Error('Native lore turn cancelled.'));};
        const cleanup=()=>signal?.removeEventListener('abort',onAbort);
        operation.then(value=>{cleanup();resolve(value);},error=>{cleanup();reject(error);});
        signal?.addEventListener('abort',onAbort,{once:true});if(signal?.aborted)onAbort();
    });
    const words=()=>{
        if(!Number.isInteger(d.accountWords)||d.accountWords! < 0||d.accountWords! > 350)throw new Error('Native lookup lacks an exact reader word budget.');
        return d.accountWords!;
    };
    try{
        const timeoutMs=configuredTimeout??120_000;
        if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>120_000)throw new Error('Invalid total native lore turn deadline.');
        const deadline=new AbortController();deadlineAt=Date.now()+timeoutMs;
        deadlineTimer=setTimeout(()=>deadline.abort(new Error('Native lore turn deadline exceeded.')),timeoutMs);deadlineTimer.unref?.();
        signal=options.signal?AbortSignal.any([options.signal,deadline.signal]):deadline.signal;
        check();
        if(!Number.isInteger(options.maxOutputTokens)||options.maxOutputTokens<1||!Number.isFinite(api.context)||api.context<1)
            throw new Error('Invalid native lookup token budget.');
        // Optional lore yields before the original context. If it was trimmed,
        // use the complete retained original for one guarded ordinary reply;
        // no omitted account or additional private read is made available.
        const initial=omittedLore?[]:[...(d.accounts??[])];let accounts=[...initial];
        if(accounts.length>3||accounts.some(a=>typeof a!=='string'||!a.trim()))throw new Error('Invalid native lookup accounts.');
        if(initial.some(account=>!context.original.some(message=>message.content.includes(account))))throw new Error('Initial lore was not retained in the original prompt.');
        words();
        // A narrative action may need a custom even without a grammatical
        // question. Keep the opportunity unless this explicit control omits it.
        const lookupRequested=offerTools!==false;
        const messages=nativeLookupMessages(context.original,currentTurn),lookups:{query:string;accountsAdded:number}[]=[],ids=new Set<string>();
        let providerCalls = 0;
        for(let index=0;index<3;index++){
            check();const beforeWords=words(),room={maxWords:350-beforeWords,maxAccounts:3-accounts.length};
            let allow=lookupRequested&&!omittedLore&&lookups.length<2&&room.maxWords>0&&room.maxAccounts>0;
            const tokens = (tools: readonly unknown[]) => options.countTokens ? options.countTokens(messages, tools) :
                api.calculateTokensFromText(JSON.stringify({messages,tools}))+messages.length*8;
            const fits = (count: number) => Number.isFinite(count) && count >= 0 && count + maxOutputTokens <= api.context;
            if (allow && !fits(tokens([LORE_LOOKUP_TOOL]))) allow = false;
            if (!fits(tokens(allow ? [LORE_LOOKUP_TOOL] : []))) throw new Error('Native lookup exceeds context budget.');
            const request = () => {
                providerCalls++;
                return bounded(api.completeWithTools(messages,{...options.parameters,max_tokens:options.maxOutputTokens,
                    ...(allow?{tools:[LORE_LOOKUP_TOOL],tool_choice:'auto',parallel_tool_calls:false}:{})},
                    {isCurrent:()=>{check();return true;},signal,timeoutMs:Math.max(1,deadlineAt-Date.now())}));
            };
            let response;
            try { response = await request(); }
            catch (error) {
                check(); // Cancellation, stale actor, or changed provider must still abort.
                const e = error as any;
                const detail = [e.message, e.error?.message, e.param, e.error?.param].filter(Boolean).join(' ');
                if (!allow || messages.some(message => message.role === 'tool') ||
                    ![400,404,422].includes(e.status) || !/\btools?\b|tool_choice|parallel_tool_calls/i.test(detail)) throw error;
                allow = false;
                response = await request();
            }
            check();
            if(response.toolCalls?.length){
                if(!allow||response.toolCalls.length!==1||!['stop','tool_calls'].includes(response.finishReason??''))throw new Error('Unexpected native lookup calls.');
                const call=response.toolCalls[0];
                if(call.function.name!=='lore_lookup'||ids.has(call.id))throw new Error('Invalid native lookup call identity.');
                const value=JSON.parse(call.function.arguments);
                if(!value||Array.isArray(value)||Object.keys(value).join(',')!=='query'||typeof value.query!=='string'||!value.query.trim()||value.query.length>256)
                    throw new Error('Invalid private lore query.');
                ids.add(call.id);
                const added=await bounded(read(value.query,room));check();
                if(!Array.isArray(added)||added.length>room.maxAccounts||added.some(a=>typeof a!=='string'||!a.trim()||accounts.includes(a))||words()<beforeWords||
                    (!added.length&&words()!==beforeWords)||(added.length>0&&words()<=beforeWords))throw new Error('Private lore result exceeds its account budget.');
                accounts=[...accounts,...added];
                if(JSON.stringify(d.accounts??[])!==JSON.stringify(accounts))throw new Error('Private lore result differs from its reader accounting.');
                lookups.push({query:value.query,accountsAdded:added.length});
                // Pre-tool prose is a private draft; it never enters the next
                // prompt, visible stream, RP history, summaries or Audio.
                const guidance=added.length?
                            'Use the supplied accounts for established setting claims, retaining exceptions, uncertainty and roles. Put additional details into present proposals or questions. Community customs grant no personal powers or compulsory choices.':
                            'No additional account was supplied. This read establishes no new fact. Use facts already established in the original context and supplied accounts. If those do not establish the requested detail, remain uncertain in character without inventing confirming hearsay or memories.';
                messages.push({role:'assistant',content:null,tool_calls:[call]},
                    {role:'tool',tool_call_id:call.id,content:JSON.stringify({status:added.length?'provided':'not_available',accounts:added,guidance,
                        ...((d.turningContexts??[]).some(context=>added.includes(context.account))?
                            {rememberedTurnings:rememberedTurningNotes((d.turningContexts??[]).filter(context=>added.includes(context.account)))}:{}),
                        ...((d.currentStateContexts??[]).some(context=>added.includes(context.account))?
                            {currentStateApplicability:currentStateAccountNotes((d.currentStateContexts??[]).filter(context=>added.includes(context.account)))}:{}),
                        ...(added.length&&d.currentWorldStateNotes?{privateWorldConstraints:d.currentWorldStateNotes}:{})})});
                continue;
            }
            if((response.finishReason!=='stop'&&!(allowIncomplete&&response.finishReason==='length'))||
                (!allowIncomplete&&!response.content.trim()))throw new Error('Incomplete native RP reply.');
            const commit=(accepted:boolean,retainedPublication?:()=>boolean)=>{
                if(finished)return;
                if(accepted){try{check();}catch(error){release();throw error;}}
                finished=true;clearDeadline();finish(accepted&&initial.length>0,{initialFocusOnly:true,...(retainedPublication?{retainedPublication}:{})});
            };
            return{reply:response.content,providerCalls,lookups,assurance:'guarded-input-only',finishReason:response.finishReason,validate:check,commit};
        }
        throw new Error('Native lookup turn limit exceeded.');
    }catch(error){release();throw error;}
}
