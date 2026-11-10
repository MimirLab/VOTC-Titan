import { SCENE_CATALOGUE_DIGEST, SCENE_CATALOGUE } from './catalogue.generated';
import { SceneSnapshot } from './types';
import { removeTooltip } from '../gameData/gameText';
import { sceneEligible } from './sceneContext';

const MARKER = 'VOTC:TITAN_SCENE/;/';
const id = /^[a-z0-9_]+$/;

/** A partial, mismatched or malformed transaction never becomes scene context. */
export class SceneLogReader {
    private pending?: SceneSnapshot;
    private seen = new Set<string>();
    private invalid = false;
    observeLine(line: string): SceneSnapshot | undefined {
        const index = line.indexOf(MARKER);
        if (index < 0) return undefined;
        const fields = line.slice(index + MARKER.length).replace(/\r$/, '').split('/;/');
        const kind = fields.shift();
        if (kind === 'begin') {
            this.pending = undefined; this.seen.clear(); this.invalid = false;
            const [schema, digest, mode, anchor, rawSelected, rawLocation, rawController] = fields;
            const location = removeTooltip(rawLocation);
            const controller = removeTooltip(rawController);
            const selected = rawSelected?.replace(/^talk_scene_/, "");
            // The existing, engine-verified GetName export contains CK3's clickable
            // physical province ID. Never route by translated name or ruler title.
            const provinceIds = [...(rawLocation?.matchAll(/(?:ONCLICK|TOOLTIP):PROVINCE,(\d+)\b/g) ?? [])]
                .map(match => Number(match[1]));
            const uniqueProvinces = new Set(provinceIds);
            if (fields.length !== 7 || schema !== '1' || digest !== SCENE_CATALOGUE_DIGEST ||
                !['core', 'goa'].includes(mode) || !/^\d+$/.test(anchor) || !Number.isSafeInteger(Number(anchor)) || !id.test(selected) ||
                uniqueProvinces.size > 1 || provinceIds.some(n => !Number.isSafeInteger(n) || n <= 0) ||
                !location || location.length > 300 || controller.length > 300 || /[\[\]\r\n]/.test(location + controller)) return undefined;
            this.pending = { schema: 1, catalogue: digest, mode: mode as 'core' | 'goa', anchorId: Number(anchor),
                selected, location, controller, terrain: '', style: '', culture: 'unknown', regions: [], settled: false,
                provinceId: provinceIds[0], camp: false, coastal: false, riverside: false, worldStates: [], eligible: [] };
            return undefined;
        }
        const p = this.pending;
        if (!p) return undefined;
        if (kind === 'end') {
            this.pending = undefined;
            const expectedRegions = p.mode === 'goa' && p.provinceId ?
                SCENE_CATALOGUE.regions.filter(r => r.provinces?.includes(p.provinceId!)).map(r => r.id) : [];
            const expectedScenes = SCENE_CATALOGUE.scenes.filter(scene => sceneEligible(scene, p)).map(scene => scene.id);
            if (this.invalid || fields.length !== 1 || fields[0] !== p.catalogue ||
                !['terrain', 'style', 'culture', 'settled', 'camp', 'coastal', 'riverside',
                    ...SCENE_CATALOGUE.worldStates.map(state => 'world_state:' + state.id)].every(k => this.seen.has(k)) || !p.eligible.length ||
                !p.eligible.includes(p.selected) || expectedRegions.some(r => !p.regions.includes(r)) ||
                p.eligible.length !== expectedScenes.length || expectedScenes.some(scene => !p.eligible.includes(scene))) return undefined;
            return p;
        }
        if (fields.length !== 2 || kind !== 'fact') { this.invalid = true; return undefined; }
        const [key, value] = fields;
        if (['terrain', 'style', 'culture', 'settled', 'camp', 'coastal', 'riverside'].includes(key)) {
            if (this.seen.has(key)) this.invalid = true;
            this.seen.add(key);
        }
        switch (key) {
            case 'terrain':
                if (!SCENE_CATALOGUE.terrains.includes(value)) this.invalid = true;
                p.terrain = value; break;
            case 'style':
                if (value !== 'unknown' && !SCENE_CATALOGUE.styles.some(s => s.id === value)) this.invalid = true;
                p.style = value; break;
            case 'culture':
                if (value !== 'unknown' && !SCENE_CATALOGUE.cultures.includes(value)) this.invalid = true;
                p.culture = value; break;
            case 'settled': case 'camp': case 'coastal': case 'riverside':
                if (value !== 'yes' && value !== 'no') this.invalid = true;
                p[key] = value === 'yes'; break;
            case 'region':
                const region = SCENE_CATALOGUE.regions.find(r => r.id === value);
                if (!region || p.regions.includes(value) || (region.provinces && !region.provinces.includes(p.provinceId!))) this.invalid = true;
                p.regions.push(value); break;
            case 'world_state': {
                const [state, present, ...extra] = value.split('=');
                if (extra.length || !SCENE_CATALOGUE.worldStates.some(s => s.id === state) ||
                    !['yes', 'no'].includes(present) || this.seen.has('world_state:' + state)) this.invalid = true;
                this.seen.add('world_state:' + state);
                if (present === 'yes') p.worldStates.push(state);
                break;
            }
            case 'eligible':
                if (!SCENE_CATALOGUE.scenes.some(s => s.id === value) || p.eligible.includes(value)) this.invalid = true;
                p.eligible.push(value); break;
            default: this.invalid = true;
        }
        return undefined;
    }
    reset(): void { this.pending = undefined; this.seen.clear(); this.invalid = false; }
}
