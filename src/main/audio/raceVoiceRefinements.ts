import type { VoiceProfile } from '../../shared/audio';
import type { VoiceCasting } from './acousticCasting';
import { automaticIndividual } from './voiceDevelopment';

/** Player-approved physical directions. No shared speaker or reference is installed. */
export const REVIEWED_RACE_REFINEMENTS = [
    {
        "anatomyId": "035",
        "sex": "male",
        "anatomyCore": "An adult male voice in a huge low register, with inflated chest resonance, broad cavernous vowels, and a coarse fleshy grain. Speak through an immense fleshy mouth and thick, spacious throat, with a broad heavy vowel center and inflated chest resonance. Let consonants emerge with weight from the large jaw, while keeping a clear upper articulation layer above the coarse rumble. Preserve the speaker's Sex, learned accent and personal fluency, including an articulate ogre mage.",
        "delivery": "Retain the immense ogre mouth, heavy rounded vowel body and coarse chest rumble."
    },
    {
        "anatomyId": "035",
        "sex": "female",
        "anatomyCore": "An adult female voice in a massive low-middle register, with inflated chest resonance, broad cavernous vowels, and a coarse fleshy husk. Speak through an immense fleshy mouth and thick, spacious throat, with a broad heavy vowel center and inflated chest resonance. Let consonants emerge with weight from the large jaw, while keeping a clear upper articulation layer above the coarse rumble. Preserve the speaker's Sex, learned accent and personal fluency, including an articulate ogre mage.",
        "delivery": "Retain the immense ogre mouth, heavy rounded vowel body and coarse chest rumble."
    },
    {
        "anatomyId": "002",
        "sex": "female",
        "anatomyCore": "An adult female voice in a sturdy lower-middle register, with rounded chest resonance and a lightly husky edge. Keep a compact, barrel-bodied vocal resonance with dense chest support and a firmly voiced vowel center. Let a naturally gravelled surface sit over rounded, weighty vowels and distinct consonant releases. Preserve the individual speaker's Sex and learned accent; this physical weight remains during gentle as well as forceful speech.",
        "delivery": "Retain compact, barrel-bodied dwarven resonance and a naturally gravelled vowel edge."
    },
    {
        "anatomyId": "040",
        "sex": "male",
        "anatomyCore": "An adult male voice in a rich lower register, with deep smooth chest resonance and a gentle grain beneath rounded vowels. Keep the existing smooth, rounded resonance firmly sustained through each vowel, with a fine natural grain and softly shaped but distinct consonant releases. Let adjacent vowels connect fluidly while keeping the individual speaker's personal phrase rhythm, Sex and learned accent. Maintain an ordinary living voiced center in quiet and emphatic speech.",
        "delivery": "Retain the smooth rounded vowel resonance, fine natural grain and softly distinct consonants."
    },
    {
        "anatomyId": "040",
        "sex": "female",
        "anatomyCore": "An adult female voice in a clear warm middle register, with smooth rounded resonance and softly shaped vowels. Keep the existing smooth, rounded resonance firmly sustained through each vowel, with a fine natural grain and softly shaped but distinct consonant releases. Let adjacent vowels connect fluidly while keeping the individual speaker's personal phrase rhythm, Sex and learned accent. Maintain an ordinary living voiced center in quiet and emphatic speech.",
        "delivery": "Retain the smooth rounded vowel resonance, fine natural grain and softly distinct consonants."
    }
] as const;

/** Apply only to automatic references cast with this exact reviewed physical core.
 * Existing voices, player choices and historic earlier cores keep their delivery. */
export function reviewedRaceDirection(profile: VoiceProfile | undefined, casting: VoiceCasting | undefined): string | undefined {
    if (!profile || profile.characterId === '__narrator__' || !casting || !automaticIndividual(profile)) return;
    const recipe = REVIEWED_RACE_REFINEMENTS.find(r => r.anatomyId === casting.anatomyId && r.sex === casting.presentation);
    if (!recipe || casting.anatomyCore !== recipe.anatomyCore) return;
    try {
        const source = JSON.parse(profile.provenance).casting;
        if (source?.anatomyId === recipe.anatomyId && source.presentation === recipe.sex && source.anatomyCore === recipe.anatomyCore)
            return recipe.delivery;
    } catch { return; }
}
