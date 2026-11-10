import { ipcRenderer } from 'electron';
import { GameData } from '../shared/gameData/GameData';
import { resolveScene } from '../shared/scenes/sceneContext';
import { decodeDxt1 } from '../shared/scenes/dds';

let revision = 0;
export async function updateLauncherSceneArt(game?: GameData): Promise<void> {
    const current = ++revision;
    let panel = document.querySelector<HTMLDetailsElement>('.launcher-scene-art');
    if (!panel) {
        panel = document.createElement('details');
        panel.className = 'launcher-scene-art';
        panel.open = true;
        const summary = document.createElement('summary');
        const canvas = document.createElement('canvas');
        canvas.setAttribute('role', 'img');
        panel.append(summary, canvas);
        document.querySelector('.chat-header')?.after(panel);
    }
    panel.hidden = true;
    const snapshot = game?.sceneSnapshot;
    const scene = resolveScene(snapshot);
    if (!scene || snapshot?.presentation !== 'launcher') return;
    try {
        const raw = await ipcRenderer.invoke('get-launcher-scene-art', scene.sceneId);
        if (!raw || current !== revision) return;
        const { width, height, pixels } = decodeDxt1(new Uint8Array(raw));
        const canvas = panel.querySelector('canvas')!;
        canvas.width = width; canvas.height = height;
        canvas.setAttribute('aria-label', scene.label);
        const context = canvas.getContext('2d');
        if (!context) return;
        const image = context.createImageData(width, height);
        image.data.set(pixels);
        context.putImageData(image, 0, 0);
        panel.querySelector('summary')!.textContent = scene.label;
        panel.hidden = false;
    } catch { /* A missing painting never interrupts the RP controls or prose. */ }
}
