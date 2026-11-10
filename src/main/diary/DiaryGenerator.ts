import { composeGoaContext, finishGoaContext } from '../goa/goaRuntime';
import { recipientEncounterMessages, perceivedMemoryTranscript } from '../language';
import { summaryPerspectiveInstruction } from '../language/conversationView';

import { ApiConnection } from "../../shared/apiConnection";
import type { ProviderWork } from '../../shared/providerActivity';
import { Character } from "../../shared/gameData/Character";
import { GameData, Trait } from "../../shared/gameData/GameData";
import { Config } from "../../shared/Config";
import { Message } from "../ts/conversation_interfaces";
import { Conversation } from "../conversation/Conversation";
import { DiaryEntry } from "../ts/diary_interfaces";
import { LetterManager } from "../letter/LetterManager";
import { randomUUID } from "crypto";
import { Tiktoken } from "js-tiktoken";
import * as path from "path";
import * as fs from "fs";
import { getEffectivePrompts } from "../conversation/promptBuilder.js";
import { getEffectiveCharacterDescription } from "../characterDescription";
import { characterPromptDescription } from '../conversation/characterPromptDescription';
import { getRoleplayBackgroundPlacement } from '../background/backgroundPrompt';

export class DiaryGenerator {
    private apiConnection: ApiConnection;
    private config: Config;
    private votcDataPath: string;

    constructor(config: Config, votcDataPath: string, encoder: Tiktoken | null = null) {
        this.config = config;
        this.votcDataPath = votcDataPath;
        this.apiConnection = new ApiConnection(
            config.textGenerationApiConnectionConfig.connection,
            config.textGenerationApiConnectionConfig.parameters,
            encoder
        );
    }

    private buildDiaryPrompt(gameData: GameData, conversation: Conversation, characterId: string): string {
        const character = conversation.getEncounterCharacter?.(Number(characterId)) ?? gameData.getCharacter(parseInt(characterId, 10));
        if (!character) {
            throw new Error(`Character with ID ${characterId} not found.`);
        }

        const heard = recipientEncounterMessages(conversation, Number(characterId));
        const conversationHistory = conversation.hasLanguageMessages?.() ? perceivedMemoryTranscript(heard, Number(characterId))
            : heard.map(msg => `${msg.name}: ${msg.content}`).join('\n');

        let prompt = getEffectivePrompts(this.config, this.votcDataPath, gameData).diaryPrompt;

        // Add letter summaries
        const letterManager = LetterManager.getInstance();
        const letterSummaries = letterManager.getLetterSummaries(String(gameData.playerID), characterId).slice(0, this.config.maxSummaries);
        let letterSummaryContent = '';
        if (letterSummaries.length > 0) {
            const allSummaries = letterSummaries.map((summary, index) =>
                `${index + 1}. ${summary.date}: ${summary.summary}`
            ).join('\n');
            letterSummaryContent = `Summaries of previous letters with ${gameData.getPlayer().fullName}:\n${allSummaries}\n\n`;
            console.log(`Loaded ${letterSummaries.length} letter summaries for diary prompt for character ID ${characterId}`);
        } else {
            console.log(`No letter summaries found for diary prompt for character ID ${characterId}`);
        }

        prompt = prompt.replace(/{{charName}}/g, character.fullName)
                       .replace(/{{conversationHistory}}/g, conversationHistory)
                       .replace(/{{letterSummaryContent}}/g, letterSummaryContent);

        return prompt;
    }

