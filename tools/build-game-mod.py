#!/usr/bin/env python3
"""Build a standalone Titan game component from the pinned, working CE snapshot.

Text sources are retained in game_mod/upstream. Unmodified large assets are cached
outside Git and verified against the manifest; Workshop updates cannot silently
become the base of a new build. The output is portable and needs no CE subscription.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
from deployment_common import tree_hash
from world_art_provenance import validate_edit_references
from scene_admission import KIND as CUSTODY_KIND, KEYS as CUSTODY_KEYS, STATE as CUSTODY_STATE, compile_admission

ROOT = Path(__file__).resolve().parents[1]
CATALOGUE = ROOT / 'game_mod/scenes/catalogue.json'
GAME_VERSION = '2.3.2-titan-scene-picker.1'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def write(root, relative, content, bom=None):
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    if bom is None:
        bom = relative.endswith('.txt') and relative.startswith(('common/', 'map_data/', 'gfx/'))
    path.write_text(content, encoding='utf-8-sig' if bom else 'utf-8')


def flag(scene):
    return 'flag:talk_scene_' + scene['id']


def validate_catalogue(c):
    """Reject unsupported gates rather than silently dropping their conditions."""
    if c.get('schema') != 1:
        raise ValueError('Unsupported scene catalogue schema.')
    def identifiers(values, label):
        if not isinstance(values, list) or any(not isinstance(v, str) or not re.fullmatch(r'[a-z0-9_]+', v) for v in values) or len(values) != len(set(values)):
            raise ValueError('Invalid or duplicate ' + label)
        return set(values)
    terrains = identifiers(c['terrains'], 'terrains')
    styles = identifiers([s['id'] for s in c['styles']], 'styles')
    regions = identifiers([r['id'] for r in c['regions']], 'regions')
    states = identifiers([s['id'] for s in c.get('worldStates', [])], 'world states')
    for state in c.get('worldStates', []):
        if state.get('kind') not in ('countyModifier', 'countyFaith', 'countyDoctrine', 'countyReligion', 'provinceCultureLineage', 'provinceTradition', 'encounterLocalFaith', 'encounterLocalCulture', CUSTODY_KIND, 'provinceModifier', 'provinceHolding', 'building', 'buildingExact', 'buildingAtSite', 'historicalWindow', 'ambientEpisode', 'encounteredAftermath', 'countyDevelopment', 'campOrActivity', 'provinceArmy') or not identifiers(state.get('keys'), 'observation keys'):
            raise ValueError('Unsupported world-state observation')
        if state['kind'] in ('encounterLocalFaith', 'encounterLocalCulture') and state['keys'] != [
                'same_local_faith' if state['kind'] == 'encounterLocalFaith' else 'same_local_culture']:
            raise ValueError('Unsupported encounter membership observation')
        if state['kind'] == CUSTODY_KIND and (state['id'] != CUSTODY_STATE or state['keys'] != CUSTODY_KEYS):
            raise ValueError('Unsupported custody admission observation')
        if state['kind'] == 'historicalWindow':
            from world_scene_contract import historical_window_expression
            historical_window_expression(state)
        if state['kind'] == 'provinceHolding' and set(state['keys']) - {'castle_holding', 'city_holding', 'church_holding', 'temple_citadel_holding'}:
            raise ValueError('Unsupported built holding observation')
        if state['kind'] == 'provinceArmy' and (state['id'] != 'local_army' or state['keys'] != ['any_army_in_location']):
            raise ValueError('Unsupported local army observation')
        if state['kind'] == 'campOrActivity' and (state['id'] != 'camp_or_hunt' or state['keys'] != ['activity_hunt']):
            raise ValueError('Unsupported local camp/activity observation')
        if state['kind'] == 'countyDevelopment' and (state['keys'] != ['development_level'] or type(state.get('minimum')) is not int or not 0 <= state['minimum'] <= 100):
            raise ValueError('Invalid development observation')
        if state['kind'] == 'encounteredAftermath' and (state['id'] != 'uncertain_aftermath' or state['keys'] != ['titan_scene_contamination_observed']):
            raise ValueError('Unsupported encounter metadata observation')
    physical = set()
    for region in c['regions']:
        if 'provinces' in region:
            members = region['provinces']
            if not isinstance(members, list) or not members or any(type(n) is not int or n <= 0 for n in members) or len(members) != len(set(members)) or physical & set(members):
                raise ValueError('Invalid or overlapping physical region')
            physical.update(members)
    for state in c.get('worldStates', []):
        if state['kind'] == 'buildingAtSite' and (type(state.get('provinceId')) is not int or state['provinceId'] not in physical):
            raise ValueError('A retained city facility needs an exact verified physical site')
        if state['kind'] == 'historicalWindow' and set(state.get('provinceIds', [])) - physical:
            raise ValueError('A local historical window needs verified physical sites')
    cultures = identifiers(c.get('cultures', []), 'cultures')
    sites = identifiers([s['id'] for s in c.get('citySites', [])], 'city sites')
    episodes = identifiers([s['id'] for s in c.get('episodes', [])], 'ambient episodes')
    for site in c.get('citySites', []):
        if not isinstance(site.get('conditions'), dict) or not isinstance(site.get('label'), str) or not site['label'].strip() or not site['conditions'].get('provinceIds') or any(
            k in site['conditions'] for k in ('citySites', 'regionalFallback')):
            raise ValueError('A city site requires its own non-recursive physical anchor')
    from world_scene_contract import validate_episodes
    validate_episodes(c)
    identifiers([s['id'] for s in c['scenes']], 'scene IDs')
    heritages = [h for s in c['styles'] for h in s['heritages']]
    identifiers(heritages, 'style heritages')
    domains = {'styles': styles, 'regions': regions, 'terrains': terrains,
               'cultures': cultures, 'excludedCultures': cultures, 'worldStates': states, 'excludedWorldStates': states,
               'citySites': sites}
    condition_records = [{'id': 'site_' + s['id'], 'label': s['label'], 'facts': 'City authoring conditions', 'conditions': s['conditions']} for s in c.get('citySites', [])]
    condition_records += [{'id': 'episode_' + e['id'], 'label': e['id'], 'facts': 'Ambient authoring conditions', 'conditions': e['conditions']} for e in c.get('episodes', [])]
    for scene in c['scenes'] + condition_records:
        for field in ('label', 'facts', 'socialContext'):
            if field == 'socialContext' and field not in scene:
                continue
            if not isinstance(scene.get(field), str) or not scene[field].strip():
                raise ValueError('Scene prose required: ' + scene['id'] + '.' + field)
        if 'purpose' in scene and not isinstance(scene['purpose'], str):
            raise ValueError('Scene prose required: ' + scene['id'] + '.purpose')
        conditions = scene['conditions']
        if not isinstance(conditions, dict) or set(conditions) - (set(domains) | {'settled', 'settledOrCamp', 'coastal', 'riverside', 'provinceIds', 'regionalFallback'}):
            raise ValueError('Unsupported scene condition: ' + scene['id'])
        for key, domain in domains.items():
            if key in conditions:
                values = identifiers(conditions[key], scene['id'] + '.' + key)
                if not values or values - domain:
                    raise ValueError('Unknown or empty scene condition: ' + scene['id'] + '.' + key)
        for key in ('settled', 'settledOrCamp', 'coastal', 'riverside', 'regionalFallback'):
            if key in conditions and type(conditions[key]) is not bool:
                raise ValueError('Scene boolean required: ' + key)
        if 'provinceIds' in conditions:
            members = conditions['provinceIds']
            if not isinstance(members, list) or not members or any(type(n) is not int or n <= 0 for n in members) or len(members) != len(set(members)) or set(members) - physical:
                raise ValueError('Unknown or invalid physical province gate: ' + scene['id'])
            if conditions.get('regions') and not set(members) <= {n for r in c['regions'] if r['id'] in conditions['regions'] for n in r.get('provinces', [])}:
                raise ValueError('Province gate crosses the authored region: ' + scene['id'])
        if set(conditions.get('worldStates', [])) & set(conditions.get('excludedWorldStates', [])):
            raise ValueError('Conflicting world-state gates: ' + scene['id'])
        if 'regionalEnvironment' in scene and type(scene['regionalEnvironment']) is not bool:
            raise ValueError('Regional environment boolean required')
        if scene.get('regionalEnvironment') and conditions.get('regionalFallback'):
            raise ValueError('Regional fallback must not recursively select itself')
        if set(conditions.get('cultures', [])) & set(conditions.get('excludedCultures', [])):
            raise ValueError('Conflicting culture gates: ' + scene['id'])
    scene_ids = {s['id'] for s in c['scenes']}
    scene_by_id = {s['id']: s for s in c['scenes']}
    for scene in c['scenes']:
        if 'reusesArtFrom' in scene:
            origin = scene_by_id.get(scene['reusesArtFrom'])
            if not (scene.get('landmarkScene') or scene.get('communityScene') or scene.get('oddityScene')) or not origin or origin.get('reusesArtFrom') or origin['id'] == scene['id'] or origin['source'] != 'generated' or any(
                    scene.get(key) != origin.get(key) for key in ('asset', 'environment', 'source')):
                raise ValueError('Artwork reuse must preserve a distinct original painting and its portrait environment')
        if 'replaces' in scene:
            targets = identifiers(scene['replaces'], 'replacement targets')
            if not targets or targets - scene_ids or scene['id'] in targets or scene['conditions'].get('regionalFallback'):
                raise ValueError('Invalid scene replacement')
            if any(other.get('replaces') for other in c['scenes'] if other['id'] in targets):
                raise ValueError('Replacement targets must be ordinary base scenes')


def write_companion_catalogue(c, fingerprint):
    write(ROOT, 'src/shared/scenes/catalogue.generated.ts',
          '// Generated by tools/build-game-mod.py from the shared scene catalogue.\n'
          'import { SceneDefinition, SceneCitySite, SceneEpisode } from "./types";\n'
          'export const SCENE_CATALOGUE_DIGEST = ' + json.dumps(fingerprint) + ';\n'
          'export const SCENE_CATALOGUE: { schema: number; terrains: string[]; cultures: string[]; styles: { id: string; heritages: string[] }[]; '
          'regions: { id: string; script: string; facts: string; provinces?: number[] }[]; '
          'worldStates: { id: string; kind: string; keys: string[]; minimum?: number; provinceId?: number; provinceIds?: number[]; fromYear?: number; untilYear?: number }[]; citySites: SceneCitySite[]; episodes: SceneEpisode[]; scenes: SceneDefinition[] } = '
          + json.dumps({**{k: c[k] for k in ('schema', 'terrains', 'styles', 'regions', 'scenes')}, 'cultures': c.get('cultures', []), 'worldStates': c.get('worldStates', []), 'citySites': c.get('citySites', []), 'episodes': c.get('episodes', [])}, indent=2) + ';\n')


def compile_catalogue(root, goa=None, *, include_assets=True, emit_companion=True):
    raw = CATALOGUE.read_bytes()
    c = json.loads(raw)
    validate_catalogue(c)
    from scene_presentation_contract import validated_parent
    validated_parent(ROOT, c)
    fingerprint = digest(raw)
    if emit_companion:
        write_companion_catalogue(c, fingerprint)
    styles = c['styles'] if goa else []
    regions = c['regions'] if goa else []
    cultures = c.get('cultures', []) if goa else []
    scenes = [s for s in c['scenes'] if goa or not (s['conditions'].get('styles') or s['conditions'].get('regions') or s['conditions'].get('cultures') or s['conditions'].get('excludedCultures') or s['conditions'].get('provinceIds') or s['conditions'].get('worldStates') or s['conditions'].get('citySites') or s['source'] == 'goa')]
    if goa:
        source = '\n'.join(p.read_text(encoding='utf-8-sig') for p in (goa / 'common/culture/cultures').glob('*.txt'))
        pillars = '\n'.join(p.read_text(encoding='utf-8-sig') for p in (goa / 'common/culture/pillars').glob('*.txt'))
        geo = '\n'.join(p.read_text(encoding='utf-8-sig') for p in (goa / 'map_data/geographical_regions').glob('*.txt'))
        for style in styles:
            for heritage in style['heritages']:
                if not re.search(r'^' + re.escape(heritage) + r'\s*=\s*\{', pillars, re.M):
                    raise ValueError('Unverified culture pillar: ' + heritage)
        for culture in cultures:
            if not re.search(r'^' + re.escape(culture) + r'\s*=\s*\{', source, re.M):
                raise ValueError('Unverified local culture: ' + culture)
        for region in regions:
            if not region.get('provinces') and not re.search(r'^' + re.escape(region['script']) + r'\s*=', geo, re.M):
                raise ValueError('Unverified geographical region: ' + region['script'])
        for file, expected in c.get('physicalMapSources', {}).items():
            path = goa / file
            if not path.is_file() or digest(path.read_bytes()) != expected:
                raise ValueError('GoA physical geography changed; re-audit the scene map: ' + file)
        modifier_source = '\n'.join(p.read_text(encoding='utf-8-sig') for p in (goa / 'common/modifiers').glob('*.txt'))
        building_source = '\n'.join(p.read_text(encoding='utf-8-sig') for p in (goa / 'common/buildings').glob('*.txt'))
        activity_source = '\n'.join(p.read_text(encoding='utf-8-sig') for p in (goa / 'common/activities/activity_types').glob('*.txt'))
        holding_source = '\n'.join(p.read_text(encoding='utf-8-sig') for p in (goa / 'common/holdings').glob('*.txt'))
        faith_source = '\n'.join(p.read_text(encoding='utf-8-sig') for p in (goa / 'common/religion/religion_types').glob('*.txt'))
        doctrine_source = '\n'.join(p.read_text(encoding='utf-8-sig') for p in (goa / 'common/religion/doctrine_types').glob('*.txt'))
        culture_source = '\n'.join(p.read_text(encoding='utf-8-sig') for p in (goa / 'common/culture/cultures').glob('*.txt'))
        tradition_source = '\n'.join(p.read_text(encoding='utf-8-sig') for p in (goa / 'common/culture/traditions').glob('*.txt'))
        for state in c.get('worldStates', []):
            if state['kind'] in ('encounteredAftermath', 'countyDevelopment', 'provinceArmy', 'ambientEpisode', 'historicalWindow', 'encounterLocalFaith', 'encounterLocalCulture', CUSTODY_KIND):
                continue  # Only the compiler-owned setter/exporter below can establish it.
            for key in state['keys']:
                if state['kind'] in ('countyReligion', 'provinceCultureLineage', 'provinceTradition'):
                    definitions = culture_source if state['kind'] == 'provinceCultureLineage' else tradition_source if state['kind'] == 'provinceTradition' else faith_source
                    if not re.search(r'^\s*' + re.escape(key) + r'\s*=\s*\{', definitions, re.M):
                        raise ValueError('Unverified local practice or admission observation: ' + key)
                    continue
                if state['kind'] in ('countyFaith','countyDoctrine'):
                    if not re.search(r'^\s*' + re.escape(key) + r'\s*=\s*\{', doctrine_source if state['kind']=='countyDoctrine' else faith_source, re.M):
                        raise ValueError('Unverified local faith: ' + key)
                    continue
                source = holding_source if state['kind'] == 'provinceHolding' else activity_source if state['kind'] == 'campOrActivity' else building_source if state['kind'] in ('building', 'buildingExact', 'buildingAtSite') else modifier_source
                if not re.search(r'^' + re.escape(key) + r'\s*=\s*\{', source, re.M):
                    raise ValueError('Unverified physical observation: ' + key)
        write(root, 'map_data/geographical_regions/titan_scene_regions.txt',
              '# Immutable physical scene pools; never changing de jure titles.\n' + ''.join(
                  r['script'] + ' = { provinces = { ' + ' '.join(map(str, r['provinces'])) + ' } }\n'
                  for r in regions if r.get('provinces')))

    def any_of(lines):
        return lines[0] if len(lines) == 1 else 'OR = { ' + ' '.join(lines) + ' }'

    settled = 'location = { OR = { has_holding_type = castle_holding has_holding_type = city_holding has_holding_type = tribal_holding has_holding_type = church_holding } }'
    if goa:
        settled = settled.replace('has_holding_type = church_holding', 'has_holding_type = church_holding has_holding_type = temple_citadel_holding')
    camp = 'location = { OR = { has_holding_type = nomad_holding has_holding_type = herder_holding } }'
    triggers = ['# Character scope is the stored player meeting anchor, never the current speaker.\n',
                'titan_scene_settled_trigger = { ' + settled + ' }\n',
                'titan_scene_camp_trigger = { ' + camp + ' }\n',
                'titan_scene_settled_or_camp_trigger = { OR = { titan_scene_settled_trigger = yes titan_scene_camp_trigger = yes } }\n']
    for style in styles:
        clauses = ['has_cultural_pillar = ' + h for h in style['heritages']]
        triggers.append('titan_style_' + style['id'] + '_trigger = { location = { culture = { ' + any_of(clauses) + ' } } }\n')
    for state in c.get('worldStates', []):
        if state['kind'] == 'countyReligion':
            expression = 'location.county.faith = { ' + any_of(['religion = religion:' + key for key in state['keys']]) + ' }' if goa else 'always = no'
            triggers.append('titan_state_' + state['id'] + '_trigger = { ' + expression + ' }\n')
            continue
        if state['kind'] == 'provinceCultureLineage':
            matches = any_of(['this = culture:' + key for key in state['keys']])
            expression = 'location.culture = { OR = { ' + matches + ' any_parent_culture_or_above = { ' + matches + ' } } }' if goa else 'always = no'
            triggers.append('titan_state_' + state['id'] + '_trigger = { ' + expression + ' }\n')
            continue
        if state['kind'] == 'provinceTradition':
            expression = 'location.culture = { ' + any_of(['has_cultural_tradition = ' + key for key in state['keys']]) + ' }' if goa else 'always = no'
            triggers.append('titan_state_' + state['id'] + '_trigger = { ' + expression + ' }\n')
            continue
        if state['kind'] == CUSTODY_KIND:
            expression = ('has_global_variable = titan_scene_faith_access exists = global_var:titan_scene_admission_anchor '
                          'this = global_var:titan_scene_admission_anchor') if goa else 'always = no'
            triggers.append('titan_state_' + state['id'] + '_trigger = { ' + expression + ' }\n')
            continue
        if state['kind'] in ('encounterLocalFaith', 'encounterLocalCulture'):
            # Admission is separate from local institution existence. The player,
            # primary interlocutor and every additional CE participant must qualify.
            property_name = 'faith' if state['kind'] == 'encounterLocalFaith' else 'culture'
            local_scope = 'location.county.faith' if property_name == 'faith' else 'location.culture'
            matches = property_name + ' = global_var:titan_scene_anchor.' + local_scope
            party_check = matches + ' is_at_same_location = global_var:titan_scene_anchor'
            expression = ('AND = { ' + matches +
                ' exists = global_var:titan_scene_recipient global_var:titan_scene_recipient = { ' + party_check + ' }'
                ' NOT = { AND = { NOT = { has_global_variable = titan_scene_group_mode } any_pinned_character = { is_at_same_location = global_var:titan_scene_anchor NOT = { ' + matches + ' } } } }'
                ' NOT = { AND = { has_global_variable = titan_scene_group_mode has_variable_list = mcc_characters_selected any_in_list = { variable = mcc_characters_selected NOT = { ' + party_check + ' } } } }'
                ' NOT = { AND = { has_global_variable_list = mcc_characters_list_v2 any_in_global_list = { variable = mcc_characters_list_v2 NOT = { ' + party_check + ' } } } } }') if goa else 'always = no'
            triggers.append('titan_state_' + state['id'] + '_trigger = { ' + expression + ' }\n')
            continue
        if state['kind'] == 'historicalWindow':
            from world_scene_contract import historical_window_expression
            expression = historical_window_expression(state) if goa else 'always = no'
            triggers.append('titan_state_' + state['id'] + '_trigger = { ' + expression + ' }\n')
            continue
        if state['kind'] == 'countyDoctrine':
            expression = 'location.county.faith = { ' + any_of(['has_doctrine = ' + key for key in state['keys']]) + ' }' if goa else 'always = no'
            triggers.append('titan_state_' + state['id'] + '_trigger = { ' + expression + ' }\n')
            continue
        if state['kind'] == 'countyFaith':
            expression = 'location.county.faith = { ' + any_of(['this = faith:' + key for key in state['keys']]) + ' }' if goa else 'always = no'
            triggers.append('titan_state_' + state['id'] + '_trigger = { ' + expression + ' }\n')
            continue
        if state['kind'] == 'buildingAtSite':
            expression = 'province:' + str(state['provinceId']) + ' = { ' + any_of(['has_building = ' + key for key in state['keys']]) + ' }' if goa else 'always = no'
            triggers.append('titan_state_' + state['id'] + '_trigger = { ' + expression + ' }\n')
            continue
        if state['kind'] == 'provinceHolding':
            expression = 'location = { ' + any_of(['has_holding_type = ' + key for key in state['keys']]) + ' }' if goa else 'always = no'
            triggers.append('titan_state_' + state['id'] + '_trigger = { ' + expression + ' }\n')
            continue
        if state['kind'] == 'ambientEpisode':
            expression = 'location = { has_variable = titan_scene_episode_' + state['id'] + ' }' if goa else 'always = no'
            triggers.append('titan_state_' + state['id'] + '_trigger = { ' + expression + ' }\n')
            continue
        if state['kind'] == 'provinceArmy':
            triggers.append('titan_state_' + state['id'] + '_trigger = { location = { any_army_in_location = { count >= 1 } } }\n')
            continue
        if state['kind'] == 'campOrActivity':
            # The hunt must belong to this encountered player and be at this
            # meeting location. Do not scan other activities or infer from war.
            expression = 'OR = { titan_scene_camp_trigger = yes AND = { exists = involved_activity involved_activity = { has_activity_type = activity_hunt activity_location = prev.location } } }'
            triggers.append('titan_state_' + state['id'] + '_trigger = { ' + expression + ' }\n')
            continue
        if state['kind'] == 'countyDevelopment':
            triggers.append('titan_state_' + state['id'] + '_trigger = { location = { county = { development_level >= ' + str(state['minimum']) + ' } } }\n')
            continue
        if state['kind'] == 'encounteredAftermath':
            expression = 'location = { has_variable = titan_scene_contamination_observed } NOT = { OR = { titan_state_fel_corruption_trigger = yes titan_state_death_corruption_trigger = yes titan_state_shadow_corruption_trigger = yes } }' if goa else 'always = no'
            triggers.append('titan_state_' + state['id'] + '_trigger = { ' + expression + ' }\n')
            continue
        scope = 'county = { ' if state['kind'] == 'countyModifier' else ''
        check = {'countyModifier': 'has_county_modifier', 'provinceModifier': 'has_province_modifier', 'building': 'has_building_or_higher', 'buildingExact': 'has_building'}[state['kind']]
        expression = 'location = { ' + scope + any_of([check + ' = ' + key for key in state['keys']]) + (' }' if scope else '') + ' }'
        if not goa and state['id'] != 'winter':
            expression = 'always = no'
        triggers.append('titan_state_' + state['id'] + '_trigger = { ' + expression + ' }\n')
    def condition_expression(k):
        parts = []
        if k.get('citySites'):
            parts.append(any_of(['titan_city_' + site + '_trigger = yes' for site in k['citySites']]))
        if k.get('styles'):
            parts.append(any_of(['titan_style_' + s + '_trigger = yes' for s in k['styles']]))
        if k.get('cultures'):
            parts.append('location = { culture = { ' + any_of(['this = culture:' + name for name in k['cultures']]) + ' } }')
        if k.get('excludedCultures'):
            parts.append('location = { culture = { NOT = { ' + any_of(['this = culture:' + name for name in k['excludedCultures']]) + ' } } }')
        if k.get('regions'):
            parts.append('location = { ' + any_of(['geographical_region = ' + next(r['script'] for r in regions if r['id'] == region) for region in k['regions']]) + ' }')
        if k.get('terrains'):
            parts.append('location = { ' + any_of(['terrain = ' + t for t in k['terrains']]) + ' }')
        if 'coastal' in k:
            parts.append('location = { is_coastal = ' + ('yes' if k['coastal'] else 'no') + ' }')
        if 'riverside' in k:
            parts.append('location = { is_riverside_province = ' + ('yes' if k['riverside'] else 'no') + ' }')
        if k.get('provinceIds'):
            parts.append('location = { ' + any_of(['this = province:' + str(n) for n in k['provinceIds']]) + ' }')
        if 'settled' in k:
            parts.append('titan_scene_settled_trigger = ' + ('yes' if k['settled'] else 'no'))
        if 'settledOrCamp' in k:
            parts.append('titan_scene_settled_or_camp_trigger = ' + ('yes' if k['settledOrCamp'] else 'no'))
        for state in k.get('worldStates', []):
            parts.append('titan_state_' + state + '_trigger = yes')
        for state in k.get('excludedWorldStates', []):
            parts.append('titan_state_' + state + '_trigger = no')
        if k.get('regionalFallback'):
            parts.append('titan_has_regional_environment_trigger = no')
        return ' '.join(parts) if parts else 'always = yes'
    if goa:
        for site in c.get('citySites', []):
            triggers.append('titan_city_' + site['id'] + '_trigger = { ' + condition_expression(site['conditions']) + ' }\n')
    for scene in scenes:
        triggers.append('titan_' + scene['id'] + '_base_eligible = { ' + condition_expression(scene['conditions']) + ' }\n')
        replacements = ['titan_' + other['id'] + '_base_eligible = yes' for other in scenes if scene['id'] in other.get('replaces', [])]
        expression = 'titan_' + scene['id'] + '_base_eligible = yes'
        if replacements:
            expression += ' NOT = { ' + any_of(replacements) + ' }'
        triggers.append('titan_' + scene['id'] + '_eligible = { ' + expression + ' }\n')
    regional = ['titan_' + s['id'] + '_eligible = yes' for s in scenes if s.get('regionalEnvironment')]
    triggers.append('titan_has_regional_environment_trigger = { ' + (any_of(regional) if regional else 'always = no') + ' }\n')
    admission_triggers, admission_effects = compile_admission(bool(goa))
    write(root, 'common/scripted_triggers/titan_scene_triggers.txt', ''.join(triggers) + admission_triggers)

    from world_scene_contract import compile_episodes
    episode_effects, episode_values = compile_episodes(c, condition_expression, bool(goa))
    write(root, 'common/script_values/titan_scene_episode_values.txt', episode_values)

    effects = [episode_effects, admission_effects, 'titan_prepare_scenes_effect = {\n titan_prepare_ambient_scenes_effect = yes\n titan_prepare_scene_admission_effect = yes\n if = { limit = { has_variable_list = talk_scene_flags } clear_variable_list = talk_scene_flags }\n']
    if goa:
        # Only the meeting province is remembered; no world sweep and no GoA
        # cleansing, corruption, owner, terrain or simulation effect is changed.
        effects.append(' if = { limit = { OR = { titan_state_fel_corruption_trigger = yes titan_state_death_corruption_trigger = yes titan_state_shadow_corruption_trigger = yes } } location = { set_variable = { name = titan_scene_contamination_observed value = yes } } }\n')
    for scene in scenes:
        effects.append(' if = { limit = { titan_' + scene['id'] + '_eligible = yes } add_to_variable_list = { name = talk_scene_flags target = ' + flag(scene) + ' } }\n')
    effects.append(' titan_ensure_scene_effect = yes\n}\n')
    preserve = ['AND = { global_var:talk_scene = ' + flag(s) + ' titan_' + s['id'] + '_eligible = yes }' for s in scenes]
    effects.append('titan_ensure_scene_effect = {\n'
        ' if = { limit = { NOT = { has_global_variable = talk_scene } } '
        'set_global_variable = { name = talk_scene value = flag:talk_scene_pending } }\n'
        ' if = { limit = { NOT = { ' + any_of(preserve) + ' } }\n')
    for i, scene in enumerate(sorted(scenes, key=lambda s: -s['priority'])):
        effects.append('  ' + ('if' if i == 0 else 'else_if') + ' = { limit = { titan_' + scene['id'] + '_eligible = yes } set_global_variable = { name = talk_scene value = ' + flag(scene) + ' } }\n')
    effects.append(' }\n}\n')
    mode = 'goa' if goa else 'core'
    effects.append('titan_log_scene_effect = {\n debug_log = "VOTC:TITAN_SCENE/;/begin/;/1/;/' + fingerprint + '/;/' + mode + '/;/[GetPlayer.GetID]/;/[GetGlobalVariable(\'talk_scene\').GetFlagName]/;/[GetPlayer.GetCurrentLocation.GetName]/;/[GetPlayer.GetCurrentLocation.GetController.GetFullNameNicknamedNoTooltipRegnal]"\n')
    def log(key, value):
        return 'debug_log = "VOTC:TITAN_SCENE/;/fact/;/' + key + '/;/' + value + '"'
    for t in c['terrains']:
        effects.append(' if = { limit = { location = { terrain = ' + t + ' } } ' + log('terrain', t) + ' }\n')
    for i, style in enumerate(styles):
        effects.append(' ' + ('if' if i == 0 else 'else_if') + ' = { limit = { titan_style_' + style['id'] + '_trigger = yes } ' + log('style', style['id']) + ' }\n')
    effects.append((' else = { ' + log('style', 'unknown') + ' }\n') if styles else ' ' + log('style', 'unknown') + '\n')
    for i, culture in enumerate(cultures):
        effects.append(' ' + ('if' if i == 0 else 'else_if') + ' = { limit = { location = { culture = { this = culture:' + culture + ' } } } ' + log('culture', culture) + ' }\n')
    effects.append((' else = { ' + log('culture', 'unknown') + ' }\n') if cultures else ' ' + log('culture', 'unknown') + '\n')
    for key, condition in [('settled', 'titan_scene_settled_trigger = yes'), ('camp', 'titan_scene_camp_trigger = yes'), ('coastal', 'location = { is_coastal = yes }'), ('riverside', 'location = { is_riverside_province = yes }')]:
        effects.append(' if = { limit = { ' + condition + ' } ' + log(key, 'yes') + ' } else = { ' + log(key, 'no') + ' }\n')
    for state in c.get('worldStates', []):
        effects.append(' if = { limit = { titan_state_' + state['id'] + '_trigger = yes } ' + log('world_state', state['id'] + '=yes') + ' } else = { ' + log('world_state', state['id'] + '=no') + ' }\n')
    for region in regions:
        effects.append(' if = { limit = { location = { geographical_region = ' + region['script'] + ' } } ' + log('region', region['id']) + ' }\n')
    for scene in scenes:
        effects.append(' if = { limit = { titan_' + scene['id'] + '_eligible = yes } ' + log('eligible', scene['id']) + ' }\n')
    effects.append(' debug_log = "VOTC:TITAN_SCENE/;/end/;/' + fingerprint + '"\n}\n')
    for scene in scenes:
        effects.append('titan_select_' + scene['id'] + '_effect = {\n global_var:titan_scene_anchor = {\n titan_prepare_scenes_effect = yes\n if = { limit = { titan_' + scene['id'] + '_eligible = yes } set_global_variable = { name = talk_scene value = ' + flag(scene) + ' } }\n titan_log_scene_effect = yes\n }\n}\n')
    write(root, 'common/scripted_effects/titan_scene_effects.txt', ''.join(effects))
    choices = []
    for scene in scenes:
        choices.append('if = { limit = { scope:selected_scene = ' + flag(scene) + ' titan_' + scene['id'] + '_eligible = yes } set_global_variable = { name = talk_scene value = scope:selected_scene } }\n')
    write(root, 'common/scripted_guis/votc_select_talk_scene.txt', 'votc_select_talk_scene = { effect = { titan_prepare_scenes_effect = yes\n' + ''.join(choices) + 'titan_log_scene_effect = yes } }\n')
    illustration = ['talk_background = {\n']
    thumbs = []
    for scene in scenes:
        for kind in ('texture', 'environment'):
            ref = scene['asset'] if kind == 'texture' else scene['environment']
            illustration.append(' ' + kind + ' = { reference = "' + ref + '" trigger = { global_var:talk_scene = ' + flag(scene) + ' } }\n')
        thumbs.append('talk_scene_' + scene['id'] + ' = { texture = { reference = "' + scene['asset'] + '" } environment = { reference = "' + scene['environment'] + '" } }\n')
    illustration.append('}\n')
    background_logs = ['log_backgrounds = {\n']
    for scene in scenes:
        texture_flag = 'texture_' + re.sub(r'[^a-zA-Z0-9_]', '_', scene['asset'])
        background_logs.append(' if = { limit = { global_var:talk_scene = ' + flag(scene) + ' } set_global_variable = { name = votc_background_texture value = flag:' + texture_flag + ' } }\n')
    background_logs.append('}\n')
    write(root, 'common/scripted_effects/log_backgrounds.txt', ''.join(background_logs))
    write(root, 'gfx/interface/illustrations/scripted_illustrations/scene_background.txt', ''.join(illustration))
    write(root, 'gfx/interface/illustrations/scripted_illustrations/titan_scene_selector.txt', ''.join(thumbs))
    write(root, 'localization/english/titan_scenes_l_english.yml', 'l_english:\n'
          ' titan_scene_picker_title:0 "Choose a Scene"\n'
          ' titan_scene_picker_location:0 "[GetPlayer.GetCurrentLocation.GetName]"\n'
          + '\n'.join(' talk_scene_' + s['id'] + '_title:0 ' + json.dumps(s['label'], ensure_ascii=False) for s in scenes) + '\n', bom=True)
    if not include_assets:
        # Authoring probe only: no game descriptor/manifest/seal is produced.
        # Full build always includes and validates every referenced asset.
        return fingerprint, scenes
    regional_art = {row['filename']: row for row in json.loads((ROOT / 'game_mod/assets/source/regional-generations.json').read_text())['images']} if any(s.get('regional') for s in scenes) else {}
    world_art = {row['filename']: row for row in json.loads((ROOT / 'game_mod/assets/source/world-generations.json').read_text())['images']} if any(s.get('worldScene') for s in scenes) else {}
    world_prompt_manifest = json.loads((ROOT / 'game_mod/assets/source/world-prompts.json').read_text()) if world_art else {}
    world_prompts = world_prompt_manifest.get('prompts', {})
    heritage_art = {row['filename']: row for row in json.loads((ROOT / 'game_mod/assets/source/heritage-court-generations.json').read_text())['images']} if any(s.get('reusesArtFrom') for s in scenes) else {}
    scene_by_id = {s['id']: s for s in c['scenes']}
    for scene in scenes:
        if not (scene.get('regional') or scene.get('worldScene')):
            continue
        filename = Path(scene['asset']).stem + '.png'
        path = ROOT / 'game_mod/assets/source' / filename
        origin = scene_by_id[scene['reusesArtFrom']] if scene.get('reusesArtFrom') else scene
        evidence = (world_art if origin.get('worldScene') else regional_art if origin.get('regional') else heritage_art).get(filename)
        if not evidence or evidence['status'] != 'accepted' or not path.is_file() or digest(path.read_bytes()) != evidence['sha256']:
            raise ValueError('Painting requires accepted matching provenance: ' + filename)
        if origin.get('worldScene') and (not evidence.get('review') or filename not in world_prompts or digest(world_prompts[filename].encode()) != evidence['promptSha256']):
            raise ValueError('World painting requires its reviewed immutable prompt: ' + filename)
        if origin.get('worldScene'):
            validate_edit_references(filename, evidence, world_art, world_prompt_manifest, ROOT / 'game_mod/assets/source')
    converted = set()
    for scene in scenes:
        asset = scene['asset']
        if scene['source'] == 'generated':
            if asset in converted:
                continue
            target = root / 'gfx/interface/illustrations' / asset
            target.parent.mkdir(parents=True, exist_ok=True)
            source = ROOT / 'game_mod/assets/source' / (Path(asset).stem + '.png')
            subprocess.run(['magick', str(source), '-resize', '1592x848^', '-gravity', 'center', '-extent', '1592x848', '-define', 'dds:compression=dxt1', str(target)], check=True)
            converted.add(asset)
        elif scene['source'] == 'goa':
            if not (goa / 'gfx/interface/illustrations' / asset).is_file():
                raise ValueError('Missing GoA artwork ' + asset)
        elif not (root / 'gfx/interface/illustrations' / asset).is_file():
            raise ValueError('Missing pinned artwork ' + asset)
    return fingerprint, scenes


def conversation_numeric_date_export(text):
    """Complete the numeric init tail consumed by the existing app parser.

    The pinned exporter ends after a lone save-protocol field. The app expects
    five date fields before the three snapshot fields. Export observations only:
    no date guessing, snapshot activation, variable writes or save operations.
    """
    matches = list(re.finditer(r'debug_log = "(VOTC:IN/;/init[^"\n]*)"', text))
    if len(matches) != 1:
        raise ValueError('Unrecognized numeric-date init wire')
    match = matches[0]
    fields = match.group(1).split('/;/')
    data = fields[2:]
    legacy_snapshot = "[GetPlayer.MakeScope.Var('votc_save_snapshot_protocol').GetValue|0]"
    if len(data) != 24 or data[15:17] != ['2', '1'] or data[23] != legacy_snapshot:
        raise ValueError('Unrecognized or already extended numeric-date init wire')
    date = ['[GetCurrentDate.GetDateAsTotalDays]', '[GetCurrentDate.GetYear]',
            '[GetCurrentDate.GetMonthOfYear]', '[GetCurrentDate.GetDayOfMonth]',
            '[GetCurrentDate.GetStringShort]']
    snapshot = [legacy_snapshot,
                "[GetPlayer.MakeScope.Var('votc_save_snapshot_sequence').GetValue|0]",
                "[GetPlayer.MakeScope.Var('votc_save_snapshot_slot').GetValue|0]"]
    wire = '/;/'.join(fields[:2] + data[:23] + date + snapshot)
    return text[:match.start(1)] + wire + text[match.end(1):]


def conversation_scene_export(text, name):
    """Refresh party admission before CE init, while retaining its wire format."""
    text = conversation_numeric_date_export(text)
    if name != 'log_gamedata_v3l_effect.txt':
        effect_name = 'log_gamedata_v3s' if name == 'log_gamedata_v3s_effect.txt' else 'log_gamedata_v3'
        opening = re.search(r'^' + effect_name + r'\s*=\s*\{', text, re.M)
        if not opening:
            raise ValueError('Missing CE conversation exporter: ' + name)
        entry = opening.end()
        refresh = ('\n\tset_global_variable = { name = titan_scene_anchor value = scope:actor }'
            '\n\tremove_global_variable = titan_scene_recipient'
            '\n\tif = { limit = { exists = scope:recipient } set_global_variable = { name = titan_scene_recipient value = scope:recipient } }'
            + ('\n\tset_global_variable = { name = titan_scene_group_mode value = yes }' if name == 'log_gamedata_v3s_effect.txt' else '\n\tremove_global_variable = titan_scene_group_mode')
            + '\n\tglobal_var:titan_scene_anchor = { titan_prepare_scenes_effect = yes }')
        text = text[:entry] + refresh + text[entry:]
    else:
        text = text.replace('\tlog_backgrounds = yes', '\tglobal_var:titan_scene_anchor = { titan_prepare_scenes_effect = yes }\n\tlog_backgrounds = yes', 1)
    text = text.replace('[recipient.GetCurrentLocation.GetName]', '[GetPlayer.GetCurrentLocation.GetName]').replace('[recipient.GetCurrentLocation.GetController.GetFullNameNicknamedNoTooltipRegnal]', '[GetPlayer.GetCurrentLocation.GetController.GetFullNameNicknamedNoTooltipRegnal]')
    init = text.index('\tdebug_log = "VOTC:IN/;/init')
    end = text.index('\n', init)
    return text[:end] + '\n\tglobal_var:titan_scene_anchor = { titan_log_scene_effect = yes }' + text[end:]


def build(base, output, goa=None):
    manifest = json.loads((ROOT / 'game_mod/upstream-manifest.json').read_text())
    for rel, expected in manifest['files'].items():
        path = base / rel
        if not path.is_file() or digest(path.read_bytes()) != expected:
            raise ValueError('Base differs from the pinned working snapshot: ' + rel)
    if output.exists():
        shutil.rmtree(output)
    shutil.copytree(base, output)
    # Text source edits remain reviewable in Git; pinned cached art stays untouched.
    shutil.copytree(ROOT / 'game_mod/upstream', output, dirs_exist_ok=True)
    shutil.copytree(ROOT / 'game_mod/overrides', output, dirs_exist_ok=True)
    descriptor = 'name="VOTC Titan Edition"\nversion="' + GAME_VERSION + '"\nsupported_version="1.20.*"\ntags={ "Gameplay" "Utilities" }\n'
    if goa:
        descriptor += 'dependencies={ "Warcraft: Guardians of Azeroth Reforged 2" }\n'
    write(output, 'descriptor.mod', descriptor)
    shutil.copy2(ROOT / 'LICENSE', output / 'LICENSE')
    write(output, 'TITAN-ATTRIBUTION.txt', 'VOTC Titan Edition game component.\nDerived from Voices of the Court 2.0 - Community Edition, Workshop 3654567139, version 2.3.2.\nCompanion source baseline: Community Edition 2.2.0-beta.2.\nUpstream: https://github.com/szmania/Voices_of_the_Court\nUpstream GPL attribution and event/save identities retained.\nGoA2 art is referenced from its installed pack, not copied or redistributed.\n')
    fingerprint, scenes = compile_catalogue(output, goa)
    event = output / 'events/mcc_events_v2.txt'
    text = event.read_text(encoding='utf-8-sig')
    start = text.index('\t\tif = {\n\t\t\tlimit = {\n\t\t\t\thas_variable_list = talk_scene_flags')
    # Stop at the immediate block, preserving the following scene-picker widget.
    end = text.index('\n\t}\n\n\twidget', start)
    recipient_capture = ('\n\t\tremove_global_variable = titan_scene_group_mode'
        '\n\t\tremove_global_variable = titan_scene_recipient'
        '\n\t\tif = { limit = { exists = scope:recipient } set_global_variable = { name = titan_scene_recipient value = scope:recipient } }')
    text = text[:start] + '\t\tset_global_variable = { name = titan_scene_anchor value = this }' + recipient_capture + '\n\t\ttitan_prepare_scenes_effect = yes' + text[end:]
    event.write_text(text, encoding='utf-8')
    for name in ('log_gamedata_v3_effect.txt', 'log_gamedata_v3s_effect.txt', 'log_gamedata_v3l_effect.txt'):
        path = output / 'common/scripted_effects' / name
        text = path.read_text(encoding='utf-8-sig')
        path.write_text(conversation_scene_export(text, name), encoding='utf-8')
    portraits = output / 'gui/shared/conversation_portraits.gui'
    text = portraits.read_text().replace("GetGlobalVariable('talk_second_scope').GetCharacter", 'GetPlayer')
    text = text.replace('Illustration.GetEnvironment(Character.Self)', "GetIllustration('talk_background').GetEnvironment(GetPlayer)")
    portraits.write_text(text)
    loc = output / 'localization/english/talk_l_english.yml'
    loc.write_text(loc.read_text(encoding='utf-8-sig').replace('Voices of the Court 2.0 - Community Edition', 'VOTC Titan Edition'), encoding='utf-8-sig')
    write(output, 'titan-scene-manifest.json', json.dumps({'schema': 1, 'version': GAME_VERSION, 'catalogue': fingerprint, 'mode': 'goa' if goa else 'core', 'scenes': [s['id'] for s in scenes], 'upstream_manifest': digest((ROOT / 'game_mod/upstream-manifest.json').read_bytes())}, indent=2) + '\n')
    output.with_name(output.name + '.sha256').write_text(tree_hash(output) + '\n')
    print(json.dumps({'output': str(output), 'catalogue': fingerprint, 'scenes': len(scenes), 'mode': 'goa' if goa else 'core'}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', type=Path, default=ROOT / 'out/game-mod-baseline')
    parser.add_argument('--output', type=Path, default=ROOT / 'out/titan-game-mod')
    parser.add_argument('--goa-root', type=Path)
    parser.add_argument('--catalogue-only', action='store_true', help='Validate and regenerate TypeScript only; create no deployable game stage.')
    args = parser.parse_args()
    # Never allow a build to remove upstream/game/user directories.
    output = args.output.resolve()
    if output in (ROOT, ROOT / 'out') or not output.is_relative_to(ROOT / 'out') or args.base.resolve().is_relative_to(output):
        parser.error('Output must be a dedicated folder under this workspace\'s out directory.')
    if args.catalogue_only:
        raw = CATALOGUE.read_bytes(); catalogue = json.loads(raw)
        validate_catalogue(catalogue)
        from scene_presentation_contract import validated_parent
        validated_parent(ROOT, catalogue)
        write_companion_catalogue(catalogue, digest(raw))
        print(json.dumps({'catalogue': digest(raw), 'deployableStageCreated': False}))
    else:
        build(args.base.resolve(), output, args.goa_root.resolve() if args.goa_root else None)
