import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { CloseEncoder } from './closeEncoder';
import { CloseProfileData, CloseProfiles } from './closeProfiles';
import { FarEncoder, FarProfileData } from './farEncoder';
import { LanguageRelations, LanguageRoute, LanguageRoutingData } from './languageRelations';
import { CharacterLanguageKnowledge, knownLanguages, selectSpokenLanguage } from './languageRouting';
import { LanguageRenderer, RecipientRendering, recordUtterance, SpokenUtterance } from './languageRendering';
import type { SpeechSpan } from '../../shared/language/speechSpans';

/** Changing this seed changes FAR vocabulary. Keep it stable across campaigns and recipients. */
export const TITAN_FAR_VOCABULARY_SEED = 'titan-demo';

export interface LanguageEngineData {
    routing: LanguageRoutingData;
    close: CloseProfileData;
    far: FarProfileData;
    casefold: Record<string, string>;
}

/** Application-independent composition of the existing router, speech parser and two encoders. */
export class LanguageEngine {
    readonly relations: LanguageRelations;
    readonly renderer: LanguageRenderer;
    readonly versions: Readonly<{ routing: string; close: string; far: string; sourceLocale: string }>;

    constructor(data: LanguageEngineData) {
        this.relations = new LanguageRelations(data.routing);
        const close = new CloseProfiles(data.close, this.relations);
        if (!data.far || typeof data.far.version !== 'string' || !data.far.version ||
            !data.far.profiles || typeof data.far.profiles !== 'object' || Array.isArray(data.far.profiles))
            throw new Error('Invalid FAR profile document');
        const languages = new Set(this.relations.languageIds());
        const farLanguages = Object.keys(data.far.profiles);
        if (farLanguages.length !== languages.size || farLanguages.some(id => !languages.has(id)))
            throw new Error('FAR profiles must cover every routed language exactly');
        if (!data.casefold || typeof data.casefold !== 'object' || Array.isArray(data.casefold) ||
            Object.values(data.casefold).some(value => typeof value !== 'string'))
            throw new Error('Invalid language case-fold table');
        const far = new FarEncoder(data.far, TITAN_FAR_VOCABULARY_SEED, data.casefold);
        for (const language of languages) far.profile(language);
        // Sound/routing identity remains compatible with old full-CLOSE hearings.
        // Each new hearing separately pins its mask version, owner, domain and numeric cutoff.
        this.renderer = new LanguageRenderer(new CloseEncoder(close), far,
            createHash('sha256').update(JSON.stringify([data, TITAN_FAR_VOCABULARY_SEED])).digest('hex'));
        this.versions = Object.freeze({ routing: this.relations.version, close: close.version,
            far: data.far.version, sourceLocale: close.sourceLocale });
    }

    route(spokenLanguageId: string, listener: CharacterLanguageKnowledge): LanguageRoute {
        return this.relations.route(spokenLanguageId, knownLanguages(listener), listener);
    }

    record(text: string, speaker: CharacterLanguageKnowledge, recipient?: CharacterLanguageKnowledge,
        explicitChoice?: string, speechSpans?: readonly SpeechSpan[]): SpokenUtterance {
        return recordUtterance(text, speaker, recipient,
            explicitChoice ?? selectSpokenLanguage(speaker, recipient, undefined, [], this.relations), speechSpans);
    }

    forListener(utterance: SpokenUtterance, listener: CharacterLanguageKnowledge, locale = 'en'): RecipientRendering {
        return this.renderer.forListener(utterance, listener, locale);
    }
}

/** Loads only the shipped language assets. No provider, campaign, settings or history access. */
export function loadLanguageEngine(assetDirectory: string): LanguageEngine {
    const json = (name: string) => JSON.parse(fs.readFileSync(path.join(assetDirectory, name), 'utf8'));
    const engine = new LanguageEngine({ routing: json('routing.json'), close: json('close-profiles.json'),
        far: json('far-profiles.json'), casefold: json('unicode-casefold.json').fold });
    const archivePath = path.join(assetDirectory, 'voice-revisions.json');
    if (fs.existsSync(archivePath)) {
        const archive = json('voice-revisions.json');
        if (!archive || archive.version !== 1 || !Array.isArray(archive.engines))
            throw new Error('Invalid recorded language voice archive');
        const seen = new Set<string>();
        for (const entry of archive.engines) {
            if (!entry || typeof entry.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(entry.fingerprint) || seen.has(entry.fingerprint))
                throw new Error('Invalid or duplicate recorded sound profile');
            const previous = new LanguageEngine(entry.data);
            if (previous.renderer.fingerprint !== entry.fingerprint)
                throw new Error('Recorded sound profile fingerprint mismatch');
            seen.add(entry.fingerprint);
            engine.renderer.registerRecordedProfile(previous.renderer);
        }
    }
    return engine;
}
