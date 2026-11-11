"""Encounter-local custody exception for explicitly reviewed dark-faith venues.

Nothing grants invitations or changes custody. CK3's current is_imprisoned_by
relationship and the preserved CE participant scopes supply the only exception.
"""

STATE = 'community_faith_access'
KIND = 'encounterFaithCustody'
KEYS = ['same_local_faith_or_prisoner_of_present_adherent']


def compile_admission(goa):
    if not goa:
        return '', 'titan_prepare_scene_admission_effect = { }\n'
    member = ('faith = global_var:titan_scene_anchor.location.county.faith '
              'is_at_same_location = global_var:titan_scene_anchor')
    # Changing into the saved subject makes PREV the current candidate captor.
    # It cannot be a historical jailer, absent host, unrelated pin or world ruler.
    captor = member + ' global_var:titan_scene_admission_subject = { is_imprisoned_by = prev }'
    triggers = (
        'titan_scene_current_captor_trigger = { OR = {\n'
        ' global_var:titan_scene_anchor = { ' + captor + ' }\n'
        ' global_var:titan_scene_recipient = { ' + captor + ' }\n'
        ' global_var:titan_scene_anchor = {\n'
        '  OR = {\n'
        '   AND = { NOT = { has_global_variable = titan_scene_group_mode } any_pinned_character = { ' + captor + ' } }\n'
        '   AND = { has_global_variable = titan_scene_group_mode has_variable_list = mcc_characters_selected any_in_list = { variable = mcc_characters_selected ' + captor + ' } }\n'
        '  }\n'
        ' }\n'
        ' AND = { has_global_variable_list = mcc_characters_list_v2 any_in_global_list = { variable = mcc_characters_list_v2 ' + captor + ' } }\n'
        '} }\n'
    )
    effects = (
        'titan_check_scene_admission_subject_effect = {\n'
        ' set_global_variable = { name = titan_scene_admission_subject value = this }\n'
        ' if = { limit = { NOT = { is_at_same_location = global_var:titan_scene_anchor } }\n'
        '  set_global_variable = { name = titan_scene_admission_failed value = yes }\n'
        ' }\n'
        ' else_if = { limit = { NOT = { OR = { faith = global_var:titan_scene_anchor.location.county.faith titan_scene_current_captor_trigger = yes } } }\n'
        '  set_global_variable = { name = titan_scene_admission_failed value = yes }\n'
        ' }\n'
        ' remove_global_variable = titan_scene_admission_subject\n'
        '}\n'
        'titan_prepare_scene_admission_effect = {\n'
        ' remove_global_variable = titan_scene_faith_access\n'
        ' remove_global_variable = titan_scene_admission_anchor\n'
        ' remove_global_variable = titan_scene_admission_failed\n'
        ' remove_global_variable = titan_scene_admission_subject\n'
        ' if = { limit = { exists = global_var:titan_scene_recipient this = global_var:titan_scene_anchor }\n'
        '  titan_check_scene_admission_subject_effect = yes\n'
        '  global_var:titan_scene_recipient = { titan_check_scene_admission_subject_effect = yes }\n'
        '  if = { limit = { NOT = { has_global_variable = titan_scene_group_mode } }\n'
        '   every_pinned_character = { limit = { is_at_same_location = global_var:titan_scene_anchor } titan_check_scene_admission_subject_effect = yes }\n'
        '  }\n'
        '  else_if = { limit = { has_variable_list = mcc_characters_selected }\n'
        '   every_in_list = { variable = mcc_characters_selected titan_check_scene_admission_subject_effect = yes }\n'
        '  }\n'
        '  if = { limit = { has_global_variable_list = mcc_characters_list_v2 }\n'
        '   every_in_global_list = { variable = mcc_characters_list_v2 titan_check_scene_admission_subject_effect = yes }\n'
        '  }\n'
        '  if = { limit = { NOT = { has_global_variable = titan_scene_admission_failed } }\n'
        '   set_global_variable = { name = titan_scene_faith_access value = yes }\n'
        '   set_global_variable = { name = titan_scene_admission_anchor value = this }\n'
        '  }\n'
        ' }\n'
        ' remove_global_variable = titan_scene_admission_failed\n'
        ' remove_global_variable = titan_scene_admission_subject\n'
        '}\n'
    )
    return triggers, effects
