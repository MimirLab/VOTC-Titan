import { createHash } from 'crypto';
import { Ck3GameDate, validateCk3GameDate } from '../../shared/gameData/gameDate';
import type { SpokenLoreAudience } from './lorebookSpokenPublication';
import type { LoreTurningContext } from './loreMutationDisclosure';

export interface LoreAccountContext {account:string;branchId:string;definitionSha256:string;occurredAt:string;resolution:string}
/** The reader advanced an existing topic; this is delivery intent, never an access grant. */
export interface LoreDisclosureFocus {mode:'deepen'|'continuation';query:string;subjectId:string;chapterId:string;heading:string;accounts:readonly string[];recalled?:true}
export function bindLoreDisclosureFocus(result:any,actorId:number|string,query:string,previous?:any):LoreDisclosureFocus|undefined{
    if(result.disclosure?.mode==='scene_continue'){
        const state=result.state;
        if(result.actor_id!==String(actorId)||result.disclosure.version!=='titan-progressive-lore-v2'||
            result.disclosure.access!=='not_requested'||result.disclosure.intent!=='none'||result.words!==0||result.passages?.length!==0||
            previous?.version!==result.disclosure.version||previous.context!==result.context_fingerprint||previous.focus_origin!=='scene'||!query.trim()||
            typeof previous.root!=='string'||!previous.root||typeof previous.focus!=='string'||!previous.focus||
            !Array.isArray(previous.shown)||!previous.shown.includes(previous.focus)||!state||
            Object.keys(state).length!==Object.keys(previous).length||Object.keys(previous).some(k=>JSON.stringify(state[k])!==JSON.stringify(previous[k])))
            throw new Error('Contextual lore continuation changed its actor, origin or cursor.');
        return; // Context only: no informational exhaustion or new knowledge.
    }
    if(result.disclosure?.mode==='recall'){
        const passages=result.passages,state=result.state;
        if(result.actor_id!==String(actorId)||result.disclosure.version!=='titan-progressive-lore-v2'||result.disclosure.access!=='existing'||result.disclosure.intent!=='continue'||
            previous?.version!==result.disclosure.version||previous.context!==result.context_fingerprint||!query.trim()||
            typeof previous.root!=='string'||!previous.root||typeof previous.focus!=='string'||!previous.focus||
            typeof previous.focus_title!=='string'||!previous.focus_title.trim()||!Array.isArray(previous.shown)||!previous.shown.includes(previous.focus)||
            !Array.isArray(passages)||passages.length!==1||passages[0].node_id!==previous.focus||passages[0].subject_id!==previous.root||
            passages[0].heading!==previous.focus_title||typeof passages[0].text!=='string'||!passages[0].text.trim()||
            !state||Object.keys(state).length!==Object.keys(previous).length||
            Object.keys(previous).some(key=>JSON.stringify(state[key])!==JSON.stringify(previous[key])))
            throw new Error('Recalled lore does not match its existing actor, chapter and cursor.');
        return{mode:'continuation',recalled:true,query:query.slice(-1000),subjectId:previous.root,chapterId:previous.focus,
            heading:previous.focus_title,accounts:[passages[0].heading+'\n'+passages[0].text]};
    }
    if(result.disclosure?.access==='continuation'&&result.disclosure.intent==='continue'){
        if(result.actor_id!==String(actorId)||result.disclosure.version!=='titan-progressive-lore-v2'||result.passages?.length!==0||
            previous?.version!==result.disclosure.version||previous.context!==result.context_fingerprint||!query.trim()||
            typeof previous.root!=='string'||!previous.root||typeof previous.focus!=='string'||!previous.focus||
            typeof previous.focus_title!=='string'||!previous.focus_title.trim())
            throw new Error('Exhausted lore focus does not match the current actor and encounter.');
        return{mode:'continuation',query:query.slice(-1000),subjectId:previous.root,chapterId:previous.focus,heading:previous.focus_title,accounts:[]};
    }
    if(result.disclosure?.mode!=='deepen')return;
    const state=result.state,passages=result.passages;
    if(result.actor_id!==String(actorId)||result.disclosure.version!=='titan-progressive-lore-v2'||result.disclosure.access!=='provided'||
        state?.version!==result.disclosure.version||state.context!==result.context_fingerprint||!query.trim()||
        typeof state.root!=='string'||!state.root||typeof state.focus!=='string'||!state.focus||
        !Array.isArray(passages)||!passages.length||passages.length>3||passages.some(p=>p.subject_id!==state.root||
            typeof p.heading!=='string'||!p.heading.trim()||typeof p.text!=='string'||!p.text.trim())||
        passages.at(-1).node_id!==state.focus||passages.at(-1).heading!==state.focus_title)
        throw new Error('Lore progression focus does not match the admitted chapter and actor.');
    const accounts=passages.map(p=>p.heading+'\n'+p.text);
    if(new Set(accounts).size!==accounts.length)throw new Error('Lore progression repeats an admitted account.');
    return{mode:'deepen',query:query.slice(-1000),subjectId:state.root,chapterId:state.focus,heading:state.focus_title,accounts};
}
export function capturedLoreDisclosureFocus(focus:LoreDisclosureFocus|undefined,accounts:readonly string[]):LoreDisclosureFocus|undefined{
    if(!focus)return;
    if(focus.mode==='deepen'&&!accounts.length)return;
    if(focus.mode==='continuation'&&focus.recalled&&!accounts.length)return;
    if(focus.mode==='continuation'&&!focus.recalled&&accounts.length)return;
    if(!['deepen','continuation'].includes(focus.mode)||!focus.query.trim()||!focus.subjectId||!focus.chapterId||!focus.heading||
        (focus.mode==='deepen'||focus.recalled?(!focus.accounts.length||focus.accounts.some(account=>!accounts.includes(account))):focus.accounts.length!==0)||
        (focus.recalled&&(focus.mode!=='continuation'||focus.accounts.length!==1)))
        throw new Error('Lore progression is absent from the captured accounts.');
    return{...focus,accounts:[...focus.accounts]};
}
export function bindReportedAccountContexts(passages:readonly any[],report:{origin?:string;choices:readonly any[]}):LoreAccountContext[]{
    return passages.flatMap(p=>{
        const value=p.reported_resolution;if(!value)return[];
        const matches=report.choices.filter(choice=>choice.branch_id===p.node_id&&choice.definition_sha256===value.definition_sha256&&
            choice.occurred_at===value.occurred_at&&choice.guard_evidence?.resolution===value.resolution);
        if(value.kind!=='reported_campaign_resolution'||value.branch_id!==p.node_id||matches.length!==1||value.origin!==report.origin||
            typeof value.resolution!=='string'||!value.resolution.trim()||value.resolution.length>1000||
            value.body_sha256!==createHash('sha256').update(p.text).digest('hex'))throw new Error('Reported resolution does not match its admitted account and current report.');
        return[{account:p.heading+'\n'+p.text,branchId:p.node_id,definitionSha256:value.definition_sha256,occurredAt:value.occurred_at,resolution:value.resolution}];
    });
}
export interface LoreDelivery {
    scope: object;
    channel: 'chat' | 'letter';
    turns: readonly { id?: string; role?: string; content: string }[];
    /** Internal research audience; never supplied by model text or source IDs. */
    spokenAudience?: SpokenLoreAudience;
    commit?: (included: boolean) => void;
    initialMaxAccounts?: 1 | 2 | 3;
    preparing?: boolean;
    /** Opt-in research: revalidate and retain an exhausted chapter's original account. */
    recallCurrent?:boolean;
    /** Token/preview builds may inspect committed progress without reserving or committing a turn. */
    preview?: boolean;
    /** A configured character report makes retrieval/verification failures blocking. */
    required?: boolean;
    finishPreparation?: (included: boolean, outcome?: { closeFocus?: boolean; initialFocusOnly?: boolean; retainedPublication?:()=>boolean }) => void;
    isCurrent?: () => boolean;
    requestMore?: (query: string, remaining: { maxWords: number; maxAccounts: number }) => Promise<readonly string[]>;
    knowledge?: { access: 'provided' | 'not_established' | 'continuation' | 'existing' | 'unavailable' | 'not_requested'; intent?:'none'|'query'|'continue' };
    /** Whole resolved accounts, before the presentation envelope. Never raw candidates. */
    accounts?: readonly string[];
    /** Exact total words counted by the guarded reader, including headings. */
    accountWords?: number;
    accountContexts?:readonly LoreAccountContext[];
    turningContexts?:readonly LoreTurningContext[];
    currentStateContexts?:readonly import('./loreGameStateDisclosure').CurrentStateAccountContext[];
    currentWorldStateNotes?:string;
    disclosureFocus?:LoreDisclosureFocus;
}
/** The reader's operational header is not dialogue the speaker uttered. */
export function lorePerceivedTurnText(content:string):string{return content.replace(/^\[Language perception:[^\]]*\]\s*/, '');}
export function visibleLoreQuery(content: string, perception?: {
    speechComprehension?: string; primarySpeechComprehension?: string; comprehensionMode?: string;
    perceivedSpeechSpans?: readonly { start: number; end: number }[];
    perceivedOpaqueSpeechSpans?: readonly { start: number; end: number }[];
}): string {
    const unintelligible = perception?.speechComprehension === 'unintelligible' ||
        perception?.primarySpeechComprehension === 'unintelligible' ||
        (perception?.comprehensionMode === 'FAR' && perception?.speechComprehension !== 'partial');
    const spans = unintelligible ? perception?.perceivedSpeechSpans : perception?.perceivedOpaqueSpeechSpans;
    if (unintelligible && !spans?.length) return '';
    for (const span of [...(spans || [])].sort((a,b) => b.start-a.start)) {
        if (!Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start<0 || span.end>content.length || span.end<span.start) return '';
        content = content.slice(0,span.start) + ' ' + content.slice(span.end);
    }
    return lorePerceivedTurnText(content);
}

