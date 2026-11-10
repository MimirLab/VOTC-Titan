import type { Conversation } from '../conversation/Conversation';
import type { Character } from '../../shared/gameData/Character';
import type { Message } from '../ts/conversation_interfaces';
import type { NativeLoreContext } from './lorebookNativeContext';
import { completeNativeLoreLookup } from './lorebookNativeLookup';
import { spokenPublicationSessions } from './lorebookSpokenPublication';

/** Isolated research switch only. Existing streaming/instruct/provider behavior
 * stays on its ordinary writer until those paths have their own integration.
 */
export function nativeLoreChatEnabled(conv:Conversation):boolean{
    const api=conv.textGenApiConnection;
    return process.env.VOTC_LORE_NATIVE_CHAT_STUDY==='1'&&!conv.config.stream&&api.type==='custom'&&!api.forceInstruct&&api.isChat();
}
export interface NativeLoreChatReply {
    reply:string; providerCalls:number; lookups:readonly {query:string;accountsAdded:number}[]; finishReason?:string|null;
    validate:()=>void; finish:(accepted:boolean,message?:Message)=>void;
}

export async function completeNativeLoreChat(conv:Conversation,actor:Character,context:NativeLoreContext|undefined,
    parameters:Record<string,unknown>,signal?:AbortSignal,prompt:Message[]=context?.original??[],controlled=false):Promise<NativeLoreChatReply|undefined>{
    if(!context)return;
    const api=conv.textGenApiConnection;
    const check=()=>{
        signal?.throwIfAborted();
        if(context.actor!==actor||conv.textGenApiConnection!==api||!context.isCurrent())
            throw new Error('Character sources changed during the native lore turn.');
    };
    check();
    // Controlled-prose recovery may append its normal formatting instruction;
    // it cannot replace or drop any retained original provider message.
    if(prompt.length<context.original.length||context.original.some((m,i)=>
        prompt[i].role!==m.role||prompt[i].content!==m.content||prompt[i].name!==m.name))
        throw new Error('Native codec request changed the original RP context.');
    const maxOutputTokens=Number(parameters.max_tokens??conv.config.maxTokens);
    const budget=process.env.VOTC_LORE_NATIVE_THINKING_BUDGET;
    let boundedParameters=parameters;
    if(budget!==undefined&&api.model==='mimir-bigbrain'&&parameters.thinking_token_budget===undefined){
        const value=Number(budget);
        // Mimir -1 leaves reasoning uncapped within the normal total output allowance.
        if(!Number.isInteger(value)||(value!==-1&&(value<64||value>2048||value>=maxOutputTokens)))
            throw new Error('Invalid Mimir lore reasoning allowance.');
        boundedParameters={...parameters,thinking_token_budget:value};
    }
    const result=await completeNativeLoreLookup({...context,original:prompt},api,{parameters:boundedParameters,
        maxOutputTokens,signal,allowIncomplete:controlled,
        isCurrent:()=>{check();return true;}});
    try{check();}catch(error){result?.commit(false);throw error;}
    if(!result)return;
    // Keep optional speaker-name transfer DISABLED: heldout tests rejected it.
    let finished=false;
    return{reply:result.reply,providerCalls:result.providerCalls,lookups:result.lookups,finishReason:result.finishReason,
        validate:()=>{check();result.validate();},finish:(accepted,message)=>{
            if(finished)return;
            try{
                if(accepted){
                    check();result.validate();
                    if(!message||message.role!=='assistant'||message.characterId!==actor.id||!message.content.trim())
                        throw new Error('Native lore publication requires the actual acting character message.');
                    const fingerprint=()=>JSON.stringify([message.role,message.characterId,message.content,message.proseEncoding,
                        message.spokenLanguageId,(message as any).targetCharacterIds]);
                    const published=fingerprint();
                    // Check the live history later; callers may enqueue a
                    // returned message after generateNewAIMessage(false).
                    const retained=()=>{
                        const history=context.delivery.spokenAudience&&typeof conv.getCanonicalEncounterMessagesForLore==='function'
                            ?conv.getCanonicalEncounterMessagesForLore():conv.messages;
                        return conv.isOpen!==false&&Array.isArray(history)&&history.includes(message)&&fingerprint()===published;
                    };
                    result.commit(true,retained);
                    if(!context.omittedLore)spokenPublicationSessions.queue(context.delivery,context.original,message,retained);
                }else result.commit(false);
                finished=true;
            }
            catch(error){result.commit(false);finished=true;throw error;}
        }};
}
