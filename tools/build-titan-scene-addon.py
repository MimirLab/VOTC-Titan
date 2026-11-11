#!/usr/bin/env python3
"""Build the opt-in native scene picker over the supported stock CE files."""

import argparse
import importlib.util
import json
from pathlib import Path
import re
import shutil

from deployment_common import tree_hash
from goa_timeline_audit import parse


ROOT = Path(__file__).resolve().parents[1]
REGISTRY = 'mod/votc_titan_scenes.mod'
NAME = 'VOTC Titan Scenes'
VERSION = '1.0.0'
EVENTS = 'events/mcc_events_v2.txt'
AI = 'common/scripted_effects/votc_ai_initiate_effects.txt'
CHOOSER = 'common/scripted_guis/votc_select_talk_scene.txt'
PICKER = 'gui/custom_gui/votc_scene_selector.gui'
STRIP = 'common/scripted_guis/votc_strip_talk_scene.txt'
EFFECTS = 'common/scripted_effects/titan_scene_effects.txt'
TRIGGERS = 'common/scripted_triggers/titan_scene_triggers.txt'

# Current subscribed CE 2.5.0. Preserve the exact stock files around edits.
CE_PINS = {
    EVENTS: '542f142d784d2ce9fa225572805a6abdf75b4119b6eb5df5b6af17fd3bde2a13',
    AI: '998118d5782d8886974386e4c67b6ec28b6ffc95e596ed0a803693a9ab1f1207',
    CHOOSER: 'a893cebbfe7eca9d18fad5ee79b98f462c8091051c6e3aa06420ccab6acff7d8',
    PICKER: '67ac312da54bff624dccb13163f0850a5b487f6c767345c6b4ca5b0ac9aae2ea',
}


def single(nodes, key):
    matches = [node for node in nodes if node.key == key]
    if len(matches) != 1:
        raise ValueError(f'Expected exactly one CK3 definition of {key}')
    return matches[0]


def block_open(text, node):
    if not isinstance(node.value, list):
        raise ValueError(f'{node.key} must be a block')
    return text.index('{', node.start, node.end) + 1


def edit(text, changes):
    for start, end, value in sorted(changes, reverse=True):
        text = text[:start] + value + text[end:]
    parse(text)
    return text


def stock(ce, path):
    from hashlib import sha256
    data = (ce / path).read_bytes()
    if path in CE_PINS and sha256(data).hexdigest() != CE_PINS[path]:
        raise ValueError(f'Stock CE file changed: {path}')
    return data.decode('utf-8-sig').replace('\r\n', '\n')


def patch_events(text):
    """Check the final party before the three native conversation exports."""
    nodes = parse(text)
    patches = []
    for number, exporter, explicit_group in (
            ('8999', 'log_gamedata_v3s', True),
            ('9000', 'log_gamedata_v3l', True),
            ('9001', 'log_gamedata_v3', False)):
        event = single(nodes, 'mcc_event_v2.' + number)
        immediate = single(event.value, 'immediate')
        recipient = single(immediate.value, 'scope:recipient')
        single(recipient.value, exporter)
        binding = ('\n\t\ttitan_bind_scene_party_effect = yes\n'
                   + ('\t\tset_global_variable = { name = titan_scene_group_mode value = yes }\n'
                      if explicit_group else
                      '\t\tremove_global_variable = titan_scene_group_mode\n')
                   + '\t\ttitan_prepare_scenes_effect = yes')
        patches.append((recipient.start, recipient.start, binding.lstrip('\n\t') + '\n\t\t'))
        patches.append((recipient.end, recipient.end, '\n\t\ttitan_log_scene_effect = yes'))
    return edit(text, patches)


def patch_scene_pool(text):
    node = single(parse(text), 'votc_build_talk_scene_flags')
    start = block_open(text, node)
    return edit(text, [(start, node.end - 1,
                        '\n\ttitan_bind_scene_party_effect = yes\n\ttitan_prepare_scenes_effect = yes\n')])


