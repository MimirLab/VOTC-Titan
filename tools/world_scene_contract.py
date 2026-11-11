"""Compiler-owned local ambience: saved seed + game-day cycle, no world scan."""
import calendar


def historical_window_expression(state):
    """Year-precision chronology, observed from the saved CK3 date.

    First-day boundaries are the explicit authoring convention for sources that
    date events to a year, not invented exact historical days. No event receipt,
    building, computer clock or random recurrence establishes this observation.
    """
    if state.get('kind') != 'historicalWindow' or state.get('keys') != [state['id']]:
        raise ValueError('Historical windows need their exact compiler-owned observation')
    bounds = [state.get('fromYear'), state.get('untilYear')]
    if bounds == [None, None] or any(y is not None and (type(y) is not int or not 1 <= y <= 9999) for y in bounds):
        raise ValueError('Historical windows need valid bounded years')
    if all(y is not None for y in bounds) and bounds[0] >= bounds[1]:
        raise ValueError('Historical window endpoints must be ordered')
    provinces = state.get('provinceIds')
    if provinces is not None and (not isinstance(provinces, list) or not provinces or
            any(type(n) is not int or n <= 0 for n in provinces) or len(provinces) != len(set(provinces))):
        raise ValueError('Local historical windows need unique physical province IDs')
    parts = []
    if bounds[0] is not None:
        parts.append('current_date >= ' + str(bounds[0]) + '.1.1')
    if bounds[1] is not None:
        parts.append('current_date < ' + str(bounds[1]) + '.1.1')
    if provinces is not None:
        parts.append('location = { OR = { ' + ' '.join('this = province:' + str(n) for n in provinces) + ' } }')
    return ' '.join(parts)


def validate_episodes(c):
    episodes = c.get('episodes', [])
    states = {s['id']: s for s in c.get('worldStates', [])}
    ids = {e['id'] for e in episodes}
    observed = set()
    for episode in episodes:
        name = episode['id']
        state = states.get(name)
        if not state or state['kind'] != 'ambientEpisode' or state['keys'] != ['titan_scene_episode_' + name]:
            raise ValueError('Ambient episode must have its exact compiler-owned observation')
        for field, low, high in [('periodDays', 2, 366), ('activeDays', 1, 365), ('chance', 1, 100), ('salt', 0, 10000)]:
            if type(episode.get(field)) is not int or not low <= episode[field] <= high:
                raise ValueError('Invalid ambient recurrence: ' + name + '.' + field)
        if episode['activeDays'] > episode['periodDays'] or (episode['activeDays'] == episode['periodDays'] and not episode.get('calendar')):
            raise ValueError('An occasional scene must have inactive days or a bounded calendar window')
        conditions = episode.get('conditions', {})
        if not isinstance(conditions, dict) or any(k in conditions for k in ('regionalFallback', 'citySites')) or not (
            conditions.get('regions') or conditions.get('provinceIds')):
            raise ValueError('Ambient episodes need a bounded physical habitat')
        dependencies = set(conditions.get('worldStates', [])) | set(conditions.get('excludedWorldStates', []))
        if dependencies & ids - observed:
            raise ValueError('Ambient dependencies must precede consumers without cycles')
        windows = episode.get('calendar', [])
        seen_months = set()
        if not isinstance(windows, list):
            raise ValueError('Invalid ambient calendar')
        for w in windows:
            if set(w) != {'month', 'fromDay', 'toDay'} or any(type(v) is not int for v in w.values()) or not (
                1 <= w['month'] <= 12 and 1 <= w['fromDay'] <= w['toDay'] <= calendar.monthrange(2000,w['month'])[1]) or w['month'] in seen_months:
                raise ValueError('Invalid or duplicate game-calendar window')
            seen_months.add(w['month'])
        if episode['activeDays'] == episode['periodDays'] and sum(w['toDay']-w['fromDay']+1 for w in windows)>90:
            raise ValueError('A calendar-only occasion cannot span most of the year')
        observed.add(name)
    if {s['id'] for s in states.values() if s['kind'] == 'ambientEpisode'} != ids:
        raise ValueError('Ambient observations cannot exist without a producer')


def compile_episodes(c, expression, goa):
    episodes = c.get('episodes', []) if goa else []
    if not episodes:
        return 'titan_prepare_ambient_scenes_effect = { }\n', '# No ambient profiles in this distribution.\n'
    values = ['# Numeric current_date is the game day; no computer clock or fresh reply roll.\n']
    effects = ['# Character scope: only this meeting location is touched.\n',
        'titan_scene_seed_bit_effect = {\n change_variable = { name = titan_scene_local_seed multiply = 2 }\n',
        ' random = { chance = 50 change_variable = { name = titan_scene_local_seed add = 1 } }\n}\n',
        'titan_prepare_ambient_scenes_effect = {\n',
        ' if = { limit = { exists = location has_global_variable = votc_campaign_id_a }\n',
        '  location = { if = { limit = { NOT = { has_variable = titan_scene_local_seed } }\n',
        '   set_variable = { name = titan_scene_local_seed value = 1 }\n',
        *['   titan_scene_seed_bit_effect = yes\n' for _ in range(16)],
        '  }\n']
    # Clear before resolving the DAG so a previous capture never supplies a stale
    # weather prerequisite. The selected snapshot remains held by the companion.
    for e in episodes:
        effects.append('   if = { limit = { has_variable = titan_scene_episode_' + e['id'] + ' } remove_variable = titan_scene_episode_' + e['id'] + ' }\n')
    effects.append('  }\n')
    for e in episodes:
        prefix = 'titan_episode_' + e['id']
        period = e['periodDays']
        values.append(prefix + '_cycle = { value = current_date add = { value = location.var:titan_scene_local_seed modulo = ' + str(period) + ' } divide = ' + str(period) + ' floor = yes }\n')
        values.append(prefix + '_phase = { value = current_date add = { value = location.var:titan_scene_local_seed modulo = ' + str(period) + ' } modulo = ' + str(period) + ' }\n')
        values.append(prefix + '_ticket = { value = { value = location.var:titan_scene_local_seed modulo = 997 multiply = 37 } add = { value = global_var:votc_campaign_id_a modulo = 997 multiply = 17 } add = { value = ' + prefix + '_cycle modulo = 997 multiply = 53 } add = ' + str(e['salt']) + ' modulo = 100 }\n')
        parts = [expression(e['conditions']), prefix + '_phase < ' + str(e['activeDays']), prefix + '_ticket < ' + str(e['chance'])]
        windows = e.get('calendar', [])
        if windows:
            branches = ['AND = { current_month = ' + str(w['month']) + ' current_day >= ' + str(w['fromDay']) + ' current_day <= ' + str(w['toDay']) + ' }' for w in windows]
            parts.append('OR = { ' + ' '.join(branches) + ' }')
        effects.append('  if = { limit = { ' + ' '.join(parts) + ' } location = { set_variable = { name = titan_scene_episode_' + e['id'] + ' value = yes } } }\n')
    effects.append(' }\n}\n')
    return ''.join(effects), ''.join(values)
