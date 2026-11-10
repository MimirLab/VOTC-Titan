import {ipcRenderer } from 'electron';
import { isPromptKey } from '../../shared/promptKeys';
const template = document.createElement("template");

function defineTemplate(rows: number, cols: number, placeholder: string){
    return `
    <link rel="stylesheet" href="../../public/configWindow/config.css">
    <style>
    </style>
    <textarea id="prompt" rows="${rows}" cols="${cols}" placeholder="${placeholder}">
        
    </textarea>
    
    `

    
}


    

class ConfigTextarea extends HTMLElement{
    confID: string;
    shadow: any;
    textarea: HTMLTextAreaElement;
    rows: number;
    cols: number;
    placeholder: string;
    private languageUpdateHandler: (() => void) | null = null;

    constructor(){
        super();
        this.confID = this.getAttribute("confID") || "";
        this.rows = parseInt(this.getAttribute("rows") || "4");
        this.cols = parseInt(this.getAttribute("cols") || "20");
        this.placeholder = this.getAttribute("placeholder") || "";

        this.shadow = this.attachShadow({mode: "open"});
        template.innerHTML = defineTemplate(this.rows, this.cols, this.placeholder);
        this.shadow.append(template.content.cloneNode(true));
        this.textarea = this.shadow.querySelector('#prompt');

        

    }


    static get observedAttributes(){
        return ["confID", "rows", "cols", "placeholder", "data-i18n"]
    }

    async connectedCallback(){
        const confID: string = this.confID;
        // The preset editor owns prompt loading, language changes and saving.
        // Reading config.prompts here races that editor and uses an obsolete schema.
        if (!isPromptKey(confID)) {
            const config = await ipcRenderer.invoke('get-config');
            this.textarea.value = config[confID] ?? '';
            this.textarea.addEventListener("change", () => {
                ipcRenderer.send('config-change', confID, this.textarea.value);
            });
        }

        this.languageUpdateHandler = async () => {
            if (!isPromptKey(confID)) {
                const config = await ipcRenderer.invoke('get-config');
                this.textarea.value = config[confID] ?? '';
            }
            const i18nKey = this.getAttribute('data-i18n');
            if (i18nKey) {
                this.updateTranslation(i18nKey);
            }
        };

        // Listen for language changes
        ipcRenderer.on('update-language', this.languageUpdateHandler);

        // Handle localization
        const i18nKey = this.getAttribute('data-i18n');
        if (i18nKey) {
            this.updateTranslation(i18nKey);
        }
    }

    public updateTranslation(key: string) {
        // @ts-ignore
        if (window.LocalizationManager) {
            // @ts-ignore
            const translation = window.LocalizationManager.getNestedTranslation(key);
            if (translation) {
                this.textarea.placeholder = translation;
            } else if (this.placeholder) {
                this.textarea.placeholder = this.placeholder;
            }
        } else if (this.placeholder) {
            this.textarea.placeholder = this.placeholder;
        }
    }

    disconnectedCallback() {
        if (this.languageUpdateHandler) {
            ipcRenderer.removeListener('update-language', this.languageUpdateHandler);
        }
    }
}




customElements.define("config-textarea", ConfigTextarea);
