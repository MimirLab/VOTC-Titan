"""Keep original-annals navigation inside the actual campaign clock and branch.

The accepted upstream reader keeps a reference/default-sample Reader beside its
campaign Reader. History navigation must use the campaign-bound original text;
an earlier-annals label is not permission to use the sample save's chronology.
No book data, selected choices or character knowledge grants are changed.
"""


def bind_campaign_clock(reader):
    from lorebank.goa_reader import GoAReader, ContextDatabase
    from lorebank.campaign_lore import CampaignReader
    history = reader.upstream if isinstance(reader, CampaignReader) else reader
    if not isinstance(history, GoAReader) or history.mode != 'history' or not history.state:
        raise ValueError('Actual campaign history reader required')
    state = history.state
    if not isinstance(history.base.db, ContextDatabase) or history.base.db.context is not state:
        raise ValueError('Original annals are not bound to this campaign context')
    if history.base.scope != (state['campaign_id'], state['timeline_id']):
        raise ValueError('Original annals belong to another campaign or timeline')
    history.original = history.base
    return reader