def patch_chooser(stock_text, generated):
    """Keep CE's picker-close handshake, gated by the refreshed native choices."""
    stock_effect = single(single(parse(stock_text), 'votc_select_talk_scene').value, 'effect')
    generated_effect = single(single(parse(generated), 'votc_select_talk_scene').value, 'effect')
    choices = []
    for node in generated_effect.value:
        if node.key == 'if':
            choices.append(generated[node.start:node.end - 1]
                           + ' set_global_variable = votc_selector_close }')
    if not choices:
        raise ValueError('The native scene choice list is empty')
    body = '\n\ttitan_prepare_scenes_effect = yes\n\t' + '\n\t'.join(choices) + '\n'
    return edit(stock_text, [(block_open(stock_text, stock_effect), stock_effect.end - 1, body)])


def patch_picker(text):
    """Use Titan's four-column layout with CE 2.5's scripted close state."""
    stock_window = single(parse(text), 'window')
    close = single(stock_window.value, 'state')
    if single(close.value, 'name').value != 'votc_selector_close_watch':
        raise ValueError('Unrecognized CE picker close state')
    layout = (ROOT / 'game_mod/overrides' / PICKER).read_text(encoding='utf-8-sig')
    window = single(parse(layout), 'window')
    start = block_open(layout, window)
    layout = edit(layout, [(start, start, '\n    ' + text[close.start:close.end])])
    layout = layout.replace(
        '                                    onclick = "[GetVariableSystem.Clear(\'votc_scene_selector_opened\')]"\n', '')
    layout = re.sub(r'(?m)^\s*state = \{\n\s*name = (?:un)?hover\n[^}]*\}\n', '\n', layout)
    parse(layout)
    return layout


def compile_current_rules(addon, catalogue, compiler):
    """Use current game facts and keep unobserved history out of both rule polarities."""
    history = {state['id']: state for state in catalogue['worldStates'] if state['kind'] == 'historicalWindow'}
    text = (addon / TRIGGERS).read_text(encoding='utf-8-sig')
    nodes = parse(text)
    changes = []
    for state in history.values():
        name = 'titan_state_' + state['id'] + '_trigger'
        node = single(nodes, name)
        changes.append((block_open(text, node), node.end - 1, ' always = no '))
    text = edit(text, changes)
    for state in history.values():
        outside = ('location = { NOR = { ' + ' '.join(
            f'this = province:{province}' for province in state.get('provinceIds', [])
        ) + ' } }') if state.get('provinceIds') else 'always = no'
        name = 'titan_state_' + state['id'] + '_trigger'
        text = text.replace(name + ' = no', outside)
    parse(text)
    compiler.write(addon, TRIGGERS, text)

    text = (addon / EFFECTS).read_text(encoding='utf-8-sig').replace('VOTC:TITAN_SCENE/;/begin/;/1/;/', 'VOTC:TITAN_SCENE/;/begin/;/2/;/')
    # Preserve unknown history in the receipt. A different physical province
    # can establish that a location-specific state does not apply there.
    for state in history.values():
        name = state['id']
        prefix = f' if = {{ limit = {{ titan_state_{name}_trigger = yes }} '
        line = next(line for line in text.splitlines() if line.startswith(prefix))
        log = f'debug_log = "VOTC:TITAN_SCENE/;/fact/;/world_state/;/{name}='
        if state.get('provinceIds'):
            locations = ' '.join(f'this = province:{province}' for province in state['provinceIds'])
            replacement = (f' if = {{ limit = {{ location = {{ OR = {{ {locations} }} }} }} '
                           f'{log}unknown" }} else = {{ {log}no" }}')
        else:
            replacement = f' {log}unknown"'
        text = text.replace(line, replacement)
    # Scene selection is scoped to the same CE event root as the stock pool.
    text += '''
titan_bind_scene_party_effect = {
 set_global_variable = { name = titan_scene_anchor value = this }
 remove_global_variable = titan_scene_recipient
 if = { limit = { exists = scope:recipient }
  set_global_variable = { name = titan_scene_recipient value = scope:recipient }
 }
 remove_global_variable = titan_scene_group_mode
 if = { limit = { has_variable_list = mcc_characters_selected }
  set_global_variable = { name = titan_scene_group_mode value = yes }
 }
}
'''
    parse(text)
    compiler.write(addon, EFFECTS, text)


