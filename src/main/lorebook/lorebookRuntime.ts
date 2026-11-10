import { spokenPublicationSessions } from './lorebookSpokenPublication';
import { prepareMutationLoreContext } from './loreMutationContext';
import { currentLoreMutationCatalog } from './loreMutationRuntime';
import { bindObservedTurningContexts, rememberedTurningNotes } from './loreMutationDisclosure';
import { prepareGameStateLoreContext } from './loreGameStateContext';
import { bindCurrentStateAccounts, currentStateAccountNotes, currentWorldStateNotes } from './loreGameStateDisclosure';
import { currentLoreGameStateCatalog } from './loreGameStateRuntime';
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import type { Config } from '../../shared/Config';
import type { GameData } from '../../shared/gameData/GameData';
import type { Character } from '../../shared/gameData/Character';
import { resolveGoaLore } from '../goa/goaResolver';
import { currentGoaCatalog, getVerifiedGoaSnapshot } from '../goa/goaRuntime';
import { lorebookClient, ChronicleStatus } from './lorebookClient';
import { encounterLoreIdentity, projectLoreReport, LoreReport } from './lorebookContext';
import { LorebookVectors, LoreSemanticMatch, fuseCandidates, embeddingBinding } from './lorebookVectors';
import { bindReportedAccountContexts, bindLoreDisclosureFocus, disclosureSessions, LoreDelivery } from './lorebookDisclosure';
import { nativeGamePath } from '../culture/cultureCatalog';
import {prepareObservedLoreContext,ObservedLoreTicket} from './lorebookObservedContext';
import { parseCk3Script, scriptString } from '../culture/ck3Script';

export const lorebookVectors = new LorebookVectors(lorebookClient);
let lastDiagnostic = 'Open a Warcraft conversation to use verified cultural context. Imported history remains optional.';
export function verifiedLoreVersion(config: Config): string {
    const user = nativeGamePath(config.userFolderPath);
    const mods: string[] = JSON.parse(fs.readFileSync(path.join(user, 'dlc_load.json'), 'utf8')).enabled_mods;
    const versions = mods.map(file => parseCk3Script(fs.readFileSync(path.resolve(user, nativeGamePath(file)), 'utf8')))
        .filter(entries => scriptString(entries, 'remote_file_id') === '2949767945').map(entries => scriptString(entries, 'version'));
    if (versions.length !== 1 || versions[0] !== '0.6.5') throw new Error('Campaign Chronicle reading requires the inspected GoA2 0.6.5 installation.');
    return versions[0];
}
function reportPath(data: string, campaign: string, timeline: string, actor: string): string {
    const key = createHash('sha256').update(JSON.stringify([campaign, timeline, actor])).digest('hex');
    return path.join(data, 'lorebook', 'reports', key + '.json');
}
export async function lorebookStatus(): Promise<any> {
    try { return { ...await lorebookClient.request<ChronicleStatus>({ op: 'status' }), diagnostic: lastDiagnostic, semantic: lorebookVectors.status() }; }
    catch (error) { return { ready: false, diagnostic: error instanceof Error ? error.message : 'Chronicle unavailable' }; }
}
interface KnowledgeOwner { version: 1; identity_policy: 'ordinary' | 'fallen_controller' }
/** This binds the acting identities represented by the verified game policy.
 * It cannot identify two different demons when the capture cannot distinguish them.
 * Learned knowledge survives an ordinary form/culture change; it does not pass
 * to a replacement controller solely because the game character ID is unchanged.
 */
