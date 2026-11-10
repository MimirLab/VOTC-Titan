import { ipcRenderer, IpcRendererEvent } from 'electron';
import fs, { createReadStream } from 'fs';
import path from 'path';
import { Config } from '../shared/Config';

//@ts-ignore
let enableActions: HTMLElement = document.querySelector("#enable-actions").checkbox;
let actions: HTMLElement = document.querySelector("#actions")!;
//@ts-ignore
let useConnectionAPI: HTMLElement = document.querySelector("#use-connection-api")!.checkbox;
let apiSelector: HTMLElement = document.querySelector("#api-selector")!;

let actionsDiv: HTMLDivElement = document.querySelector("#actions-group")!;
let actionDescriptorDiv: HTMLDivElement = document.querySelector("#action-descriptor")!;

let refreshactionsButton: HTMLButtonElement = document.querySelector("#refresh-actions")!;

let config: Config;
let disabledActions:string[];
let actionsPath: string;

document.getElementById("container")!.style.display = "block";
init();

// 应用主题函数
function applyTheme(theme: string) {
    const body = document.querySelector('body');
    if (body) {
        body.classList.remove('theme-original', 'theme-chinese', 'theme-west');
        body.classList.add(`theme-${theme}`);
    }
}

// 监听主题更新


const languageUpdateHandler = async (event: IpcRendererEvent, lang: string) => {
    // @ts-ignore
    if (window.LocalizationManager) {
        // @ts-ignore
        await window.LocalizationManager.loadTranslations(lang);
        // @ts-ignore
        window.LocalizationManager.applyTranslations();
    }
    if (config) {
        config.language = lang as Config['language'];
        loadactions();
    }
};

ipcRenderer.on('update-language', languageUpdateHandler);

window.addEventListener('beforeunload', () => {
    ipcRenderer.removeListener('update-language', languageUpdateHandler);
}, { once: true });

async function init(){
    // 应用初始主题
    const savedTheme = 'titan';
    applyTheme(savedTheme);

    config = await ipcRenderer.invoke('get-config');

    // 初始化语言
    // @ts-ignore
    if (window.LocalizationManager) {
        // @ts-ignore
        await window.LocalizationManager.loadTranslations(config.language || 'en');
        // @ts-ignore
        window.LocalizationManager.applyTranslations();
    }


     disabledActions= config!.disabledActions;

    // Wait for votcDataPath to be resolved before loading actions
    const votcDataPath = await ipcRenderer.invoke('get-userdata-path');
    actionsPath = path.join(votcDataPath, 'scripts', 'actions');
    loadactions();

    refreshactionsButton.addEventListener('click', ()=>{
        loadactions();
    })


        //init
    toggleApiSelector();
    toggleActions();

    enableActions.addEventListener('change', () =>{

        toggleActions();
    })

    useConnectionAPI.addEventListener('change', () =>{

        toggleApiSelector();
    })

}




function toggleApiSelector(){
    //@ts-ignore
    if(useConnectionAPI.checked){
        apiSelector.style.opacity = "0.5";
        apiSelector.style.pointerEvents = "none";
    }
    else{
        apiSelector.style.opacity = "1";
        apiSelector.style.pointerEvents = "auto";
    }
}

function toggleActions(){
    //@ts-ignore
    if(!enableActions.checked){
        actions.style.opacity = "0.5";
        actions.style.pointerEvents = "none";
    }
    else{
        actions.style.opacity = "1";
        actions.style.pointerEvents = "auto";
    }
}


//interaction selects







