import type { Character } from '../../shared/gameData/Character';
import type { Config } from '../../shared/Config';
import type { GameData } from '../../shared/gameData/GameData';
import { EncounterCapture, encounterTargets } from '../background/EncounterCapture';
import { MaturationLogReader, MaturityStage, VoiceTrait } from './maturation';
import { currentGoaCatalog } from '../goa/goaRuntime';
import { UndeadFacts, undeadCaptureCatalog, UndeadLogReader } from './undeadVoice';
let config:Config|undefined,capture:EncounterCapture|undefined;
const reader=new MaturationLogReader(true);
let traits=new WeakMap<Character,readonly VoiceTrait[]>();
let undead=new WeakMap<Character,UndeadFacts>(),undeadReader:UndeadLogReader|undefined;
export function currentVoiceTraits(actor:Character):readonly VoiceTrait[]|undefined {return traits.get(actor);}
export function currentUndeadFacts(actor:Character):UndeadFacts|undefined {return undead.get(actor);}
export function configureMaturationCapture(value:Config,flush?:()=>void):void {
    capture?.clear();reader.clear();traits=new WeakMap();undead=new WeakMap();undeadReader=undefined;config=value;
    capture=new EncounterCapture(()=>{
        const catalog=config?.audio?.provider==='breeze'?undeadCaptureCatalog(currentGoaCatalog()):undefined;
        undeadReader=catalog?new UndeadLogReader(catalog):undefined;
        return {maturation:true,undeadVoice:catalog};
    },flush);
}
export function observeMaturationLine(line:string):void {
    capture?.observe(line);
    if(line.includes('VOTC:CAMPAIGN/;/loaded/;/')){traits=new WeakMap();undead=new WeakMap();}
    if(config?.audio?.enabled){reader.observe(line);undeadReader?.observe(line);}
}
export function clearMaturationObservations():void { capture?.clear();reader.clear();undeadReader?.clear();traits=new WeakMap();undead=new WeakMap(); }
/** Force a new native stage for every new performance, independently of GoA or a clone bank. */
export async function captureMaturityForAudio(actor:Character,game:GameData,signal:AbortSignal):Promise<MaturityStage|undefined> {
    signal.throwIfAborted();
    if(!config?.audio?.enabled||!config.userFolderPath)return;
    reader.take(actor.id);traits.delete(actor);undead.delete(actor);
    const complete=await capture?.capture(config.userFolderPath,encounterTargets(game,[actor.id]),signal)??false;
    signal.throwIfAborted();const frame=reader.takeFrame(actor.id);
    if(!complete||!frame)throw new Error('Current character maturity capture is not ready. Reopen the encounter or retry playback.');
    const physical=undeadReader?.take(actor.id);
    if(undeadReader&&!physical)throw new Error('Current undead voice state capture is not ready. Reopen the encounter or retry playback.');
    if(physical)undead.set(actor,physical);
    traits.set(actor,frame.traits);return frame.stage;
}
