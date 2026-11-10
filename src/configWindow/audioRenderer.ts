import { ipcRenderer } from 'electron';
import { AudioSettings, AudioStatus, VoiceProfile } from '../shared/audio';
import { createVoiceOutput } from '../shared/voiceOutput';

const form = document.querySelector<HTMLFormElement>('#audio-settings')!;
const status = document.querySelector<HTMLElement>('#audio-status')!;
const element = (id: string) => document.querySelector<HTMLElement>(id)!;
const input = (id: string) => document.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(id)!;
const button = (id: string) => document.querySelector<HTMLButtonElement>(id)!;
const hide = (id: string, hidden: boolean) => { element(id).hidden = hidden; };
type SavedVoice = VoiceProfile & { active: boolean };
let settings: AudioSettings, loaded = false, busy = false, narratorDefault = '';
let savedVoices: SavedVoice[] = [];
let actors: { id: number; name: string; cloneBank?: string; cloneInfo?: { mode: 'auto' | 'normal'; automaticKey?: string; needsForm?: boolean }; casting?: { anatomyId?: string; presentation?: string; cultureId?: string } }[] = [];
let draftReceipt: { id: string; instruction: string } | undefined;
let deletingNarrator: string | undefined;
const selectedNarrator = () => savedVoices.find(v => v.id === input('#audio-narrator-voice').value);
const narratorInstruction = () => input('#audio-narrator-description').value.trim();
function readSettings(): AudioSettings {
    const changed = { ...settings };
    for (const name of Object.keys(changed) as (keyof AudioSettings)[]) {
        const control = form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
        if (control) (changed as any)[name] = control instanceof HTMLInputElement && control.type === 'checkbox' ? control.checked :
            typeof changed[name] === 'number' ? Number(control.value) : control.value;
    }
    return changed;
}
const settingsDirty = () => loaded && JSON.stringify(readSettings()) !== JSON.stringify(settings);
function updateControls(): void {
    form.querySelectorAll<HTMLButtonElement>('[data-audio-action]').forEach(control => { control.disabled = busy || !loaded; });
    if (!loaded) return;
    const selected = selectedNarrator(), instruction = narratorInstruction();
    const breeze = (form.elements.namedItem('provider') as HTMLSelectElement).value === 'breeze';
    const unchanged = selected?.instruction === instruction;
    const hasDraft = draftReceipt?.instruction === instruction;
    button('#audio-save-narrator').disabled = busy || !breeze || !input('#audio-narrator-name').value.trim() ||
        !(hasDraft || unchanged && selected?.referenceFile);
    button('#audio-use-narrator').disabled = busy || !breeze || !unchanged || !selected?.referenceFile;
    button('#audio-delete-narrator').disabled = busy || !selected;
    button('#audio-rename-narrator').disabled = busy || !selected || input('#audio-narrator-name').value.trim() === selected.label || !input('#audio-narrator-name').value.trim();
    const hasActor = actors.some(a => String(a.id) === input('#audio-character').value);
    const selectedActor = actors.find(a => String(a.id) === input('#audio-character').value);
    const cloned = !!selectedActor?.cloneBank || selectedActor?.cloneInfo?.mode === 'auto' && !!selectedActor.cloneInfo.automaticKey;
    for (const id of ['audio-preview-character', 'audio-redesign', 'audio-save-casting']) button('#' + id).disabled = busy || !hasActor || id !== 'audio-preview-character' && (!breeze || cloned);
    button('#audio-bind-clone-bank').disabled = busy || !hasActor || !breeze;
    element('#audio-narrator-draft-status').textContent = hasDraft ? 'Preview ready · not saved. Save narrator to keep this voice.' :
        unchanged ? 'Saved voice. Change the test words to hear it again without creating another voice.' : 'Unsaved voice · preview it, then save it if you like it.';
    hide('#audio-settings-dirty', !settingsDirty());
    element('#audio-volume-value').textContent = Math.round(Number((form.elements.namedItem('volume') as HTMLInputElement).value) * 100) + '%';
}
const run = async (task: () => Promise<unknown>) => {
    if (busy) return;
    busy = true; updateControls();
    try { await task(); } catch (error) { status.textContent = (error as Error).message; }
    finally { busy = false; updateControls(); }
};
function connectionVisibility(): void {
    const provider = (form.elements.namedItem('provider') as HTMLSelectElement).value;
    const local = provider === 'breeze' && (form.elements.namedItem('hosting') as HTMLSelectElement).value === 'managed';
    hide('#breeze-connection', provider !== 'breeze'); hide('#side-connection', provider === 'breeze');
    hide('#audio-test', provider !== 'breeze'); hide('#audio-side-thoughts', provider !== 'elevenlabs');
    hide('#audio-managed-settings', !local); hide('#audio-endpoint-settings', local); hide('#audio-downloads', !local);
    hide('#audio-unload', !local); hide('#audio-narrator-controls', provider !== 'breeze');
    hide('#audio-save-narrator', provider !== 'breeze'); hide('#audio-side-narrator', provider === 'breeze');
    hide('#audio-clone-controls', provider !== 'breeze');
    for (const id of ['#audio-delete-narrator', '#audio-narrator-count', '#audio-active-narrator']) hide(id, provider !== 'breeze');
    updateControls();
}
function displaySettings(): void {
    for (const [name, value] of Object.entries(settings)) {
        const control = form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
        if (!control) continue;
        if (control instanceof HTMLInputElement && control.type === 'checkbox') control.checked = value === true;
        else control.value = String(value);
    }
    connectionVisibility();
}
async function saveSettings(): Promise<void> {
    if (!settingsDirty()) return;
    settings = await ipcRenderer.invoke('audio-save-settings', readSettings()); draftReceipt = undefined;
    previewOutput?.setLevel(settings.volume); displaySettings();
}
function choices(id: string, values: [string, string][]): void {
    const select = input(id) as HTMLSelectElement; select.replaceChildren();
    for (const [value, label] of values) { const option = document.createElement('option'); option.value = value; option.textContent = label; select.append(option); }
}
function narratorFields(): void {
    const voice = selectedNarrator();
    input('#audio-narrator-name').value = voice?.label ?? 'New narrator';
    input('#audio-narrator-description').value = voice?.instruction ?? narratorDefault;
    draftReceipt = undefined; deletingNarrator = undefined; hide('#audio-narrator-delete-confirm', true); updateControls();
}
function selectedCasting(): void {
    const actor = actors.find(actor => String(actor.id) === input('#audio-character').value);
    const banks = input('#audio-clone-bank') as HTMLSelectElement;
    banks.querySelector('[data-missing-bank]')?.remove();
    if (actor?.cloneBank && ![...banks.options].some(o => o.value === actor.cloneBank)) {
        const option = document.createElement('option'); option.value = actor.cloneBank; option.textContent = 'Unavailable: ' + actor.cloneBank; option.dataset.missingBank = ''; banks.append(option);
    }
    banks.value = actor?.cloneBank ?? (actor?.cloneInfo?.mode === 'normal' ? '' : '__auto__');
    element('#audio-clone-status').textContent = actor?.cloneBank ? 'Assigned reference: ' + actor.cloneBank + ' · tone and whispered thoughts enabled.' : actor?.cloneInfo?.mode === 'normal' ? 'Normal casting · automatic clones disabled for this character.' : actor?.cloneInfo?.needsForm ? 'Multiple recorded forms available. Choose the appropriate bank above; normal casting continues until you choose.' : actor?.cloneInfo?.automaticKey ? 'Automatic reference: ' + actor.cloneInfo.automaticKey + ' · tone and whispered thoughts enabled.' : 'Automatic · covered characters use a verified reference; others use normal casting.';
    const choice = actors.find(actor => String(actor.id) === input('#audio-character').value)?.casting ?? {};
    input('#audio-anatomy').value = choice.anatomyId ?? ''; input('#audio-presentation').value = choice.presentation ?? '';
    input('#audio-culture').value = choice.cultureId ?? '__observed__'; updateControls();
}
async function refresh(options: { narratorId?: string; resetNarrator?: boolean } = {}): Promise<void> {
    const keepSettings = settingsDirty(), previousNarrator = input('#audio-narrator-voice').value, previousCharacter = input('#audio-character').value;
    const info = await ipcRenderer.invoke('audio-settings'); settings = info.settings; narratorDefault = info.narratorDefault;
    if (!keepSettings) displaySettings();
    status.textContent = info.status.message;
    const gib = (bytes: number) => (bytes / 1024 ** 3).toFixed(1);
    element('#audio-hardware').textContent = `${gib(info.hardware.ramBytes)} GiB RAM · ${gib(info.hardware.availableRAMBytes)} GiB available` +
        info.hardware.gpus.map((gpu: any) => ` · ${gpu.vendor} ${gib(gpu.totalBytes)} GiB VRAM (${gib(gpu.freeBytes)} GiB free)`).join('') +
        (info.activeLocalModel ? ` · Running: ${info.models.find((model: any) => model.id === info.activeLocalModel)?.label ?? info.activeLocalModel}` : ' · Local engine unloaded');
    const models = element('#audio-models'); models.replaceChildren();
    for (const model of info.models) {
        const row = document.createElement('div'); row.className = 'audio-model';
        const description = document.createElement('div'), name = document.createElement('strong'), note = document.createElement('p');
        name.textContent = `${model.label} · ${(model.bytes / 1e9).toFixed(2)} GB${model.installed ? ' · Installed' : ''}`;
        note.textContent = model.note; note.className = 'audio-help'; description.append(name, note);
        const install = document.createElement('button'); install.type = 'button'; install.dataset.audioAction = '';
        install.textContent = model.installed ? 'Verify / resume' : 'Download';
        install.onclick = () => void run(async () => { await saveSettings(); await ipcRenderer.invoke('audio-install', model.id); await refresh(); });
        row.append(description, install); models.append(row);
    }
    actors = info.characters;
    choices('#audio-clone-bank', [['__auto__', 'Automatic — GoA2 character voices'], ['', 'Normal casting'], ...(info.cloneBanks ?? []).map((bank: any) => [bank.key, `${bank.name} · ${bank.key}`] as [string, string])]);
    choices('#audio-character', actors.map(actor => [String(actor.id), actor.name]));
    const actor = actors.find(a => String(a.id) === previousCharacter)?.id ?? info.defaultCharacterId ?? actors[0]?.id;
    if (actor !== undefined) input('#audio-character').value = String(actor);
    hide('#audio-no-characters', actors.length > 0);
    const casting = info.castingCatalogue;
    choices('#audio-anatomy', [['', 'Observed race / current form'], ...Object.entries(casting.anatomy).map(([id, value]: [string, any]) => [id, value.label] as [string, string])]);
    choices('#audio-culture', [['__observed__', 'Observed current culture'], ['', 'No added culture accent'], ...Object.keys(casting.cultures).sort().map(id => [id, id.replace(/_/g, ' ')] as [string, string])]);
    const faith = input('#audio-faith-preview').value;
    choices('#audio-faith-preview', [['', 'No faith performance'], ...Object.keys(casting.faithDelivery).sort().map(id => [id, id.replace(/_/g, ' ')] as [string, string])]);
    if ([...(input('#audio-faith-preview') as HTMLSelectElement).options].some(o => o.value === faith)) input('#audio-faith-preview').value = faith;
    savedVoices = info.voices;
    const narrators = savedVoices.filter(v => v.characterId === '__narrator__'), active = narrators.find(v => v.active);
    choices('#audio-narrator-voice', [['__new__', 'Unsaved new narrator'], ...narrators.map(v => [v.id, `${v.label}${v.active ? ' · In use' : ''}`] as [string, string])]);
    const chosen = options.narratorId ?? (loaded && (previousNarrator === '__new__' || narrators.some(v => v.id === previousNarrator)) ? previousNarrator : active?.id ?? '__new__');
    input('#audio-narrator-voice').value = chosen;
    element('#audio-narrator-count').textContent = `${narrators.length} saved`;
    element('#audio-active-narrator').textContent = active ? `In use: ${active.label}` : 'No narrator selected. Preview a voice, then save it to use it.';
    if (!loaded || options.resetNarrator || previousNarrator !== chosen) narratorFields();
    if (!input('#audio-preview-text').value) input('#audio-preview-text').value = info.previewDefault;
    loaded = true; selectedCasting(); renderLibrary(); connectionVisibility(); updateControls();
}
function renderLibrary(): void {
    const library = element('#audio-voices'); library.replaceChildren();
    const search = input('#audio-voice-search').value.trim().toLocaleLowerCase();
    const voices = savedVoices.filter(v => v.characterId !== '__narrator__' && (!search || v.label.toLocaleLowerCase().includes(search)));
    if (!voices.length) { const empty = document.createElement('p'); empty.className = 'audio-empty'; empty.textContent = search ? 'No voices match that name.' : 'Character voices will appear here after their first playback.'; library.append(empty); }
    for (const voice of voices) {
        const row = document.createElement('article'); row.className = 'audio-voice'; row.dataset.voiceId = voice.id;
        const title = document.createElement('strong'); title.textContent = `${voice.label} · revision ${voice.revision}${voice.active ? ' · In use' : ''}`;
        const label = document.createElement('input'); label.value = voice.label; label.maxLength = 100; label.setAttribute('aria-label', 'Saved voice name');
        const actions = document.createElement('div'); actions.className = 'audio-actions';
        const action = (text: string, task: () => Promise<unknown>) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.dataset.audioAction = ''; b.onclick = () => void run(task); return b; };
        const rename = action('Rename', async () => { await ipcRenderer.invoke('audio-rename-voice', voice.id, label.value); await refresh(); });
        const preview = action('Preview saved voice', async () => { await saveSettings(); await playPreview(voice.id); });
        const select = action('Use saved revision', async () => { await ipcRenderer.invoke('audio-select-voice', voice.id); await refresh(); });
        const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Delete'; remove.className = 'audio-danger';
        const confirm = document.createElement('div'); confirm.hidden = true; confirm.className = 'audio-confirm';
        const yes = action('Delete voice and recording', async () => { await ipcRenderer.invoke('audio-delete-voice', voice.id); await refresh(); });
        const no = document.createElement('button'); no.type = 'button'; no.textContent = 'Cancel'; no.onclick = () => { confirm.hidden = true; remove.focus(); };
        confirm.append('Delete this revision and its recording? Older replies using it will lose voice replay. ', yes, no);
        remove.onclick = () => { confirm.hidden = false; no.focus(); };
        const edit = document.createElement('details'); edit.className = 'audio-details'; const summary = document.createElement('summary'); summary.textContent = 'Edit voice description';
        const text = document.createElement('textarea'); text.value = voice.instruction; text.rows = 4; text.maxLength = 2400; text.setAttribute('aria-label', `${voice.label} voice description`);
        const save = action('Save as new revision', async () => { if (text.value.trim() !== voice.instruction) { await ipcRenderer.invoke('audio-save-voice', voice.id, text.value); await refresh(); } });
        const help = document.createElement('p'); help.className = 'audio-help'; help.textContent = 'Saving creates a new revision. Preview saved voice always plays the existing recording.';
        edit.append(summary, help, text, save); actions.append(preview, select, remove); row.append(title, actions, label, rename, confirm);
        let cloned = false; try { cloned = JSON.parse(voice.provenance).origin === 'clone-bank-v1'; } catch { /* Ordinary voice. */ }
        if (cloned) { select.hidden = true; const note = document.createElement('p'); note.className = 'audio-help'; note.textContent = 'Reference clone · assign using the Clone bank selector above.'; row.append(note); }
        else row.append(edit);
        library.append(row);
    }
    updateControls();
}
let previewURL: string | undefined, previewContext: AudioContext | undefined;
let previewOutput: ReturnType<typeof createVoiceOutput> | undefined;
async function playBytes(bytes: Uint8Array): Promise<void> {
    if (previewURL) URL.revokeObjectURL(previewURL);
    const player = document.querySelector<HTMLAudioElement>('#audio-preview-player')!; player.pause();
    previewURL = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'audio/wav' }));
    if (!previewContext) { previewContext = new AudioContext(); previewOutput = createVoiceOutput(previewContext); previewContext.createMediaElementSource(player).connect(previewOutput.input); }
    previewOutput!.setLevel(settings.volume); await previewContext.resume(); player.src = previewURL; await player.play();
}
const faith = () => settings.provider === 'breeze' ? input('#audio-faith-preview').value || undefined : undefined;
async function playPreview(id?: string, characterId?: number): Promise<void> {
    document.querySelector<HTMLAudioElement>('#audio-preview-player')!.pause();
    status.textContent = 'Preparing voice preview…';
    const bytes = characterId === undefined ? await ipcRenderer.invoke('audio-preview', id, faith(), input('#audio-preview-text').value) :
        await ipcRenderer.invoke('audio-preview-character', characterId, input('#audio-preview-text').value, faith());
    await playBytes(bytes);
}
window.addEventListener('beforeunload', () => { if (previewURL) URL.revokeObjectURL(previewURL); });
form.onsubmit = event => { event.preventDefault(); void run(async () => { await saveSettings(); status.textContent = 'Audio settings saved.'; }); };
form.addEventListener('input', updateControls);
form.addEventListener('change', connectionVisibility);
element('#audio-narrator-voice').addEventListener('change', narratorFields);
element('#audio-preview-narrator').addEventListener('click', () => void run(async () => {
    document.querySelector<HTMLAudioElement>('#audio-preview-player')!.pause();
    await saveSettings(); const selected = selectedNarrator(), instruction = narratorInstruction();
    if (settings.provider !== 'breeze' || selected?.instruction === instruction) { draftReceipt = undefined; await playPreview(selected?.id); }
    else {
        const result = await ipcRenderer.invoke('audio-preview-narrator-draft', instruction, input('#audio-preview-text').value, faith());
        draftReceipt = { id: result.draftId, instruction }; await playBytes(result.bytes);
    }
    await refresh();
}));
element('#audio-save-narrator').addEventListener('click', () => void run(async () => {
    const selected = selectedNarrator(), label = input('#audio-narrator-name').value;
    let id: string;
    if (draftReceipt?.instruction === narratorInstruction()) {
        const saved = await ipcRenderer.invoke('audio-save-narrator-draft', draftReceipt.id, label); id = saved.id;
    } else if (selected?.instruction === narratorInstruction()) {
        await ipcRenderer.invoke('audio-rename-voice', selected.id, label); await ipcRenderer.invoke('audio-select-voice', selected.id); id = selected.id;
    } else throw new Error('Preview this narrator before saving it.');
    draftReceipt = undefined; await refresh({ narratorId: id, resetNarrator: true }); status.textContent = 'Narrator saved and selected.';
}));
element('#audio-new-narrator').addEventListener('click', () => void run(async () => {
    await ipcRenderer.invoke('audio-discard-narrator-draft'); input('#audio-narrator-voice').value = '__new__'; narratorFields(); input('#audio-narrator-name').focus();
}));
element('#audio-use-narrator').addEventListener('click', () => void run(async () => { await ipcRenderer.invoke('audio-select-voice', input('#audio-narrator-voice').value); await refresh(); }));
element('#audio-rename-narrator').addEventListener('click', () => void run(async () => {
    const id = input('#audio-narrator-voice').value; await ipcRenderer.invoke('audio-rename-voice', id, input('#audio-narrator-name').value); await refresh({ narratorId: id, resetNarrator: true });
}));
element('#audio-delete-narrator').addEventListener('click', () => {
    const selected = selectedNarrator(); if (!selected) return;
    deletingNarrator = selected.id; element('#audio-narrator-delete-message').textContent = `Delete “${selected.label}” and its recording? Older replies using this revision will lose voice replay.`;
    hide('#audio-narrator-delete-confirm', false); button('#audio-cancel-delete-narrator').focus();
});
element('#audio-cancel-delete-narrator').addEventListener('click', () => { deletingNarrator = undefined; hide('#audio-narrator-delete-confirm', true); button('#audio-delete-narrator').focus(); });
element('#audio-confirm-delete-narrator').addEventListener('click', () => void run(async () => {
    if (!deletingNarrator) return; await ipcRenderer.invoke('audio-delete-voice', deletingNarrator);
    deletingNarrator = undefined; hide('#audio-narrator-delete-confirm', true); draftReceipt = undefined; await refresh({ resetNarrator: true });
}));
element('#audio-character').addEventListener('change', selectedCasting);
element('#audio-import-clone-bank').addEventListener('click', () => void run(async () => {
    const bank = await ipcRenderer.invoke('audio-import-clone-bank'); await refresh();
    if (bank) { input('#audio-clone-bank').value = bank.key; status.textContent = bank.name + ' imported. Apply to character to enable it.'; }
}));
element('#audio-bind-clone-bank').addEventListener('click', () => void run(async () => {
    await saveSettings(); await ipcRenderer.invoke('audio-bind-clone-bank', Number(input('#audio-character').value), input('#audio-clone-bank').value || undefined); await refresh();
}));
element('#audio-voice-search').addEventListener('input', renderLibrary);
element('#audio-refresh').addEventListener('click', () => void run(refresh));
element('#audio-preview-character').addEventListener('click', () => void run(async () => { await saveSettings(); await playPreview(undefined, Number(input('#audio-character').value)); await refresh(); }));
element('#audio-redesign').addEventListener('click', () => void run(async () => { await saveSettings(); await ipcRenderer.invoke('audio-redesign', Number(input('#audio-character').value)); await refresh(); }));
function castingInput(): { anatomyId?: string; presentation?: string; cultureId?: string } {
    const anatomyId = input('#audio-anatomy').value, presentation = input('#audio-presentation').value, cultureId = input('#audio-culture').value;
    return { ...(anatomyId ? { anatomyId } : {}), ...(presentation ? { presentation } : {}), ...(cultureId !== '__observed__' ? { cultureId } : {}) };
}
element('#audio-save-casting').addEventListener('click', () => void run(async () => { await saveSettings(); await ipcRenderer.invoke('audio-save-casting', Number(input('#audio-character').value), castingInput()); await refresh(); }));
element('#audio-test').addEventListener('click', () => void run(async () => { await saveSettings(); status.textContent = 'Checking Breeze…'; await ipcRenderer.invoke('audio-test'); }));
for (const command of ['unload', 'cancel-download', 'stop']) element('#audio-' + command).addEventListener('click', () => {
    if (command === 'stop') document.querySelector<HTMLAudioElement>('#audio-preview-player')!.pause();
    ipcRenderer.send('audio-control', command);
});
const tabs = [...document.querySelectorAll<HTMLButtonElement>('.audio-tabs [role="tab"]')];
function activateTab(tab: HTMLButtonElement): void {
    for (const item of tabs) { const active = tab === item; item.setAttribute('aria-selected', String(active)); item.tabIndex = active ? 0 : -1; element('#' + item.getAttribute('aria-controls')).hidden = !active; }
}
for (const [index, tab] of tabs.entries()) {
    tab.onclick = () => activateTab(tab);
    tab.onkeydown = event => {
        const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : undefined;
        if (next !== undefined) { event.preventDefault(); tabs[next].focus(); activateTab(tabs[next]); }
    };
}
ipcRenderer.on('audio-status', (_event, value: AudioStatus) => { status.textContent = value.message; });
void run(refresh);
