import { ipcRenderer } from 'electron';
import { GameData } from '../shared/gameData/GameData';
import { eligibleScenes } from '../shared/scenes/sceneContext';
import { paintSceneArt } from './launcherSceneArt';

const openButton = document.querySelector<HTMLButtonElement>('.scene-gallery-open')!;
const dialog = document.querySelector<HTMLDialogElement>('.scene-gallery')!;
const closeButton = dialog.querySelector<HTMLButtonElement>('.scene-gallery-close')!;
const location = dialog.querySelector<HTMLElement>('.scene-gallery-location')!;
const status = dialog.querySelector<HTMLElement>('.scene-gallery-status')!;
const grid = dialog.querySelector<HTMLElement>('.scene-gallery-grid')!;
let game: GameData | undefined;
let selecting = false;
let rendered = '';

const previews = new IntersectionObserver(entries => {
    for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const canvas = entry.target as HTMLCanvasElement;
        previews.unobserve(canvas);
        void ipcRenderer.invoke('get-launcher-scene-preview', canvas.dataset.sceneId)
            .then(raw => {
                if (raw && canvas.isConnected && dialog.open) paintSceneArt(canvas, raw, 400);
            }).catch(() => { /* The venue remains selectable if its painting is unavailable. */ });
    }
}, { root: grid });

function setSelecting(value: boolean): void {
    selecting = value;
    closeButton.disabled = value;
    grid.querySelectorAll<HTMLButtonElement>('button').forEach(button => {
        button.disabled = value || button.hasAttribute('aria-current');
    });
}

async function choose(venue: string): Promise<void> {
    const encounter = game;
    setSelecting(true);
    status.textContent = 'Checking this venue in CK3…';
    try {
        await ipcRenderer.invoke('select-launcher-venue', venue);
        if (encounter === game) dialog.close();
    } catch {
        if (encounter === game) status.textContent = 'CK3 could not confirm this venue. Try again or choose another scene.';
    } finally {
        if (encounter === game) setSelecting(false);
    }
}

function render(): void {
    const census = game?.launcherSceneObservation ?? game?.sceneSnapshot;
    const venues = census?.presentation ? eligibleScenes(census).filter(venue => venue.source === 'generated') : [];
    const state = JSON.stringify([census?.location ?? game?.location, game?.scene, venues.map(venue => venue.id)]);
    if (state === rendered) return;
    rendered = state;
    location.textContent = census?.location || game?.location || '';
    if (!selecting) status.textContent = venues.length ? '' :
        census ? 'No Titan venues are available here.' : 'CK3 hasn’t confirmed a location for this encounter.';
    previews.disconnect();
    grid.replaceChildren();
    for (const venue of venues) {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'scene-gallery-card';
        if (venue.id === game?.scene) card.setAttribute('aria-current', 'true');
        const canvas = document.createElement('canvas');
        canvas.setAttribute('aria-hidden', 'true');
        canvas.dataset.sceneId = venue.id;
        card.append(canvas);
        previews.observe(canvas);
        const label = document.createElement('span');
        label.textContent = venue.label;
        card.append(label);
        card.addEventListener('click', () => void choose(venue.id));
        grid.append(card);
    }
    setSelecting(selecting);
}

openButton.addEventListener('click', () => {
    if (!game || dialog.open) return;
    dialog.showModal();
    render();
});
closeButton.addEventListener('click', () => dialog.close());
dialog.addEventListener('cancel', event => {
    if (selecting) event.preventDefault();
});
dialog.addEventListener('close', () => {
    if (dialog.open) return;
    previews.disconnect();
    grid.replaceChildren();
    rendered = '';
});

export function updateLauncherSceneGallery(current?: GameData): void {
    if (current !== game) {
        dialog.close();
        setSelecting(false);
    }
    game = current;
    openButton.hidden = !current;
    if (dialog.open) render();
}