async function loadactions(){

    actionsDiv.replaceChildren();

    await sleep(250)
    let standardFileNames = fs.readdirSync(path.join(actionsPath, 'standard')).filter(file => path.extname(file) === '.js');
    let customFileNames = fs.readdirSync(path.join(actionsPath, 'custom')).filter(file => path.extname(file) === '.js');

    for(const fileName of standardFileNames){
        let file  = require(path.join(actionsPath, 'standard', fileName));

        let element = document.createElement("div");

        let isChecked = !disabledActions.includes(file.signature);

        let title = file.signature;
        if (file.titleKey) {
            title = (window as any).LocalizationManager?.getNestedTranslation(file.titleKey) || file.signature;
        } else if (file.title) {
            if (typeof file.title === 'object') {
                title = file.title[config.language] || file.title['en'] || file.signature;
            } else {
                title = file.title;
            }
        }

        element.innerHTML = `
        <input type="checkbox" id="${file.signature}" ${isChecked? "checked" : ""}>
        <label>${title}</label>
        `

        actionsDiv.appendChild(element);

        element.addEventListener("change", (e: any)=>{
            //@ts-ignore
            if(element.querySelector(`#${file.signature}`)!.checked == false){
                console.log("dsa")
                if(!disabledActions.includes(file.signature)){
                    disabledActions.push(file.signature);
                }
            }
            else{
                //@ts-ignore
                disabledActions = disabledActions.filter(e => e !== file.signature);
            }
            console.log(disabledActions)
            ipcRenderer.send('config-change', "disabledActions", disabledActions);
        });

        let creatorString = "";

        element.addEventListener("mouseenter", (e: any)=>{
            let description = file.description;
            if (typeof description === 'object') {
                description = description[config.language] || description['en'] || Object.values(description)[0];
            }

            let title = file.signature;
            if (file.titleKey) {
                title = (window as any).LocalizationManager?.getNestedTranslation(file.titleKey) || file.signature;
            } else if (file.title) {
                if (typeof file.title === 'object') {
                    title = file.title[config.language] || file.title['en'] || file.signature;
                } else {
                    title = file.title;
                }
            }

            const descLabel = (window as any).LocalizationManager?.getNestedTranslation('actions.description') || "Description:";
            const madeByLabel = (window as any).LocalizationManager?.getNestedTranslation('actions.made_by') || "Made by:";

            if(file.creator){
                creatorString = `<li class="action-item"><b>${madeByLabel}</b> ${file.creator}</li>`;
            }

            actionDescriptorDiv.innerHTML = `
            <div id="action-descriptor-content">
                <h3>${title}</h3>
                <ul>
                    <li class="action-item"><b>${descLabel}</b> ${description}</li>
                    ${creatorString}
                </ul>
            </div>
            <div class="action-file-opener">
                <button id="open-action-file-btn"></button>
            </div>
            `;

            const openFileBtn = document.getElementById('open-action-file-btn') as HTMLButtonElement;
            if (openFileBtn) {
                openFileBtn.textContent = (window as any).LocalizationManager?.getNestedTranslation('actions.open_file') || "Open File";
                openFileBtn.addEventListener('click', () => {
                    ipcRenderer.send('open-action-file', path.join(actionsPath, 'standard', fileName));
                });
            }
        });
    }

    for(const fileName of customFileNames){
        let file  = require(path.join(actionsPath, 'custom', fileName));

        let element = document.createElement("div");

        let isChecked = !disabledActions.includes(file.signature);

        let title = file.signature;
        if (file.titleKey) {
            title = (window as any).LocalizationManager?.getNestedTranslation(file.titleKey) || file.signature;
        } else if (file.title) {
            if (typeof file.title === 'object') {
                title = file.title[config.language] || file.title['en'] || file.signature;
            } else {
                title = file.title;
            }
        }

        element.innerHTML = `
        <input type="checkbox" id="${file.signature}" ${isChecked? "checked" : ""}>
        <label>${title}</label>
        `

        actionsDiv.appendChild(element);

        element.addEventListener("change", (e: any)=>{
            //@ts-ignore
            if(element.querySelector(`#${file.signature}`)!.checked == false){
                console.log("dsa")
                if(!disabledActions.includes(file.signature)){
                    disabledActions.push(file.signature);
                }
            }
            else{
                //@ts-ignore
                disabledActions = disabledActions.filter(e => e !== file.signature);
            }
            console.log(disabledActions)
            ipcRenderer.send('config-change', "disabledActions", disabledActions);
        });

        let creatorString = "";

        element.addEventListener("mouseenter", (e: any)=>{
            let description = file.description;
            if (typeof description === 'object') {
                description = description[config.language] || description['en'] || Object.values(description)[0];
            }

            let title = file.signature;
            if (file.titleKey) {
                title = (window as any).LocalizationManager?.getNestedTranslation(file.titleKey) || file.signature;
            } else if (file.title) {
                if (typeof file.title === 'object') {
                    title = file.title[config.language] || file.title['en'] || file.signature;
                } else {
                    title = file.title;
                }
            }

            const descLabel = (window as any).LocalizationManager?.getNestedTranslation('actions.description') || "Description:";
            const madeByLabel = (window as any).LocalizationManager?.getNestedTranslation('actions.made_by') || "Made by:";

            if(file.creator){
                creatorString = `<li class="action-item"><b>${madeByLabel}</b> ${file.creator}</li>`;
            }

            actionDescriptorDiv.innerHTML = `
            <div id="action-descriptor-content">
                <h3>${title}</h3>
                <ul>
                    <li class="action-item"><b>${descLabel}</b> ${description}</li>
                    ${creatorString}
                </ul>
            </div>
            <div class="action-file-opener">
                <button id="open-action-file-btn"></button>
            </div>
            `;

            const openFileBtn = document.getElementById('open-action-file-btn') as HTMLButtonElement;
            if (openFileBtn) {
                openFileBtn.textContent = (window as any).LocalizationManager?.getNestedTranslation('actions.open_file') || "Open File";
                openFileBtn.addEventListener('click', () => {
                    ipcRenderer.send('open-action-file', path.join(actionsPath, 'custom', fileName));
                });
            }
        });
    }
}



function sleep(ms: number) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