def build(ce, goa, art, addon):
    from hashlib import sha256
    if addon.exists():
        raise ValueError('Use a fresh staging directory')
    for path in CE_PINS:
        stock(ce, path)
    spec = importlib.util.spec_from_file_location('scene_compiler', ROOT / 'tools/build-game-mod.py')
    compiler = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(compiler)
    catalogue = json.loads(compiler.CATALOGUE.read_text())
    digest, scenes = compiler.compile_catalogue(addon, goa, include_assets=False, emit_companion=False)
    compile_current_rules(addon, catalogue, compiler)
    chooser = (addon / CHOOSER).read_text()
    for path, patched in (
        (EVENTS, patch_events(stock(ce, EVENTS))),
        (AI, patch_scene_pool(stock(ce, AI))),
        (CHOOSER, patch_chooser(stock(ce, CHOOSER), chooser)),
        (PICKER, patch_picker(stock(ce, PICKER))),
    ):
        compiler.write(addon, path, patched, bom=True)
    strip = stock(ce, STRIP)
    insertion = '\n'.join('\t\tremove_global_variable = ' + var for var in (
        'titan_scene_anchor', 'titan_scene_recipient', 'titan_scene_group_mode',
        'titan_scene_faith_access', 'titan_scene_admission_anchor'))
    assert strip.count('remove_global_variable = talk_scene') == 1
    compiler.write(addon, STRIP, strip.replace('remove_global_variable = talk_scene',
                   'remove_global_variable = talk_scene\n' + insertion), bom=True)

    assets = json.loads((art / 'manifest.json').read_text())
    if assets['catalogue'] != digest:
        raise ValueError('The launcher paintings use a different scene catalogue')
    owned = {scene['asset'] for scene in scenes if scene['source'] == 'generated'}
    if set(assets['files']) != owned:
        raise ValueError('The launcher painting inventory differs from the catalogue')
    for relative in sorted(owned):
        source = art / relative
        if sha256(source.read_bytes()).hexdigest() != assets['files'][relative]:
            raise ValueError(f'Unverified painting: {relative}')
        destination = addon / 'gfx/interface/illustrations' / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
    compiler.write(addon, 'descriptor.mod', f'name="{NAME}"\nversion="{VERSION}"\n'
                   'supported_version="1.19.0.6"\ntags={ "Utilities" }\n'
                   'dependencies={ "Voices of the Court 2.0 - Community Edition" "Warcraft: Guardians of Azeroth Reforged 2" }\n')
    shutil.copy2(ROOT / 'LICENSE', addon / 'LICENSE')
    metadata = {'name': NAME, 'version': VERSION, 'catalogue': digest, 'mode': 'goa',
                'cePins': CE_PINS, 'scenes': len(scenes), 'ownedPaintings': len(owned)}
    (addon / 'titan-scene-addon.json').write_text(json.dumps(metadata, indent=2) + '\n')
    seal = tree_hash(addon)
    addon.with_suffix('.sha256').write_text(seal + '\n')
    print(json.dumps({**metadata, 'treeSha256': seal}, indent=2))


if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    for name in ('ce', 'goa', 'art', 'output'):
        cli.add_argument('--' + name, type=Path, required=True)
    args = cli.parse_args()
    output = args.output.resolve()
    if output == ROOT / 'out' or not output.is_relative_to(ROOT / 'out'):
        cli.error('The build must use a fresh directory inside out/')
    build(args.ce.resolve(), args.goa.resolve(), args.art.resolve(), output)
