import { ipcRenderer } from 'electron';

const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const results = element('lore-results'), status = element('lore-status');
let generation = 0, draft: any, next: { op: string; query?: string; node_id?: string; cursor: string } | undefined;
const knowledgeNames = new Map<string, string>();
async function request(body: any): Promise<any> {
    const response = await ipcRenderer.invoke('lorebook', body);
    if (response.error) throw new Error(response.error);
    return response;
}
function button(label: string, action: () => void): HTMLButtonElement {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.textContent = label;
    b.addEventListener('click', action); return b;
}
async function guarded(action: () => Promise<void>): Promise<void> {
    try { await action(); } catch (error) { status.textContent = error instanceof Error ? error.message : 'Chronicle unavailable'; }
}
async function refresh(): Promise<void> {
    const value = await request({ op: 'status' });
    status.textContent = value.ready ? `${Object.values(value.counts.passages).reduce((a: number, b: any) => a + Number(b), 0).toLocaleString()} passages installed. ${value.diagnostic}` : value.diagnostic;
    element('lore-index-status').textContent = (value.semantic?.state || '') + (value.semantic?.done ? ` (${value.semantic.done.toLocaleString()} passages)` : '');
}
function renderKnowledge(): void {
    const list = element('lore-known'); list.replaceChildren();
    for (const id of draft?.lore_knowledge.known_subjects || []) {
        const item = document.createElement('li'); item.textContent = knowledgeNames.get(id) || 'Saved known subject';
        item.append(button('Remove', () => { draft.lore_knowledge.known_subjects = draft.lore_knowledge.known_subjects.filter((x: string) => x !== id); renderKnowledge(); })); list.append(item);
    }
}
function addKnowledge(id: string, title: string): void {
    if (!draft) { status.textContent = 'Choose the current campaign character below before adding knowledge.'; return; }
    if (!draft.lore_knowledge.known_subjects.includes(id)) draft.lore_knowledge.known_subjects.push(id);
    knowledgeNames.set(id, title);
    renderKnowledge(); status.textContent = `${title} added to the character’s draft knowledge. Save when ready.`;
}
async function lookup(body: any): Promise<void> {
    const own = ++generation;
    status.textContent = 'Reading the Chronicle…';
    const value = await request(body);
    if (own !== generation) return;
    results.replaceChildren();
    if (body.op === 'search') {
        for (const entry of value.entries) {
            const article = document.createElement('article'), heading = document.createElement('h3'), prose = document.createElement('p');
            heading.textContent = entry.title; prose.textContent = entry.overview;
            article.append(heading, prose, button('Read account', () => void guarded(() => lookup({ op: 'read', node_id: entry.node_id }))),
                button('Known to this character', () => addKnowledge(entry.node_id, entry.title)));
            results.append(article);
        }
        if (!value.entries.length) results.textContent = 'No available accounts matched. Try a people, place or shorter phrase.';
    } else {
        const title = document.createElement('h3'), text = document.createElement('div');
        title.textContent = value.title; text.textContent = value.text; text.style.whiteSpace = 'pre-wrap';
        results.append(title, text);
        for (const group of [{ name: 'Parent account', rows: value.parent ? [value.parent] : [] }, { name: 'Chapters', rows: value.children }, { name: 'Related accounts', rows: value.related }]) {
            if (!group.rows.length) continue;
            const label = document.createElement('h4'); label.textContent = group.name; results.append(label);
            for (const entry of group.rows) results.append(button(entry.title, () => void guarded(() => lookup({ op: 'read', node_id: entry.node_id }))));
        }
    }
    next = value.next_cursor ? { ...body, cursor: value.next_cursor } : undefined;
    element<HTMLButtonElement>('lore-next').hidden = !next;
    status.textContent = 'Reference reading. A possible history here does not establish that it occurred in your campaign.';
}
element('lore-search-form').addEventListener('submit', event => {
    event.preventDefault(); void guarded(() => lookup({ op: 'search', query: element<HTMLInputElement>('lore-query').value }));
});
element('lore-next').addEventListener('click', () => { if (next) void guarded(() => lookup(next)); });
async function prepare(actor?: string): Promise<void> {
    const value = await request({ op: 'template', actor }); draft = value.template;
    const select = element<HTMLSelectElement>('lore-actor'); select.replaceChildren();
    for (const person of value.actors) { const option = document.createElement('option'); option.value = String(person.id); option.textContent = person.name; select.append(option); }
    select.value = draft.lore_knowledge.actor_id;
    element<HTMLInputElement>('lore-start').value = draft.start_date;
    element('lore-encounter').textContent = `Current game date: ${draft.as_of}. Knowledge is scoped to this character and timeline.`;
    renderKnowledge();
}
element('lore-current').addEventListener('click', () => void guarded(() => prepare()));
element('lore-actor').addEventListener('change', () => void guarded(() => prepare(element<HTMLSelectElement>('lore-actor').value)));
element('lore-save').addEventListener('click', () => void guarded(async () => {
    if (!draft) throw new Error('Choose the current encounter first.');
    draft.start_date = element<HTMLInputElement>('lore-start').value.trim();
    await request({ op: 'save-report', report: draft }); await refresh();
}));
element('lore-import').addEventListener('click', () => void guarded(async () => { await request({ op: 'import-report' }); await refresh(); }));
element('lore-index').addEventListener('click', () => void guarded(async () => { await request({ op: 'build-index' }); await refresh(); }));
element('lore-pause-index').addEventListener('click', () => void guarded(async () => { await request({ op: 'pause-index' }); await refresh(); }));
void guarded(refresh);
const timer = window.setInterval(() => void guarded(refresh), 10000);
window.addEventListener('beforeunload', () => window.clearInterval(timer));