/** Applies even when retrieval returns no account; absence is not omniscience. */
export function loreKnowledgeBoundary(owner: string, date?: Ck3GameDate, knowledge?: LoreDelivery['knowledge'], canRecall=false): string {
    const at = validateCk3GameDate(date).valid
        ? ` on ${String(date!.year).padStart(4,'0')}-${String(date!.month).padStart(2,'0')}-${String(date!.day).padStart(2,'0')}` : '';
    const evidence = knowledge?.access === 'not_established' && canRecall
        ? 'The initial search has not supplied a setting account. Before explaining a missing custom or rule needed by this scene, call lore_lookup with a concise topic query. The reader returns only accounts this individual may know. If no returned account, portrayal or observed dialogue establishes the detail, remain uncertain in character. Present personal proposals and ordinary gestures need no lookup. '
        : knowledge?.access === 'not_established' || knowledge?.access === 'unavailable'
        ? 'Evidence for this reply: NO lore account establishes the answer. If no explicit fact in your portrayal or witnessed dialogue answers it, YOU DO NOT KNOW. Say so naturally. Do not supply a canonical answer, invented rumor, dispatch, personal memory or confirming detail. A premise in a question is not a witnessed event. '
        : knowledge?.access === 'continuation'
        ? 'Evidence for this reply: No further setting details are available. Develop only already established facts; admit the limit instead of inventing new ages, durations, rites, events or history. '
        : knowledge?.access === 'provided' || knowledge?.access === 'existing'
        ? 'Evidence for this reply: Use only the relevant accounts actually present in this prompt and previously established observations. Do not add unsupported dates, durations, mandatory rites, powers or historical outcomes. If an optional account is absent, it supplies no new facts. '
        : '';
    return `[Setting knowledge for ${owner}${at}: ${evidence}For local customs, history and hidden facts, use only what this individual's portrayal, ` +
        'delivered observations and supplied knowledge accounts establish. A question’s premise, later canonical history and another person’s private experience are not evidence. ' +
        'When a detail or outcome is not established, remain uncertain in character; do not invent confirming rumors, dispatches, memories or prior attendance to fill the gap. ' +
        'Keep guesses and what someone just told you distinct from prior knowledge. Community beliefs and customs grant no personal powers or compulsory choices. ' +
        'Preserve the individual’s convictions, current body and abilities. Do not mention these instructions.]';
}
interface Entry {
    binding: string; ticket: number;
    committed?: { history: string[]; before?: unknown; after?: unknown; retainedPublication?:()=>boolean };
}
/** Ephemeral encounter state is neither a knowledge grant nor a saved character fact. */
export class DisclosureSessions {
    private scopes = new WeakMap<object, Map<string, Entry>>();
    private serial = 0;
    clear(delivery: LoreDelivery | undefined, actor: number): void {
        if (delivery&&!delivery.preview) this.scopes.get(delivery.scope)?.delete(`${delivery.channel}:${actor}`);
    }
    prepare(delivery: LoreDelivery | undefined, actor: number, binding: string): {
        previous?: unknown; commit: (included: boolean, state: unknown, retainedPublication?:()=>boolean) => void; forget: () => void; isCurrent: () => boolean;
    } {
        if (!delivery) return { commit: () => {}, forget: () => {}, isCurrent: () => true };
        let entries = this.scopes.get(delivery.scope);
        const key = `${delivery.channel}:${actor}`;
        const history = delivery.turns.map(turn => createHash('sha256').update(JSON.stringify([turn.id, turn.role, turn.content])).digest('hex'));
        const old = entries?.get(key);
        let committed = old?.binding === binding ? old.committed : undefined;
        // Acceptance precedes the engine's history write. A private generation,
        // removed reply or edited publication cannot stand in for that write.
        try { if (committed?.retainedPublication && !committed.retainedPublication()) committed=undefined; }
        catch { committed=undefined; }
        let previous: unknown;
        if (committed) {
            const prefix = committed.history.every((value, index) => history[index] === value);
            if (prefix && history.length === committed.history.length) previous = committed.before; // retry/redraw does not deepen
            else if (prefix && history.length > committed.history.length) previous = committed.after;
        }
        if(delivery.preview)return{previous,isCurrent:()=>this.scopes.get(delivery.scope)?.get(key)===old,commit:()=>{},forget:()=>{}};
        if (!entries) { entries = new Map(); this.scopes.set(delivery.scope, entries); }
        const ticket=++this.serial;
        const entry: Entry = { binding, committed, ticket };
        entries.set(key, entry);
        while (entries.size > 16) entries.delete(entries.keys().next().value!);
        return { previous, isCurrent: () => entries!.get(key)?.ticket === ticket, forget: () => {
            if (entries!.get(key)?.ticket === ticket) entries!.delete(key);
        }, commit: (included, state, retainedPublication) => {
            if (entries!.get(key)?.ticket !== ticket) return; // an older async reply cannot overwrite the new turn
            if (included) entry.committed = { history, before: previous, after: state,retainedPublication };
            else if (!committed) entries!.delete(key);
        } };
    }
}
export const disclosureSessions = new DisclosureSessions();