function knowledgeOwner(actor: Character): KnowledgeOwner {
    const snapshot = getVerifiedGoaSnapshot(actor);
    if (!snapshot) throw new Error('A current verified Warcraft character capture is required.');
    return { version: 1, identity_policy: resolveGoaLore(actor.fullName, snapshot).identityPolicy };
}
function reportOwnerApplies(saved: any, actor: Character): boolean {
    try {
        const current = knowledgeOwner(actor);
        // Legacy reports predate acting-identity ownership. Preserve ordinary
        // reports without silently ascribing them to a replacement controller.
        if (!Object.prototype.hasOwnProperty.call(saved, 'knowledge_owner')) return current.identity_policy === 'ordinary';
        const owner = saved.knowledge_owner;
        return !!owner && !Array.isArray(owner) && Object.keys(owner).sort().join(',') === 'identity_policy,version' &&
            owner.version === 1 && owner.identity_policy === current.identity_policy;
    } catch { return false; }
}
export async function importLoreReport(data: string, game: GameData, actorId: number, report: LoreReport, config: Config): Promise<void> {
    // The caller's report and its real owner are fixed BEFORE the first await.
    // An import that becomes stale must not relabel old knowledge as belonging
    // to a new actor, mind, timeline or date, or overwrite a good earlier report.
    const actor = game.characters.get(actorId);
    if (!actor) throw new Error('The reported character is absent.');
    const owner = knowledgeOwner(actor), snapshotBinding = JSON.stringify(getVerifiedGoaSnapshot(actor));
    const actual = encounterLoreIdentity(game, actorId), identityBinding = JSON.stringify(actual);
    const captureDigest = currentGoaCatalog()!.digest, totalDays = game.gameDate!.totalDays;
    const version = verifiedLoreVersion(config), reportBinding = JSON.stringify(report);
    const frozenReport = JSON.parse(reportBinding) as LoreReport;
    if (frozenReport.mod_version !== version) throw new Error('Reported GoA2 version differs from the installed pack.');
    const check = () => {
        try {
            if (game.characters.get(actorId) === actor && JSON.stringify(getVerifiedGoaSnapshot(actor)) === snapshotBinding &&
                currentGoaCatalog()?.digest === captureDigest && game.gameDate?.totalDays === totalDays &&
                JSON.stringify(encounterLoreIdentity(game, actorId)) === identityBinding && JSON.stringify(report) === reportBinding &&
                verifiedLoreVersion(config) === version) return;
        } catch { /* Missing or changed context is stale, never a new owner. */ }
        throw new Error('Character knowledge changed during report import.');
    };
    const edition = await lorebookClient.request<ChronicleStatus>({ op: 'status' });
    check();
    const context = projectLoreReport(frozenReport, game, actorId, edition.setting_sha256);
    await lorebookClient.request({ op: 'validate-context', context });
    check();
    const file = reportPath(data, actual.campaign, actual.timeline, actual.actor);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = file + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify({ report: frozenReport, capture_digest: captureDigest,
        total_days: totalDays, knowledge_owner: owner }), { mode: 0o600 });
    fs.renameSync(temporary, file);
    lastDiagnostic = 'Reported knowledge saved for this acting character and timeline.';
}
export async function loreReportTemplate(game: GameData, actorId: number, config: Config, data?: string): Promise<any> {
    const version = verifiedLoreVersion(config);
    const edition = await lorebookClient.request<ChronicleStatus>({ op: 'status' });
    const actual = encounterLoreIdentity(game, actorId);
    if (data) {
        const file = reportPath(data, actual.campaign, actual.timeline, actual.actor);
        if (fs.existsSync(file)) {
            const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (saved.capture_digest === currentGoaCatalog()?.digest && saved.total_days <= game.gameDate!.totalDays &&
                reportOwnerApplies(saved, game.characters.get(actorId)!))
                return projectLoreReport(saved.report, game, actorId, edition.setting_sha256);
        }
    }
    return { origin: 'user_reported', campaign_id: actual.campaign, timeline_id: actual.timeline,
        start_date: '', as_of: actual.date, mod_version: version, choices: [],
        lore_knowledge: { actor_id: actual.actor, as_of: actual.date, setting_sha256: edition.setting_sha256, known_subjects: [] } };
}

