import { ipcRenderer, IpcRendererEvent} from 'electron';
import os from 'os';
import fs from 'fs';
import path from 'path';

let appVersionSpan: HTMLElement = document.querySelector("#app-version")!;
let clearSummariesButton: HTMLElement = document.querySelector("#clear-summaries")!;
let runPathButton: HTMLSelectElement = document.querySelector("#run-path-button")!;
let runPathInput: HTMLSelectElement = document.querySelector("#run-path-input")!;
let openRoamingDataButton: HTMLElement = document.querySelector("#open-roaming-data-button")!;


document.getElementById("container")!.style.display = "block";

const version = require('../../package.json').version;
appVersionSpan.innerText = "Current app version: " + version;

clearSummariesButton.addEventListener('click', ()=>{
    ipcRenderer.send('clear-summaries');
})

openRoamingDataButton.addEventListener('click', () => {
    ipcRenderer.send('open-roaming-data-folder');
});

// 页面加载时恢复之前的主题和语言选择
document.addEventListener('DOMContentLoaded', async () => {

    const config = await ipcRenderer.invoke('get-config');
    const culturePath = document.querySelector<HTMLInputElement>('#culture-game-path')!;
    const cultureStatus = document.querySelector<HTMLElement>('#culture-status')!;
    const culturePrepare = document.querySelector<HTMLButtonElement>('#culture-prepare')!;
    culturePath.value = config.cultureGameInstallPath || '';
    culturePath.addEventListener('change', () => ipcRenderer.send('config-change', 'cultureGameInstallPath', culturePath.value));
    document.querySelector('#culture-game-folder')!.addEventListener('click', async () => {
        const selected = await ipcRenderer.invoke('select-culture-game-folder');
        if (selected) {
            culturePath.value = selected;
            ipcRenderer.send('config-change', 'cultureGameInstallPath', selected);
        }
    });
    culturePrepare.addEventListener('click', async () => {
        culturePrepare.disabled = true;
        cultureStatus.textContent = 'Preparing cultural and religious backgrounds for the active game and mods…';
        try {
            const result = await ipcRenderer.invoke('prepare-culture-background');
            cultureStatus.textContent = result.message;
            document.querySelector('#faith-status')!.textContent = await ipcRenderer.invoke('faith-background-status');
            document.querySelector('#goa-status')!.textContent = await ipcRenderer.invoke('goa-lore-status');
        } catch { cultureStatus.textContent = 'Could not prepare cultural background.'; }
        finally { culturePrepare.disabled = false; }
    });
    const clearButtons = ['culture', 'faith'].map(domain => ({ domain,
        button: document.querySelector<HTMLButtonElement>(`#clear-${domain}-library`)! }));
    const clearStatus = document.querySelector<HTMLElement>('#background-clear-status')!;
    for (const { domain, button } of clearButtons) button.addEventListener('click', async () => {
        for (const control of clearButtons) control.button.disabled = true;
        clearStatus.textContent = '';
        try {
            const result = await ipcRenderer.invoke('clear-background-library', domain);
            clearStatus.textContent = result.message;
            cultureStatus.textContent = await ipcRenderer.invoke('culture-background-status');
            document.querySelector('#faith-status')!.textContent = await ipcRenderer.invoke('faith-background-status');
        } catch { clearStatus.textContent = 'Could not clear the background library. Please try again.'; }
        finally { for (const control of clearButtons) control.button.disabled = false; }
    });
    cultureStatus.textContent = await ipcRenderer.invoke('culture-background-status');
    document.querySelector('#faith-status')!.textContent = await ipcRenderer.invoke('faith-background-status');
    document.querySelector('#goa-status')!.textContent = await ipcRenderer.invoke('goa-lore-status');

    let userFolderPath = config!.userFolderPath;

    if(userFolderPath){
        runPathInput.value = userFolderPath;
    }
    else{
        let defaultPath = path.join(os.homedir(), 'Documents', 'Paradox Interactive', 'Crusader Kings III');

        if (fs.existsSync(defaultPath)) {
            runPathInput.value = defaultPath;
            config!.userFolderPath = defaultPath;
            ipcRenderer.send('config-change', "userFolderPath", runPathInput.value);
        }

    }

    runPathInput.addEventListener("change", (e: any) => {
        ipcRenderer.send('config-change', "userFolderPath", runPathInput.value);
    });

    runPathButton.addEventListener("click", async ()=>{
        ipcRenderer.send('select-user-folder');
    })

    const userFolderSuccessHandler = (event: IpcRendererEvent, path: string) => {
        if(!path || path == "") return;

        runPathInput.value = path;
        ipcRenderer.send('config-change', "userFolderPath", runPathInput.value);
    };
    ipcRenderer.on('select-user-folder-success', userFolderSuccessHandler);

    window.addEventListener('beforeunload', () => {
        ipcRenderer.removeListener('select-user-folder-success', userFolderSuccessHandler);
    }, { once: true });

    const lang = config.language || 'en';

    // @ts-ignore
    if (window.LocalizationManager) {
        // @ts-ignore
        await window.LocalizationManager.loadTranslations(lang);
        // @ts-ignore
        window.LocalizationManager.applyTranslations();

        // Update version text with translation
        // @ts-ignore
        const translatedPrefix = window.LocalizationManager.getNestedTranslation('system.current_version');
        if (translatedPrefix) {
            appVersionSpan.innerText = translatedPrefix + version;
        }
    }
});
