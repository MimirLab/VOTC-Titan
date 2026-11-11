import { createHash } from 'crypto';
import type { Conversation } from '../conversation/Conversation';
import type { Character } from '../../shared/gameData/Character';
import type { Message } from '../ts/conversation_interfaces';
import type { LoreDelivery } from './lorebookDisclosure';
import { getEffectiveCharacterDescription } from '../characterDescription';
import { getCultureBackground } from '../culture/cultureRuntime';
import { getFaithBackground, bindFaithLiveContext } from '../faith/faithRuntime';
import { getVerifiedGoaSnapshot } from '../goa/goaRuntime';

export interface NativeLoreContext {
    original:Message[]; actor:Character; delivery:LoreDelivery; omittedLore:boolean;
    /** Perceived message retained by this builder, never recovered from user text. */
    currentTurn?:Message;
    isCurrent:()=>boolean;
}
export interface NativeLoreCapture { preparing?:boolean; preview?:boolean; value?:NativeLoreContext }

/** Bind prepared religious facts to their source observation across the reply.
 * Cache freshness still controls what a new prompt can acquire.
 */
export function nativeLoreSourceCurrent(conv:Conversation,actor:Character,data:string):()=>boolean{
    const game=conv.gameData,participants=[...game.characters.entries()];
    const faithContexts=participants.map(([id,person])=>({id,binding:bindFaithLiveContext(person)}));
    const snapshot=()=>{
        const goa=getVerifiedGoaSnapshot(actor);
        const culture=getCultureBackground(actor);
        const faith=getFaithBackground(actor);
        return{
            config:conv.config,history:conv.messages,summary:conv.currentSummary,historical:conv.historicalConversations,
            game:{...game,characters:undefined,silencedCharacterIds:[...(game.silencedCharacterIds??[])]},
            participants:[...game.characters.entries()].map(([id,person])=>[id,{...person,faithLiveContext:undefined}]),
            goa,personal:participants.map(([id])=>[id,getEffectiveCharacterDescription(data,String(game.playerID),String(id))]),
            culture,faith,faithLive:faithContexts.map(({id,binding})=>{
                const context=binding.context;
                return[id,context&&Object.keys(context).length?context:undefined];
            })
        };
    };
    const fingerprint=()=>createHash('sha256').update(JSON.stringify(snapshot())).digest('hex');
    const binding=fingerprint();
    return()=>{
        try{
            return conv.isOpen!==false&&conv.gameData===game&&game.characters.get(actor.id)===actor&&
                participants.length===game.characters.size&&participants.every(([id,person])=>game.characters.get(id)===person)&&
                faithContexts.every(({binding})=>binding.isCurrent())&&fingerprint()===binding;
        }catch{return false;}
    };
}

export function captureNativeLorePrompt(capture:NativeLoreCapture|undefined,original:Message[],actor:Character,
    delivery:LoreDelivery,observed:readonly Message[],ownedLore:Message|undefined,isCurrent:()=>boolean):Message[]{
    if(!capture)return original;
    if(!isCurrent())throw new Error('Character sources changed while building the native lore prompt.');
    const included=!!ownedLore&&original.includes(ownedLore);
    if(included&&(delivery.accounts??[]).some(account=>!ownedLore!.content.includes(account)))
        throw new Error('Native lore accounts differ from their builder-owned message.');
    const current=observed.at(-1);
    capture.value={original,actor,delivery,omittedLore:!!delivery.accounts?.length&&!included,
        currentTurn:current&&original.includes(current)?current:undefined,isCurrent};
    return original;
}
