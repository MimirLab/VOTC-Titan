import type { GameData } from '../../shared/gameData/GameData';

/** Standard actions mutate character fields, relationship arrays, silence and venue caches. */
export function snapshotActionCache(data: GameData): () => void {
    const characters = [...data.characters.values()].map(character => ({ character, fields: structuredClone({...character}) }));
    const fields = ['scene','location','silencedCharacterIds'] as const;
    const game = fields.map(key => ({ key, present: Object.prototype.hasOwnProperty.call(data,key), value: structuredClone(data[key]) }));
    return () => {
        for (const {character,fields} of characters) {
            for (const key of Object.keys(character)) if (!(key in fields)) delete (character as any)[key];
            Object.assign(character,fields);
        }
        for (const {key,present,value} of game) {
            if (present) (data as any)[key]=value; else delete (data as any)[key];
        }
    };
}
