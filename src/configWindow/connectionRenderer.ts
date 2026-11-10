import { ipcRenderer, IpcRendererEvent} from 'electron';

let config;

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
};
ipcRenderer.on('update-language', languageUpdateHandler);

window.addEventListener('beforeunload', () => {
    ipcRenderer.removeListener('update-language', languageUpdateHandler);
}, { once: true });

async function init(){

    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('source') === 'chat') {
        const closeMenu = document.querySelector('.close-menu');
        if (closeMenu) (closeMenu as HTMLElement).style.display = 'block';

        const closeButton = document.getElementById('close-config-window');
        closeButton?.addEventListener('click', (e) => {
            e.preventDefault();
            ipcRenderer.send('request-config-close');
        });
    }

    // 应用初始主题
    const savedTheme = 'titan';
    applyTheme(savedTheme);

    //@ts-ignore
    config = await ipcRenderer.invoke('get-config');

    // 初始化语言
    // @ts-ignore
    if (window.LocalizationManager) {
        // @ts-ignore
        await window.LocalizationManager.loadTranslations(config.language || 'en');
        // @ts-ignore
        window.LocalizationManager.applyTranslations();
    }
    console.log(await ipcRenderer.invoke('get-config'))

    console.log(config)


}
