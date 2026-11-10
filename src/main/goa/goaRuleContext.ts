import { GoaSnapshot } from '../../shared/gameData/GoaSnapshot';
import { goaCatalogue } from './goaCatalogue';

export interface GoaEncounter {
    participants?: GoaSnapshot[];
    /** Tags supplied by a game/action adapter, never guessed from chat prose. */
    tags?: string[];
    magicSchools?: string[];
    visibleDire?: boolean;
    knownRuleKeys?: string[];
}
export const FORM_IDS = ['cat_form', 'bear_form', 'stag_form', 'treant_form'];
export const MORTAL_IDS = ['creature_human', 'creature_orc', 'creature_dwarf', 'creature_gnome', 'creature_goblin',
    'creature_troll', 'creature_high_elf', 'creature_night_elf', 'creature_highborne', 'creature_nightborne',
    'creature_draenei', 'creature_broken', 'creature_lost_one'];

export class GoaRuleContext {
    readonly ids: Set<string>;
    readonly races: string[];
    readonly body?: string;
    readonly transformed: boolean;
    readonly living: boolean;
    readonly mindReplaced: boolean;
    readonly felOrc: boolean;
    readonly moknathal: boolean;
    readonly natureBond: boolean;
    readonly corruptedNature: boolean;
    /** Shared grammar policy: only the resolved current body can establish a sexless exception. */
    get sexlessBody(): boolean {
        const sexedBody = this.body === 'creature_sayaadi' || this.body === 'creature_dryad' || this.body === 'creature_frostnymph';
        return this.body === 'creature_voidwalker' || (!sexedBody && this.snapshot.sexlessBody === true &&
            this.snapshot.currentBody === this.body && !!this.body);
    }

    constructor(readonly snapshot: GoaSnapshot, readonly encounter: GoaEncounter = {}) {
        this.ids = new Set(snapshot.traitIds);
        this.races = snapshot.traitIds.filter(id => id.startsWith('creature_'));
        this.felOrc = this.has('creature_fel_orc') || (this.has('creature_orc') && this.has('being_demon'));
        this.moknathal = !this.felOrc && ((this.has('creature_orc') && this.has('blood_ogre')) || (this.has('creature_ogre') && this.has('blood_orc')));
        const forms = FORM_IDS.filter(id => this.has(id));
        // This trait establishes a soul bound to the Helm, overriding ordinary
        // physical-form observations without replacing the acting mind or nature.
        if (this.has('in_ice_prison')) this.body = 'in_ice_prison';
        else if (this.has('polymorph')) this.body = 'polymorph';
        else if (snapshot.currentBody) this.body = snapshot.currentBody;
        else if (this.has('metamorphosis') || this.has('fallen_demon_hunter')) this.body = 'metamorphosis';
        else if (forms.length === 1) this.body = forms[0];
        else if (forms.length > 1) this.body = undefined; // Rank is not chronology.
        else if (this.felOrc) this.body = 'creature_fel_orc';
        else if (this.moknathal) this.body = 'moknathal';
        else if (this.races.length === 1) this.body = this.races[0];
        this.transformed = this.has('in_ice_prison') || forms.length > 0 || this.has('polymorph') || this.has('metamorphosis') ||
            this.has('fallen_demon_hunter') || (!!snapshot.currentBody && !this.races.includes(snapshot.currentBody));
        this.living = !this.has('being_undead') && !this.any(['creature_abomination', 'creature_lich', 'creature_banshee',
            'creature_ghoul', 'creature_vampire', 'creature_revenant', 'creature_kvaldir', 'creature_wickerman', 'creature_wicker_golem',
            'creature_wicker_behemoth', 'creature_watcher', 'creature_mechagnome', 'creature_voidwalker']);
        this.mindReplaced = this.has('fallen_demon_hunter') || this.fact('mind_replaced');
        this.corruptedNature = this.has('wc_druid_of_the_fang') || this.fact('nightmare_corruption') || this.fact('overriding_corruption');
        this.natureBond = this.living && !this.any(['being_demon', 'being_void']) && !this.corruptedNature &&
            this.any(['creature_dryad', 'creature_frostnymph', 'creature_protector', 'creature_ancient_lore', 'creature_ancient_war', 'creature_ancient_wind']);
    }
    has(id: string): boolean { return this.ids.has(id); }
    any(ids: readonly string[]): boolean { return ids.some(id => this.has(id)); }
    fact(key: string): boolean { return this.snapshot.facts[key] === true; }
    text(key: string): string | undefined { const v = this.snapshot.facts[key]; return typeof v === 'string' && v.trim() ? v : undefined; }
    isBody(ids: readonly string[]): boolean { return !!this.body && ids.includes(this.body); }
    tag(key: string): boolean { return !!this.encounter.tags?.includes(key); }
    rank(family: string): number { return [5, 4, 3, 2, 1].find(rank => this.has(`user_of_${family}_${rank}`)) ?? 0; }
    highest(prefix: string, rank: number, max = 3): boolean {
        return this.has(`${prefix}_${rank}`) && !Array.from({ length: max - rank }, (_, i) => `${prefix}_${rank + i + 1}`).some(id => this.has(id));
    }
    provider(key: string): boolean { return this.any(goaCatalogue.entries.find(e => e.key === key)!.ids); }
    get mortal(): boolean { return this.living && this.any(MORTAL_IDS) && !this.mindReplaced; }
    get elf(): boolean { return this.any(['creature_high_elf', 'creature_highborne', 'creature_nightborne']); }
    get fleshyUndead(): boolean {
        return this.has('being_undead') && !this.has('being_light') && this.isBody(['creature_human', 'creature_high_elf']);
    }
    get ancestry(): string[] {
        return [...new Set([...this.ids].filter(id => id.startsWith('blood_')).map(id => goaCatalogue.ancestry_labels[id])
            .filter(v => !!v && !this.has(v.base_race_id!)).map(v => v.name!))].sort();
    }
    get schools(): string[] {
        const result = new Set(this.encounter.magicSchools ?? []);
        for (const s of [this.snapshot, ...(this.encounter.participants ?? [])]) for (const id of s.traitIds) {
            const match = /^user_of_((?:elemental_)?(?:fire|water|air|earth|light|order|death|disorder|life|shadow))(?:_spirit|_decay)?_magic_[1-5]$/.exec(id);
            if (match) result.add(match[1]);
        }
        return [...result].sort();
    }
    get magicDefences(): string | undefined {
        const parts = this.schools.filter(school => Number.isFinite(this.snapshot.magicDefences?.[school]))
            .map(school => {
                const value = this.snapshot.magicDefences![school];
                const label = school.replace('elemental_', '').replace(/^./, c => c.toUpperCase());
                return `${label}: ${value > 0 ? 'net resistance' : value < 0 ? 'net vulnerability' : 'no net resistance or vulnerability'}`;
            });
        return parts.length ? parts.join('; ') : undefined;
    }
}