    public async generateDiaryEntry(gameData: GameData, conversation: Conversation, characterId: string, work?: ProviderWork): Promise<DiaryEntry | null> {
        const character = conversation.getEncounterCharacter?.(Number(characterId)) ?? gameData.characters.get(parseInt(characterId));
        if (!character) {
          return null;
        }

        const diaryPrompt = getEffectivePrompts(this.config, this.votcDataPath, gameData).diaryPrompt;

        if (!diaryPrompt) {
          return null;
        }

        const replacedPrompt = diaryPrompt.replace(/{{charName}}/g, character.fullName);
        const languageAware = !!conversation.hasLanguageMessages?.();
        const heard = recipientEncounterMessages(conversation, Number(characterId));
        if (languageAware && !heard.length) return null;
        const participants = languageAware && conversation.getEncounterParticipantsForRecipient
            ? conversation.getEncounterParticipantsForRecipient(character.id) : [...gameData.characters.values()];

        // The diary uses the same owner persona and ready backgrounds as their roleplay reply.
        let persona = '';
        try {
            persona = characterPromptDescription(gameData, character, this.config, this.votcDataPath, conversation.translations, participants);
        } catch (error) {
            console.error(`Diary description script error: ${error}`);
        }
        const backgrounds = getRoleplayBackgroundPlacement(character, this.config);
        const userCharacterDescription = getEffectiveCharacterDescription(this.votcDataPath, String(gameData.playerID), characterId);
        const personalDescription = userCharacterDescription
            ? `Character description for ${character.fullName} (provided by the player):\n${userCharacterDescription}\n\n`
            : '';
        const goaContext = composeGoaContext(persona, character, this.config, gameData);

        const conversationHistory = languageAware ? perceivedMemoryTranscript(heard, Number(characterId))
            : heard.map(msg => `${msg.name}: ${msg.content}`).join('\n');
        const perceptionGuidance = languageAware ? '\n' + summaryPerspectiveInstruction(character.fullName, heard, character.id, 'diary') : '';

        const fullPrompt = finishGoaContext([replacedPrompt, goaContext.description, backgrounds.early,
            conversationHistory, backgrounds.faith, personalDescription, perceptionGuidance].filter(Boolean).join('\n\n'), goaContext);

        const promptForApi = [{ role: 'user', content: fullPrompt }];

        // @ts-ignore - using complete instead of generate
 const result = await this.apiConnection.complete(promptForApi, false, {}, undefined, undefined, 300_000, work);
    const generatedContent = typeof result === 'string' ? result : (result?.content ?? '');

        if (!generatedContent) {
          return null;
        }

        const diaryEntry: DiaryEntry = {
          id: randomUUID(),
          date: gameData.date,
          location: gameData.location,
          scene: gameData.scene,
          participants: participants.map(participant => String(participant.id)),
          content: generatedContent,
          character_traits: character.traits.reduce((acc: { [key: string]: string; }, trait: Trait) => {
            if (trait && trait.name) {
              acc[trait.name] = trait.desc || 'true';
            }
            return acc;
          }, {}),
          creationTimestamp: new Date()
        };

        return diaryEntry;
    }

    public async generateDiaryEntryForLetter(gameData: GameData, character: Character, letterContent: string, letterDirection: 'sent' | 'received'): Promise<DiaryEntry | null> {
        const diaryPrompt = getEffectivePrompts(this.config, this.votcDataPath, gameData).diaryForLetterPrompt;
        if (!diaryPrompt) return null;

        let persona = '';
        try {
            persona = characterPromptDescription(gameData, character, this.config, this.votcDataPath);
        } catch (error) {
            console.error(`Letter diary description script error: ${error}`);
        }
        const backgrounds = getRoleplayBackgroundPlacement(character, this.config);
        const userCharacterDescription = getEffectiveCharacterDescription(this.votcDataPath, String(gameData.playerID), String(character.id));
        const personalDescription = userCharacterDescription
            ? `Character description for ${character.fullName} (provided by the player):\n${userCharacterDescription}\n\n`
            : '';
        const goaContext = composeGoaContext(persona, character, this.config, gameData);

        const replacedPrompt = diaryPrompt
            .replace(/{{charName}}/g, character.fullName)
            .replace(/{{letterDirection}}/g, letterDirection)
            .replace(/{{letterContent}}/g, letterContent);

        const fullPrompt = [goaContext.description, backgrounds.early, replacedPrompt, backgrounds.faith,
            personalDescription].filter(Boolean).join('\n\n');
        const promptForApi: Message[] = [{ role: 'user', content: finishGoaContext(fullPrompt, goaContext) }];
 const result = await this.apiConnection.complete(promptForApi, false, {}, undefined, undefined, 300_000);
    const generatedContent = typeof result === 'string' ? result : (result?.content ?? '');

        if (!generatedContent) return null;

        return {
            id: randomUUID(),
            date: gameData.date,
            location: gameData.location,
            scene: 'Wrote/Read a letter',
            participants: [String(gameData.playerID), String(character.id)],
            content: generatedContent,
            character_traits: character.traits.reduce((acc: { [key: string]: string; }, trait: Trait) => {
                if (trait && trait.name) {
                    acc[trait.name] = trait.desc || 'true';
                }
                return acc;
            }, {}),
            creationTimestamp: new Date()
        };
    }

    public async summarizeDiaryEntry(diaryEntry: DiaryEntry, gameData: GameData, work?: ProviderWork): Promise<{ summary: string, date: string, diaryEntryId: string } | null> {
        if (!diaryEntry) {
            return null;
        }

        const diarySummarizePrompt = getEffectivePrompts(this.config, this.votcDataPath, gameData).diarySummarizePrompt;
        if (!diarySummarizePrompt) {
            return null;
        }

        const entryText = `Date: ${diaryEntry.date}\n${diaryEntry.content}`;
        const fullPrompt = `${diarySummarizePrompt}\n\n${entryText}`;

        const promptForApi: Message[] = [{ role: 'user', name: 'user', content: fullPrompt }];

 const result = await this.apiConnection.complete(promptForApi, false, {}, undefined, undefined, 300_000, work);
    const summaryContent = typeof result === 'string' ? result : (result?.content ?? '');
        
        if (!summaryContent) {
            return null;
        }

        return { summary: summaryContent, date: diaryEntry.date, diaryEntryId: diaryEntry.id };
    }
}