/** Return only resolved in-world prose. Missing/stale knowledge adds nothing. */
export async function lorebookPrompt(game: GameData, actorId: number, config: Config, data: string,
    query: string, existing = '', delivery?: LoreDelivery): Promise<string> {
    if (delivery) {
        delivery.knowledge = { access: 'not_requested',intent:'none' }; delivery.accounts=[]; delivery.accountWords=0; delivery.accountContexts=[]; delivery.turningContexts=[]; delivery.disclosureFocus=undefined; delivery.required=false;
        delivery.isCurrent=undefined;delivery.requestMore=undefined;delivery.commit=undefined;delivery.finishPreparation=undefined;
    }
    if (config.lorebookEnabled === false || config.goaLoreEnabled === false || !lorebookClient.installed) {
        spokenPublicationSessions.clear(delivery, actorId);
        disclosureSessions.clear(delivery, actorId);
        return '';
    }
    if (delivery) delivery.knowledge = { access: 'unavailable' };
    try {
        const actor = game.characters.get(actorId);
        const actorSnapshot = actor && getVerifiedGoaSnapshot(actor);
        if (!actor || !actorSnapshot) return '';
        const snapshotBinding = JSON.stringify(actorSnapshot);
        const actual = encounterLoreIdentity(game, actorId), file = reportPath(data, actual.campaign, actual.timeline, actual.actor);
        const hasReport=fs.existsSync(file),reportBytes=hasReport?fs.readFileSync(file,'utf8'):undefined;
        let saved:any,observed:ObservedLoreTicket|undefined;
        if(hasReport){
            if(delivery)delivery.required=true;
            saved=JSON.parse(reportBytes!);
            if(!reportOwnerApplies(saved,actor))throw new Error('Knowledge report belongs to a different acting identity or needs controller review.');
            if(saved.report.mod_version!==verifiedLoreVersion(config)||!(saved.total_days<=game.gameDate!.totalDays))
                throw new Error('The installed pack or actual game clock differs from this knowledge report.');
            if(saved.capture_digest!==currentGoaCatalog()?.digest)throw new Error('Warcraft definitions changed; review the knowledge report.');
        }
        const edition = await lorebookClient.request<ChronicleStatus>({ op: 'status' });
        if(!hasReport){
            verifiedLoreVersion(config);
            observed=prepareObservedLoreContext(game,actorId,config,edition.setting_sha256);
        }
        const reported=hasReport?projectLoreReport(saved.report,game,actorId,edition.setting_sha256):undefined;
        const mutation=prepareMutationLoreContext(game,actorId,config,edition.setting_sha256,observed,reported);
        const gameState=prepareGameStateLoreContext(game,actorId,config,edition.setting_sha256,observed,reported);
        const context=gameState?.context??mutation?.context??reported??observed?.context;
        if(!context){lastDiagnostic='No current mapped cultural context or applicable knowledge report for this character.';return '';}
        if(delivery)delivery.required=true;
        const disclosureOp=gameState?'game-state-disclose':mutation?'mutation-disclose':hasReport?'disclose':'observed-disclose';
        const accountReport=hasReport?saved.report:{choices:[]};
        const captureDigest = currentGoaCatalog()!.digest, totalDays = game.gameDate!.totalDays;
        const binding = createHash('sha256').update(JSON.stringify([edition.manifest_sha256, gameState?.binding??mutation?.binding??context, captureDigest, totalDays, snapshotBinding])).digest('hex');
        const session = spokenPublicationSessions.prepare(delivery, actorId, binding) ?? disclosureSessions.prepare(delivery, actorId, binding);
        let proposed: unknown, initialProposed: unknown, initiallyAdmitted = false, forgetInitial = false;
        if (delivery) delivery.commit = included => {
            initiallyAdmitted = included;
            if (!delivery.preparing) session.commit(included, proposed);
        };
        const stillCurrent = () => config.lorebookEnabled !== false && config.goaLoreEnabled !== false &&
            game.characters.get(actorId) === actor &&
            JSON.stringify(getVerifiedGoaSnapshot(actor)) === snapshotBinding && currentGoaCatalog()?.digest === captureDigest &&
            game.gameDate?.totalDays === totalDays && JSON.stringify(encounterLoreIdentity(game, actorId)) === JSON.stringify(actual) &&
            (hasReport?fs.existsSync(file)&&fs.readFileSync(file,'utf8')===reportBytes&&verifiedLoreVersion(config)===saved.report.mod_version
                :!fs.existsSync(file)&&(observed?.isCurrent()===true||mutation?.isCurrent()===true||gameState?.isCurrent()===true)&&verifiedLoreVersion(config)==='0.6.5')&&
            (!mutation||mutation.isCurrent())&&(!gameState||gameState.isCurrent());
        if (delivery) delivery.isCurrent = () => {
            try { return session.isCurrent() && !!stillCurrent(); } catch { return false; }
        };
        if (delivery) delivery.finishPreparation = (included, outcome) => {
            if (!delivery.isCurrent?.()) return;
            if (outcome?.closeFocus) { session.forget(); return; }
            if (!included && forgetInitial) session.forget();
            session.commit(included, outcome?.initialFocusOnly ? initialProposed : proposed,outcome?.retainedPublication);
        };
        const lexical = await lorebookClient.request<{ ids: string[]; query?: string }>({ op: 'candidates', query: query.slice(-1000), previous: session.previous,...(process.env.VOTC_LORE_NATIVE_SEMANTIC_STUDY==='1'?{semantic_relevance:true}:{}) });
        const rankingQuery = lexical.query ?? query.slice(-1000);
        let semantic:string[]=[];let semanticMatches:LoreSemanticMatch[]=[];const qualifiedSemantic=process.env.VOTC_LORE_NATIVE_SEMANTIC_STUDY==='1';
        const space = config.embeddingApiConnectionConfig?.connection ? embeddingBinding(config, edition.manifest_sha256) : '';
        try { if (rankingQuery.trim()) {const ranked=await lorebookVectors.recall(config,data,edition,rankingQuery,qualifiedSemantic);semantic=ranked.ids;semanticMatches=ranked.matches;} }
        catch { lastDiagnostic = 'Semantic search unavailable; using lexical candidates with the same lore guards.'; }
        // Re-read the complete report and game binding after external work;
        // an unchanged epoch alone cannot justify using revoked knowledge.
        if (!stillCurrent()) throw new Error('Character knowledge changed during lore retrieval.');
        if (space && embeddingBinding(config, edition.manifest_sha256) !== space){semantic=[];semanticMatches=[];}
        const result = await lorebookClient.request<any>({ op: disclosureOp, context, query: query.slice(-1000), previous: session.previous,
            candidate_ids: qualifiedSemantic?lexical.ids:fuseCandidates(lexical.ids, semantic), semantic_ids: qualifiedSemantic?[]:semantic.slice(0,8),...(qualifiedSemantic?{semantic_relevance:true,semantic_matches:semanticMatches,semantic_complete:semanticMatches.length===edition.authored_qualified}:{}), existing, max_words: 350,
            max_accounts: delivery?.initialMaxAccounts ?? 3,...(delivery?.recallCurrent===true?{recall_current:true}:{}), ...(process.env.VOTC_LORE_NATIVE_SCENE_STUDY==='1'?{scene_relevance:true}:{}) });
        if (!stillCurrent()) throw new Error('Character knowledge changed before lore delivery.');
        if (result.actor_id !== String(actorId)) throw new Error('Lore resolver returned another actor.');
        // The disclosure controller already deduplicated complete bodies against
        // existing context. Its proposed state covers exactly these admitted bodies.
        const kept = result.passages;
        const turningContexts=!gameState&&mutation?bindObservedTurningContexts(kept,mutation.context,currentLoreMutationCatalog()!):[];
        const stateContexts=gameState?bindCurrentStateAccounts(kept,gameState.context,currentLoreGameStateCatalog()!):[];
        const worldNotes=gameState?currentWorldStateNotes(gameState.context,query+"\n"+kept.map((p:any)=>p.heading).join("\n")):"";
        spokenPublicationSessions.bind(delivery,actorId,result,()=>delivery?.isCurrent?.()===true);
        const disclosureFocus=bindLoreDisclosureFocus(result,actorId,query,session.previous);
        if(delivery){delivery.accounts=kept.map((p:any)=>p.heading+'\n'+p.text);delivery.accountWords=result.words;delivery.accountContexts=bindReportedAccountContexts(kept,accountReport);delivery.turningContexts=turningContexts;delivery.currentStateContexts=stateContexts;delivery.currentWorldStateNotes=worldNotes;delivery.disclosureFocus=disclosureFocus;}
        if (delivery) delivery.knowledge = { access: result.disclosure?.access || (kept.length ? 'provided' : 'not_established'), ...(['none','query','continue'].includes(result.disclosure?.intent)?{intent:result.disclosure.intent}:{}) };
        lastDiagnostic = `Chronicle ${result.disclosure?.mode || 'focused'}: ${kept.length} accounts for the current character.`;
        proposed = result.state; initialProposed = result.state;
        if (delivery) {
            const delivered = [...kept]; let usedWords = result.words, requests = 0, busy = false, initialized = false;
            const check = () => { if (!delivery.isCurrent?.()) throw new Error('Character knowledge changed during deeper lore lookup.'); };
            delivery.requestMore = async (requested, remaining) => {
                check();
                if (!initialized) {
                    initialized = true;
                    if (!initiallyAdmitted) { delivered.length = 0; usedWords = 0; proposed = forgetInitial ? undefined : session.previous; }
                }
                if (busy || requests >= 2) throw new Error('Deeper lore lookup limit exceeded.');
                if (typeof requested !== 'string' || !requested.trim() || requested.length > 256 ||
                    !Number.isInteger(remaining.maxWords) || !Number.isInteger(remaining.maxAccounts)) throw new Error('Invalid deeper lore lookup.');
                const maxWords = Math.min(350 - usedWords, remaining.maxWords), maxAccounts = Math.min(3 - delivered.length, remaining.maxAccounts);
                if (maxWords < 1 || maxAccounts < 1) return [];
                requests++; busy = true;
                try {
                    const lexical = await lorebookClient.request<{ ids: string[]; query?: string }>({ op: 'candidates', query: requested, previous: proposed, automatic:false });
                    let semantic:string[]=[];let semanticMatches:LoreSemanticMatch[]=[];const qualifiedSemantic=process.env.VOTC_LORE_NATIVE_SEMANTIC_STUDY==='1';
                    const space = config.embeddingApiConnectionConfig?.connection ? embeddingBinding(config, edition.manifest_sha256) : '';
                    try { const rankingQuery=lexical.query??requested;if(rankingQuery.trim()){const ranked=await lorebookVectors.recall(config,data,edition,rankingQuery,qualifiedSemantic);semantic=ranked.ids;semanticMatches=ranked.matches;} } catch { /* lexical guards remain authoritative */ }
                    check();
                    if (space && embeddingBinding(config, edition.manifest_sha256) !== space){semantic=[];semanticMatches=[];}
                    const next = await lorebookClient.request<any>({ op: disclosureOp, context, query: requested, previous: proposed,
                        candidate_ids: qualifiedSemantic?lexical.ids:fuseCandidates(lexical.ids, semantic), semantic_ids: qualifiedSemantic?[]:semantic.slice(0,8),...(qualifiedSemantic?{semantic_relevance:true,semantic_matches:semanticMatches,semantic_complete:semanticMatches.length===edition.authored_qualified}:{}),
                        existing: [existing, ...delivered.map(p => p.heading+'\n'+p.text)].join('\n\n'), max_words: maxWords, max_accounts: maxAccounts,
                        prior_subjects: [...new Set(delivered.map(p => p.subject_id))], automatic:false });
                    check();
                    if (next.actor_id !== String(actorId) || next.words > maxWords || next.passages.length > maxAccounts)
                        throw new Error('Deeper lore response does not match its actor or disclosure limit.');
                    if (next.passages.length) {
                        const contexts=bindReportedAccountContexts(next.passages,accountReport);
                        delivered.push(...next.passages); usedWords += next.words; proposed = next.state;
                        delivery.accounts=delivered.map((p:any)=>p.heading+'\n'+p.text);delivery.accountWords=usedWords;
                        delivery.knowledge = { access: 'provided' };
                        delivery.accountContexts=[...(delivery.accountContexts??[]),...contexts];
                        if(!gameState&&mutation)delivery.turningContexts=[...(delivery.turningContexts??[]),...bindObservedTurningContexts(next.passages,mutation.context,currentLoreMutationCatalog()!)];
                        if(gameState){delivery.currentStateContexts=[...(delivery.currentStateContexts??[]),...bindCurrentStateAccounts(next.passages,gameState.context,currentLoreGameStateCatalog()!)];delivery.currentWorldStateNotes=currentWorldStateNotes(gameState.context,requested+"\n"+next.passages.map((p:any)=>p.heading).join("\n"));}
                    }
                    return next.passages.map((p: any) => p.heading+'\n'+p.text);
                } finally { busy = false; }
            };
        }
        if (!kept.length) {
            forgetInitial = result.disclosure?.mode!=='scene_continue'&&['not_requested','not_established'].includes(result.disclosure?.access);
            if (forgetInitial && !delivery?.preparing) session.forget();
            delivery?.commit?.(false); return '';
        }
        return '[Chronicle knowledge: setting accounts relevant to this exchange. Use only what this individual would know. ' +
            'Observed campaign facts, current body, personal convictions and the player’s portrayal remain authoritative. ' +
            'Beliefs and community customs do not establish this person’s behavior, training or powers. Keep uncertainty and conditional wording.]\n\n' +
            kept.map((p: any) => p.heading + '\n' + p.text).join('\n\n') + (turningContexts.length?'\n\n'+rememberedTurningNotes(turningContexts):'')+(stateContexts.length?'\n\n'+currentStateAccountNotes(stateContexts):'')+(worldNotes?'\n\n'+worldNotes:'') + (process.env.VOTC_LORE_NATIVE_PROPOSAL_STUDY==='1'?"\n\nUse the supplied account for statements about established customs. Put additional details into your character's present proposals or questions, rather than treating them as customary or already agreed.":'');
    } catch (error) {
        delivery?.commit?.(false);
        lastDiagnostic = error instanceof Error ? error.message : 'Campaign lore unavailable';
        console.warn('Chronicle context omitted: ' + lastDiagnostic);
        return '';
    }
}
export function closeLorebook(): void { lorebookVectors.cancel(); lorebookClient.close(); }
