import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { Character } from '../../shared/gameData/Character';
import { GameData } from '../../shared/gameData/GameData';
import { Config } from '../../shared/Config';

/** Bind scripts which use getAi()/getPlayer() to the actual speaker and interlocutor. */
export function characterPromptGame(gameData: GameData, character: Character, config: Config,
    translations?: any, target?: Character, participants?: readonly Character[]): GameData {
    const scoped = Object.assign(Object.create(Object.getPrototypeOf(gameData)), gameData, {
        aiID: character.id, aiName: character.fullName, lang: config.language || 'en',
        characters: participants ? new Map(participants.map(person => [person.id, person])) : new Map(gameData.characters),
        ...(target ? { playerID: target.id, playerName: target.fullName } : {})
    }) as GameData;
    scoped.characters.set(character.id, character);
    if (!translations) {
        const locale = path.join(app.getAppPath(), 'public', 'locales', `${config.language || 'en'}.json`);
        const fallback = path.join(app.getAppPath(), 'public', 'locales', 'en.json');
        translations = JSON.parse(fs.readFileSync(fs.existsSync(locale) ? locale : fallback, 'utf8'));
    }
    (scoped as any).localize = (key: string, _lang: string, variables?: Record<string, string>) => {
        let value: any = translations;
        for (const part of key.split('.')) value = value?.[part];
        if (typeof value !== 'string') return key;
        for (const [name, replacement] of Object.entries(variables ?? {}))
            value = value.split(`{{${name}}}`).join(replacement);
        return value;
    };
    if (target) scoped.characters.set(target.id, target);
    return scoped;
}

/** Evaluate the selected persona script for its actual owner without changing the live game context. */
export function characterPromptDescription(gameData: GameData, character: Character, config: Config,
    votcDataPath: string, translations?: any, participants?: readonly Character[]): string {
    const scoped = characterPromptGame(gameData, character, config, translations, undefined, participants);
    const script = path.join(votcDataPath, 'scripts', 'prompts', 'description', config.selectedDescScript);
    delete require.cache[require.resolve(script)];
    return require(script)(scoped, character);
}
