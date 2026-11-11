import { ipcRenderer } from 'electron';

declare global {
    interface Window {
        LocalizationManager: any;
    }
}

// Main page elements
//@ts-ignore
const useConnectionAPI: HTMLInputElement = document.querySelector("#use-connection-api")!.checkbox;
const apiSelector: HTMLElement = document.querySelector("#api-selector")!;

// Summary Manager Elements
const playerIdSelect = document.getElementById('summary-manager-playerIdSelect') as HTMLSelectElement;
const characterSelect = document.getElementById('summary-manager-characterSelect') as HTMLSelectElement;
const summaryPathInput = document.getElementById('summary-manager-summaryPath') as HTMLInputElement;
const summaryList = document.getElementById('summary-manager-summaryList') as HTMLDivElement;
const statusMessage = document.getElementById('summary-manager-statusMessage') as HTMLDivElement;
const summaryLoader = document.getElementById('summary-manager-loader') as HTMLDivElement;
const summarySearchInput = document.getElementById('summary-manager-search') as HTMLInputElement;

// Summary Manager Buttons
const refreshBtn = document.getElementById('summary-manager-refreshBtn') as HTMLButtonElement;
const saveBtn = document.getElementById('summary-manager-saveBtn') as HTMLButtonElement;
const addSummaryBtn = document.getElementById('summary-manager-addSummaryBtn') as HTMLButtonElement;
const deleteItemBtn = document.getElementById('summary-manager-deleteItemBtn') as HTMLButtonElement;

// Tab Elements
const conversationTabBtn = document.getElementById('summary-tab-conversations') as HTMLButtonElement;
const lettersTabBtn = document.getElementById('summary-tab-letters') as HTMLButtonElement;
const diariesTabBtn = document.getElementById('summary-tab-diaries') as HTMLButtonElement;

// Month names for date formatting
const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// State variables
let allSummaries: any[] = [];
let filteredSummaries: any[] = [];
let allLetters: any[] = [];
let filteredLetters: any[] = [];
let allDiaries: any[] = [];
let filteredDiaries: any[] = [];
let currentSummaryIndex = -1;
let selectedPlayerId = '';
let summaryLoadGeneration = 0;
let loadedPlayerId = '';
let editRevisions: Record<string, string> = {};
let selectedCharacterId = 'all';
let votcDataPath = '';
let currentHighlightIndex = -1;
let allHighlightMarks: HTMLElement[] = [];
let editingSummaryIndex = -1;
let hasUnsavedChanges = false;
let characterMap: { [key: string]: string } = {};
let activeTab: 'conversations' | 'letters' | 'diaries' = 'conversations';

//init
document.getElementById("container")!.style.display = "block";
init();

// Apply theme function
function applyTheme(theme: string) {
    const body = document.querySelector('body');
    if (body) {
        body.classList.remove('theme-original', 'theme-chinese', 'theme-west');
        body.classList.add(`theme-${theme}`);
    }
}

// Listen for theme updates


// Listen for language updates
ipcRenderer.on('update-language', async (event, lang) => {
    // @ts-ignore
    if (window.LocalizationManager) {
        // @ts-ignore
        await window.LocalizationManager.loadTranslations(lang);
        // @ts-ignore
        window.LocalizationManager.applyTranslations();
        if (characterSelect) {
            populateCharacterSelect();
        }
        if (summaryList) {
            renderCurrentTabList();
        }
    }
});

async function init() {
    // Apply initial theme
    const savedTheme = 'titan';
    applyTheme(savedTheme);

    const config = await ipcRenderer.invoke('get-config');

    // Initialize language
    // @ts-ignore
    if (window.LocalizationManager) {
        // @ts-ignore
        await window.LocalizationManager.loadTranslations(config.language || 'en');
        // @ts-ignore
        window.LocalizationManager.applyTranslations();
    }

    toggleApiSelector();

    useConnectionAPI.addEventListener('change', () => {
        toggleApiSelector();
    });

    initSummaryManager();
    setupTabNavigation();
}

function toggleApiSelector() {
    //@ts-ignore
    if (useConnectionAPI.checked) {
        apiSelector.style.opacity = "0.5";
        apiSelector.style.pointerEvents = "none";
    } else {
        apiSelector.style.opacity = "1";
        apiSelector.style.pointerEvents = "auto";
    }
}

function updateSaveButtonState() {
    if (hasUnsavedChanges) {
        saveBtn.classList.add('blinking');
    } else {
        saveBtn.classList.remove('blinking');
    }
}

function handleSearchKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
        event.preventDefault();
        if (allHighlightMarks.length === 0) return;

        if (currentHighlightIndex !== -1) {
            allHighlightMarks[currentHighlightIndex].classList.remove('current-highlight');
        }

        currentHighlightIndex++;
        if (currentHighlightIndex >= allHighlightMarks.length) {
            currentHighlightIndex = 0;
        }

        const currentMark = allHighlightMarks[currentHighlightIndex];
        currentMark.classList.add('current-highlight');
        currentMark.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}


// Summary Manager Logic
async function initSummaryManager() {
    try {
        votcDataPath = await ipcRenderer.invoke('get-userdata-path');
        await loadPlayerIds(); // Load player IDs first
        setupEventListeners();
    } catch (error: any) {
        const errorMsg = window.LocalizationManager ? window.LocalizationManager.getTranslation('summary_manager.load_fail', 'Initialization failed: ') : 'Initialization failed: ';
        showStatusMessage(errorMsg + error.message, 'error');
        console.error('Initialization error:', error);
    }
}

function setupEventListeners() {
    refreshBtn.addEventListener('click', () => {
      const currentPlayerId = playerIdSelect.value;
      const currentCharacterId = characterSelect.value;
      loadPlayerIds(currentPlayerId, currentCharacterId);
    });
    saveBtn.addEventListener('click', saveCurrentTabData);
    addSummaryBtn.addEventListener('click', addNewEntry);
    playerIdSelect.addEventListener('change', () =>  loadAllDataForPlayer());
    characterSelect.addEventListener('change', filterCurrentTabData);
    summarySearchInput.addEventListener('input', () => {
        currentHighlightIndex = -1; // Reset highlight on new search
        renderCurrentTabList();
    });
    summarySearchInput.addEventListener('keydown', handleSearchKeydown);

    if (deleteItemBtn) {
        deleteItemBtn.addEventListener('click', deleteCurrentEntry);
    }
}

function setupTabNavigation() {
    conversationTabBtn.addEventListener('click', () => switchTab('conversations'));
    lettersTabBtn.addEventListener('click', () => switchTab('letters'));
    diariesTabBtn.addEventListener('click', () => switchTab('diaries'));
}

function switchTab(tab: 'conversations' | 'letters' | 'diaries') {
    // Update active tab state
    activeTab = tab;

    // Update UI to show active tab
    conversationTabBtn.classList.toggle('active', tab === 'conversations');
    lettersTabBtn.classList.toggle('active', tab === 'letters');
    diariesTabBtn.classList.toggle('active', tab === 'diaries');

    // Update button labels based on active tab
    const addBtnText = window.LocalizationManager.getTranslation(
        `summary_manager.add_${tab === 'diaries' ? 'diary' : tab === 'letters' ? 'letter' : 'summary'}`,
        `Add ${tab.charAt(0).toUpperCase() + tab.slice(1).slice(0, -1)}`
    );
    addSummaryBtn.textContent = addBtnText;

    const deleteBtnText = window.LocalizationManager.getTranslation(
        'summary_manager.delete_btn',
        'Delete'
    );
    deleteItemBtn.textContent = deleteBtnText;

    // Filter and render data for the selected tab
    filterCurrentTabData();
    renderCurrentTabList();

    // Update save button state
    updateSaveButtonState();
}

async function loadPlayerIds(currentPlayerId?: string, currentCharacterId?: string) {
    const storedPlayerId = selectedPlayerId;
    summaryLoader.style.display = 'block';
    refreshBtn.disabled = true;
    saveBtn.disabled = true;
    try {
        showStatusMessage(window.LocalizationManager.getTranslation('summary_manager.loading_players', 'Loading player IDs...'), 'info');
        const { success, ids, error } = await ipcRenderer.invoke('get-all-summary-player-ids');
        if (!success) {
            throw new Error(error || 'Unknown error');
        }

        playerIdSelect.innerHTML = '';
        if (ids && ids.length > 0) {
            ids.forEach((player: {id: string, name: string}) => {
                const option = document.createElement('option');
                option.value = player.id;
                option.textContent = player.name === `Player ${player.id}` ? player.id : `${player.name} (${player.id})`;
                playerIdSelect.appendChild(option);
            });

            if (currentPlayerId && Array.from(playerIdSelect.options).some(opt => opt.value === currentPlayerId)) {
              playerIdSelect.value = currentPlayerId;
            }
            selectedPlayerId = playerIdSelect.value;

            await loadAllDataForPlayer(currentCharacterId); // Load data for the selected player
        } else {
            showStatusMessage(window.LocalizationManager.getTranslation('summary_manager.no_players_found', 'No player data found.'), 'info');
            summaryList.innerHTML = '';
            characterSelect.innerHTML = '';
            allSummaries = [];
            filteredSummaries = [];
            allLetters = [];
            filteredLetters = [];
            allDiaries = [];
            filteredDiaries = [];
        }
    } catch (error: any) {
        const errorMsg = window.LocalizationManager.getTranslation('summary_manager.load_players_fail', 'Failed to load player IDs: ');
        showStatusMessage(errorMsg + error.message, 'error');
        console.error('Error loading player IDs:', error);
    } finally {
        summaryLoader.style.display = 'none';
        refreshBtn.disabled = false;
        saveBtn.disabled = false;
    }
}

async function loadAllDataForPlayer(currentCharacterId?: string) {
    const generation = ++summaryLoadGeneration;
    const player = playerIdSelect.value;
    const owns = () => generation === summaryLoadGeneration && playerIdSelect.value === player;
    loadedPlayerId = '';
    saveBtn.disabled = true;
    const storedCharacterId = selectedCharacterId;
    summaryLoader.style.display = 'block';
    summaryList.innerHTML = '';
    selectedPlayerId = playerIdSelect.value;

    if (!selectedPlayerId) {
        showStatusMessage(window.LocalizationManager.getTranslation('summary_manager.no_player_selected', 'No player selected.'), 'info');
        summaryLoader.style.display = 'none';
        return;
    }

    try {
        showStatusMessage(window.LocalizationManager.getTranslation('summary_manager.loading_data', 'Loading data...'), 'info');

        const [mapResult, conversations, letters, diaries] = await Promise.all([
            ipcRenderer.invoke('get-character-map', player),
            ipcRenderer.invoke('read-summary-edit-snapshot', player, 'conversations'),
            ipcRenderer.invoke('read-summary-edit-snapshot', player, 'letters'),
            ipcRenderer.invoke('read-summary-edit-snapshot', player, 'diaries')
        ]);
        if (!owns()) return;
        characterMap = mapResult.success ? mapResult.map : {};
        allSummaries = conversations.data; allLetters = letters.data; allDiaries = diaries.data;
        editRevisions = { conversations: conversations.revision, letters: letters.revision, diaries: diaries.revision };
        loadedPlayerId = player;
        populateCharacterSelect(currentCharacterId);
        if (storedCharacterId && Array.from(characterSelect.options).some(opt => opt.value === storedCharacterId)) {
            characterSelect.value = storedCharacterId;
        }
        selectedCharacterId = characterSelect.value;
        filterCurrentTabData();
        showStatusMessage(window.LocalizationManager.getTranslation('summary_manager.load_success', 'Summary data loaded successfully'), 'success');
        hasUnsavedChanges = false;
        updateSaveButtonState();
    } catch (error: any) {
        if (!owns()) return;
        const errorMsg = window.LocalizationManager.getTranslation('summary_manager.load_fail_generic', 'Failed to load data: ');
        showStatusMessage(errorMsg + error.message, 'error');
        console.error('Error loading data:', error);
    } finally {
        if (owns()) { summaryLoader.style.display = 'none'; saveBtn.disabled = loadedPlayerId !== player; }
    }
}

function populateCharacterSelect(currentCharacterId?: string) {
    const allCharsText = window.LocalizationManager ? window.LocalizationManager.getTranslation('summary_manager.all_characters', 'All Characters') : 'All Characters';
    characterSelect.innerHTML = `<option value="all">${allCharsText}</option>`;

    const characterNameMap = new Map<string, string>();

    allSummaries.forEach(summary => {
        if (summary.characterId) {
            characterNameMap.set(summary.characterId, summary.characterName || `Character ${summary.characterId}`);
        }
    });
    allLetters.forEach(summary => {
        if (summary.characterId) {
            characterNameMap.set(summary.characterId, summary.characterName || `Character ${summary.characterId}`);
        }
    });
    allDiaries.forEach(summary => {
        if (summary.characterId) {
            characterNameMap.set(summary.characterId, summary.characterName || `Character ${summary.characterId}`);
        }
    });

    const sortedCharacters = [...characterNameMap.entries()].sort((a, b) => a[1].localeCompare(b[1]));
    sortedCharacters.forEach(([characterId, characterName]) => {
        const option = document.createElement('option');
        option.value = characterId;
        option.textContent = `${characterName} (${characterId})`;
        characterSelect.appendChild(option);
    });

    if (currentCharacterId && Array.from(characterSelect.options).some(opt => opt.value === currentCharacterId)) {
        characterSelect.value = currentCharacterId;
    } else {
        characterSelect.value = 'all';
    }
    selectedCharacterId = characterSelect.value;
}

function filterCurrentTabData() {
    selectedCharacterId = characterSelect.value;

    if (activeTab === 'conversations') {
        if (selectedCharacterId === 'all') {
            filteredSummaries = [...allSummaries];
        } else {
            filteredSummaries = allSummaries.filter(summary => (summary.characterId || 'Unknown') === selectedCharacterId);
        }
        filteredSummaries.sort((a, b) => {
            const extractDate = (dateStr: string) => {
                const match = dateStr.match(/(\d+)年(\d+)月(\d+)日/);
                if (match) {
                    return { year: parseInt(match[1]), month: parseInt(match[2]), day: parseInt(match[3]) };
                }
                const date = new Date(dateStr);
                if (!isNaN(date.getTime())) {
                    return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
                }
                return { year: 0, month: 1, day: 1 };
            };
            const dateA = extractDate(a.date);
            const dateB = extractDate(b.date);
            if (dateB.year !== dateA.year) return dateB.year - dateA.year;
            if (dateB.month !== dateA.month) return dateB.month - dateA.month;
            return dateB.day - dateA.day;
        });
    } else if (activeTab === 'letters') {
        if (selectedCharacterId === 'all') {
            filteredLetters = [...allLetters];
        } else {
            filteredLetters = allLetters.filter(summary => summary.characterId === selectedCharacterId);
        }
        // Sort by date (newest first)
        filteredLetters.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    } else if (activeTab === 'diaries') {
        if (selectedCharacterId === 'all') {
            filteredDiaries = [...allDiaries];
        } else {
            filteredDiaries = allDiaries.filter(diary => diary.characterId === selectedCharacterId);
        }
        // Sort by date (newest first)
        filteredDiaries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }

    currentSummaryIndex = -1;
    resetEditor();
    renderCurrentTabList();

    // Update path input based on active tab
    if (selectedCharacterId !== 'all') {
        let path = '';
        if (activeTab === 'conversations') {
            path = `${votcDataPath}/conversation_summaries/${selectedPlayerId}/${selectedCharacterId}.json`;
        } else if (activeTab === 'letters') {
            path = `${votcDataPath}/letter_history/${selectedPlayerId}/${selectedCharacterId}.json`;
        } else if (activeTab === 'diaries') {
            path = `${votcDataPath}/diary_history/${selectedPlayerId}/${selectedCharacterId}.json`;
        }
        summaryPathInput.value = path.replace(/\\/g, '/');
    } else {
        summaryPathInput.value = '';
    }
}

function renderCurrentTabList() {
    const searchTerm = summarySearchInput.value;
    summaryList.innerHTML = '';
    allHighlightMarks = []; // Clear previous marks

    let itemsToRender: any[] = [];
    if (activeTab === 'conversations') {
        itemsToRender = searchTerm
            ? filteredSummaries.filter(summary => {
                const content = summary.content || '';
                const date = summary.date || '';
                const characterId = summary.characterId || 'Unknown';
                const characterName = summary.characterName || '';
                const lowerCaseSearchTerm = searchTerm.toLowerCase();
                return content.toLowerCase().includes(lowerCaseSearchTerm) ||
                       date.toLowerCase().includes(lowerCaseSearchTerm) ||
                       characterId.toLowerCase().includes(lowerCaseSearchTerm) ||
                       characterName.toLowerCase().includes(lowerCaseSearchTerm);
            })
            : filteredSummaries;
    } else if (activeTab === 'letters') {
        itemsToRender = searchTerm
            ? filteredLetters.filter(summary => {
                const content = summary.summary || '';
                const date = summary.date || '';
                const characterName = summary.characterName || '';
                const lowerCaseSearchTerm = searchTerm.toLowerCase();
                return content.toLowerCase().includes(lowerCaseSearchTerm) ||
                       date.toLowerCase().includes(lowerCaseSearchTerm) ||
                       characterName.toLowerCase().includes(lowerCaseSearchTerm);
            })
            : filteredLetters;
    } else if (activeTab === 'diaries') {
        itemsToRender = searchTerm
            ? filteredDiaries.filter(summary => {
                const content = summary.summary || '';
                const date = summary.date || '';
                const characterName = summary.characterName || '';
                const lowerCaseSearchTerm = searchTerm.toLowerCase();
                return content.toLowerCase().includes(lowerCaseSearchTerm) ||
                       date.toLowerCase().includes(lowerCaseSearchTerm) ||
                       characterName.toLowerCase().includes(lowerCaseSearchTerm);
            })
            : filteredDiaries;
    }

    if (!itemsToRender || itemsToRender.length === 0) {
        const noDataText = window.LocalizationManager ? window.LocalizationManager.getTranslation('summary_manager.no_data', 'No data') : 'No data';
        summaryList.innerHTML = `<div class="no-summaries">${noDataText}</div>`;
        return;
    }

    const highlightRegex = searchTerm ? new RegExp(`(${escapeRegExp(searchTerm)})`, 'gi') : null;

    itemsToRender.forEach((item, index) => {
        let originalIndex: number | undefined;
        if (activeTab === 'conversations') {
            originalIndex = filteredSummaries.indexOf(item);
        } else if (activeTab === 'letters') {
            originalIndex = filteredLetters.indexOf(item);
        } else if (activeTab === 'diaries') {
            originalIndex = filteredDiaries.indexOf(item);
        }

        if (originalIndex === editingSummaryIndex) {
            // Render in edit mode
            const editItem = document.createElement('div');
            editItem.className = 'summary-item-edit';

            if (activeTab === 'conversations') {
                const characterId = item.characterId || 'Unknown';
                const characterName = item.characterName || characterId;
                const characterText = window.LocalizationManager.getTranslation('summary_manager.character', 'Character');

                editItem.innerHTML = `
                    <div style="font-weight: bold; margin-bottom: 5px;">${characterText}: ${characterName}</div>
                    <input type="date" id="summary-edit-date-${originalIndex}" value="${formatDateForInput(item.date)}">
                    <textarea id="summary-edit-content-${originalIndex}" rows="3">${item.content || ''}</textarea>
                    <div class="edit-controls">
                        <button class="btn cancel-inplace-btn" data-i18n="summary_manager.close_btn">Close</button>
                        <button class="btn btn-success save-inplace-btn" data-i18n="summary_manager.save_btn" disabled>Save</button>
                    </div>
                `;
            } else if (activeTab === 'letters') {
                const characterName = item.characterName || `Character ${item.characterId}`;

                editItem.innerHTML = `
                    <div style="font-weight: bold; margin-bottom: 5px;">${characterName}</div>
                    <input type="date" id="summary-edit-date-${originalIndex}" value="${formatDateForInput(item.date)}">
                    <textarea id="summary-edit-content-${originalIndex}" rows="5">${item.summary || ''}</textarea>
                    <div class="edit-controls">
                        <button class="btn cancel-inplace-btn" data-i18n="summary_manager.close_btn">Close</button>
                        <button class="btn btn-success save-inplace-btn" data-i18n="summary_manager.save_btn" disabled>Save</button>
                    </div>
                `;
            } else if (activeTab === 'diaries') {
                const characterName = item.characterName || `Character ${item.characterId}`;

                editItem.innerHTML = `
                    <div style="font-weight: bold; margin-bottom: 5px;">${characterName}</div>
                    <input type="date" id="summary-edit-date-${originalIndex}" value="${formatDateForInput(item.date)}">
                    <textarea id="summary-edit-content-${originalIndex}" rows="5">${item.summary || ''}</textarea>
                    <div class="edit-controls">
                        <button class="btn cancel-inplace-btn" data-i18n="summary_manager.close_btn">Close</button>
                        <button class="btn btn-success save-inplace-btn" data-i18n="summary_manager.save_btn" disabled>Save</button>
                    </div>
                `;
            }

            const saveButton = editItem.querySelector('.save-inplace-btn') as HTMLButtonElement;
            saveButton.addEventListener('click', () => saveInPlaceEdit());
            const cancelButton = editItem.querySelector('.cancel-inplace-btn') as HTMLButtonElement;
            cancelButton.addEventListener('click', () => cancelInPlaceEdit());
            // Add event listeners for input changes
            const dateInput = editItem.querySelector(`#summary-edit-date-${originalIndex}`) as HTMLInputElement;
            const contentInput = editItem.querySelector(`#summary-edit-content-${originalIndex}`) as HTMLTextAreaElement;

            if (dateInput && contentInput) {
                dateInput.addEventListener('input', () => handleInPlaceInputChange(originalIndex!));
                contentInput.addEventListener('input', () => handleInPlaceInputChange(originalIndex!));
            }

            summaryList.appendChild(editItem);
        } else {
            // Render in display mode
            const summaryItem = document.createElement('div');
            summaryItem.className = 'summary-item';

            if (originalIndex === currentSummaryIndex) {
                summaryItem.classList.add('selected');
            }

            if (activeTab === 'conversations') {
                const characterId = item.characterId || 'Unknown';
                const characterName = item.characterName || characterId;
                const characterText = window.LocalizationManager.getTranslation('summary_manager.character', 'Character');
                const characterDisplayText = characterName ? `${characterName} (${characterId})` : characterId;

                // Format date for display
                const displayDate = formatDateForDisplay(item.date);
                const headerText = `${displayDate} - ${characterText}: ${characterName}`;
                const headerHTML = highlightRegex ? headerText.replace(highlightRegex, '<mark>$1</mark>') : headerText;
                const contentHTML = highlightRegex ? (item.content || '').replace(highlightRegex, '<mark>$1</mark>') : (item.content || '');

                summaryItem.innerHTML = `
                    <div class="summary-date">${headerHTML}</div>
                    <div class="summary-content">${contentHTML}</div>
                `;
            } else if (activeTab === 'letters') {
                const characterName = item.characterName || `Character ${item.characterId}`;

                // Format date for display
                const displayDate = formatDateForDisplay(item.date);
                const headerText = `${displayDate} - ${characterName}`;
                const headerHTML = highlightRegex ? headerText.replace(highlightRegex, '<mark>$1</mark>') : headerText;
                const contentHTML = highlightRegex ? (item.summary || '').replace(highlightRegex, '<mark>$1</mark>') : (item.summary || '');

                summaryItem.innerHTML = `
                    <div class="summary-date">${headerHTML}</div>
                    <div class="summary-content">${contentHTML}</div>
                `;
            } else if (activeTab === 'diaries') {
                const characterName = item.characterName || `Character ${item.characterId}`;

                // Format date for display
                const displayDate = formatDateForDisplay(item.date);
                const headerText = `${displayDate} - ${characterName}`;
                const headerHTML = highlightRegex ? headerText.replace(highlightRegex, '<mark>$1</mark>') : headerText;
                const contentHTML = highlightRegex ? (item.summary || '').replace(highlightRegex, '<mark>$1</mark>') : (item.summary || '');

                summaryItem.innerHTML = `
                    <div class="summary-date">${headerHTML}</div>
                    <div class="summary-content">${contentHTML}</div>
                `;
            }

            if (originalIndex !== undefined) {
                summaryItem.dataset.originalIndex = originalIndex.toString();
            }
            summaryItem.addEventListener('click', (e) => {
                const index = parseInt((e.currentTarget as HTMLElement).dataset.originalIndex!);
                selectSummary(index);
            });
            summaryItem.addEventListener('dblclick', (e) => {
                const index = parseInt((e.currentTarget as HTMLElement).dataset.originalIndex!);
                enterEditMode(index);
            });
            summaryList.appendChild(summaryItem);
        }
    });

    // After rendering, collect all mark elements for 'Enter' key navigation
    allHighlightMarks = Array.from(summaryList.querySelectorAll('mark'));

    // Update delete item button state
    if (deleteItemBtn) {
        deleteItemBtn.disabled = currentSummaryIndex === -1 || editingSummaryIndex !== -1;
    }
}

function selectSummary(index: number) {
    // Don't allow selection while editing
    if (editingSummaryIndex !== -1) return;

    currentSummaryIndex = index;

    let item: any;
    let characterId: string;
    let filePath: string = '';

    if (activeTab === 'conversations') {
        if (index < 0 || index >= filteredSummaries.length) return;
        item = filteredSummaries[index];
        characterId = item.characterId || 'Unknown';
        filePath = `${votcDataPath}/conversation_summaries/${selectedPlayerId}/${characterId}.json`;
    } else if (activeTab === 'letters') {
        if (index < 0 || index >= filteredLetters.length) return;
        item = filteredLetters[index];
        characterId = item.characterId || 'Unknown';
        filePath = `${votcDataPath}/letter_summaries/${selectedPlayerId}/${characterId}.json`;
    } else if (activeTab === 'diaries') {
        if (index < 0 || index >= filteredDiaries.length) return;
        item = filteredDiaries[index];
        characterId = item.characterId || 'Unknown';
        filePath = `${votcDataPath}/diary_summaries/${selectedPlayerId}/${characterId}.json`;
    }

    // Update file path
    summaryPathInput.value = filePath.replace(/\\/g, '/'); // Normalize path separators

    if (deleteItemBtn) deleteItemBtn.disabled = false; // Enable delete button

    renderCurrentTabList(); // Re-render to update selection highlight
}

function addNewEntry() {
    if (editingSummaryIndex !== -1) return; // Don't allow adding while another item is being edited.
    if (selectedCharacterId === 'all') {
        const errorMsg = window.LocalizationManager.getTranslation(
            'summary_manager.select_character_to_add_error',
            'Please select a character before adding a new entry.'
        );
        showStatusMessage(errorMsg, 'error');
        return;
    }

    const characterId = selectedCharacterId;
    const characterName = characterSelect.options[characterSelect.selectedIndex].text;
    const today = new Date().toISOString().split('T')[0]; // Default to today in YYYY-MM-DD format

    if (activeTab === 'conversations') {
        const newSummary = {
            date: today,
            content: 'New summary content',
            characterId: characterId,
            characterName: characterName,
            _isNew: true
        };
        allSummaries.unshift(newSummary);
        filterCurrentTabData(); // This will filter, sort, and render the list

        // Find the index of the new summary in the filtered list after sorting
        const newIndex = filteredSummaries.findIndex(s => s === newSummary);

        if (newIndex !== -1) {
            enterEditMode(newIndex);
        }

        showStatusMessage(window.LocalizationManager.getTranslation('summary_manager.add_success', 'New summary added'), 'success');
    } else if (activeTab === 'letters') {
        // Create a mock letter summary
        const newLetterSummary = {
            date: today,
            summary: 'New letter summary',
            characterId: characterId,
            characterName: characterName,
            letterIds: [],
            _isNew: true
        };
        allLetters.unshift(newLetterSummary);
        filterCurrentTabData();

        // Find the index of the new letter in the filtered list
        const newIndex = filteredLetters.findIndex(l => l === newLetterSummary);

        if (newIndex !== -1) {
            enterEditMode(newIndex);
        }

        showStatusMessage(window.LocalizationManager.getTranslation('summary_manager.add_success', 'New letter summary added'), 'success');
    } else if (activeTab === 'diaries') {
        // Create a mock diary summary
        const newDiarySummary = {
            id: window.crypto.randomUUID(),
            diaryEntryId: '', // No associated entry yet
            date: today,
            summary: 'New diary summary',
            characterId: characterId,
            characterName: characterName,
            _isNew: true
        };
        allDiaries.unshift(newDiarySummary);
        filterCurrentTabData();

        // Find the index of the new diary in the filtered list
        const newIndex = filteredDiaries.findIndex(d => d === newDiarySummary);

        if (newIndex !== -1) {
            enterEditMode(newIndex);
        }

        showStatusMessage(window.LocalizationManager.getTranslation('summary_manager.add_success', 'New diary summary added'), 'success');
    }

    hasUnsavedChanges = true;
    updateSaveButtonState();
}


async function deleteCurrentEntry() {
    if (currentSummaryIndex < 0) {
        const errorMsg = window.LocalizationManager.getTranslation(
            'summary_manager.select_to_delete_error',
            'Please select an entry to delete first'
        );
        showStatusMessage(errorMsg, 'error');
        return;
    }

    const confirmDeleteMsg = window.LocalizationManager.getTranslation(
        'summary_manager.confirm_delete',
        'Are you sure you want to delete this entry?'
    );

    if (confirm(confirmDeleteMsg)) {
        if (activeTab === 'conversations') {
            if (currentSummaryIndex >= filteredSummaries.length) return;
            const summary = filteredSummaries[currentSummaryIndex];
            const originalIndex = allSummaries.findIndex(s => s === summary);
            if (originalIndex !== -1) {
                allSummaries.splice(originalIndex, 1);
            }
            filterCurrentTabData();
            showStatusMessage(window.LocalizationManager.getTranslation('summary_manager.delete_success', 'Summary deleted'), 'success');
        } else if (activeTab === 'letters') {
            if (currentSummaryIndex >= filteredLetters.length) return;
            const summary = filteredLetters[currentSummaryIndex];
            const originalIndex = allLetters.findIndex(l => l === summary);
            if (originalIndex !== -1) {
                allLetters.splice(originalIndex, 1);
            }
            filterCurrentTabData();
            showStatusMessage(window.LocalizationManager.getTranslation('summary_manager.delete_success', 'Letter summary deleted'), 'success');
        } else if (activeTab === 'diaries') {
            if (currentSummaryIndex >= filteredDiaries.length) return;
            const diary = filteredDiaries[currentSummaryIndex];
            const originalIndex = allDiaries.findIndex(d => d === diary);
            if (originalIndex !== -1) {
                allDiaries.splice(originalIndex, 1);
            }
            filterCurrentTabData();
            showStatusMessage(window.LocalizationManager.getTranslation('summary_manager.delete_success', 'Diary summary deleted'), 'success');
        }

        hasUnsavedChanges = true;
        updateSaveButtonState();
    }
}

function resetEditor() {
    currentSummaryIndex = -1;
    summaryPathInput.value = ''; // Clear path
    if (deleteItemBtn) deleteItemBtn.disabled = true; // Disable delete button
}

async function saveCurrentTabData() {
    if (!loadedPlayerId || loadedPlayerId !== selectedPlayerId || selectedPlayerId !== playerIdSelect.value) {
        showStatusMessage('Wait for this player’s summaries to finish loading.', 'error'); return;
    }
    const player = loadedPlayerId, generation = summaryLoadGeneration, tab = activeTab;
    const owns = () => player === loadedPlayerId && generation === summaryLoadGeneration;

    if (!selectedPlayerId) {
        const errorMsg = window.LocalizationManager.getTranslation(
            'summary_manager.no_player_selected_save',
            'No player selected. Cannot save.'
        );
        showStatusMessage(errorMsg, 'error');
        return;
    }
    refreshBtn.disabled = true;
    saveBtn.disabled = true;
    try {
        showStatusMessage(window.LocalizationManager.getTranslation('summary_manager.saving', 'Saving data...'), 'info');

        const channels = { conversations: 'save-summary-file', letters: 'save-all-letter-summaries', diaries: 'save-all-diary-summaries' };
        const data = tab === 'conversations' ? allSummaries : tab === 'letters' ? allLetters : allDiaries;
        const result = await ipcRenderer.invoke(channels[tab], player, data, editRevisions[tab]);
        if (!owns()) return;
        if (!result?.success) throw new Error(result?.error || 'Unable to save summaries.');
        showStatusMessage(window.LocalizationManager.getTranslation('summary_manager.save_success', 'Summaries saved successfully'), 'success');

        hasUnsavedChanges = false;
        updateSaveButtonState();
    } catch (error: any) {
        if (!owns()) return;
        const errorMsg = window.LocalizationManager.getTranslation('summary_manager.save_fail', 'Failed to save data: ');
        showStatusMessage(errorMsg + error.message, 'error');
        console.error('Error saving data:', error);
    } finally {
        if (owns()) { refreshBtn.disabled = false; saveBtn.disabled = false; }
    }
}

function showStatusMessage(message: string, type = 'info') {
    statusMessage.textContent = message;
    statusMessage.className = `status-message ${type} show`;
    setTimeout(() => {
        statusMessage.classList.remove('show');
    }, 3000);
}

function formatDateForDisplay(dateStr: string): string {
    if (!dateStr) return '';

    // The input is expected to be YYYY-MM-DD from the input field or storage.
    const ymdMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (ymdMatch) {
        const year = parseInt(ymdMatch[1], 10);
        const monthIndex = parseInt(ymdMatch[2], 10) - 1;
        const day = parseInt(ymdMatch[3], 10);
        if (monthIndex >= 0 && monthIndex < 12) {
            return `${day} ${monthNames[monthIndex]} ${year}`;
        }
    }

    // If it's not in YYYY-MM-DD, it might be one of the other formats, just return it as is.
    return dateStr;
}

function formatDateForInput(dateStr: string): string {
    if (!dateStr) return '';

    // If it's already in YYYY-MM-DD, just return it.
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return dateStr;
    }

    // Handle YYYY.M.D format from the game
    const gameDateMatch = dateStr.match(/^(\d{1,4})\.(\d{1,2})\.(\d{1,2})$/);
    if (gameDateMatch) {
        const year = gameDateMatch[1].padStart(4, '0');
        const month = gameDateMatch[2].padStart(2, '0');
        const day = gameDateMatch[3].padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    // For any other format, we must parse it into components and build a YYYY-MM-DD string.
    // This avoids timezone issues from `new Date()`.

    const months: { [key: string]: number } = {
        'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3, 'may': 4, 'jun': 5,
        'jul': 6, 'aug': 7, 'sep': 8, 'oct': 9, 'nov': 10, 'dec': 11
    };

    // Handle "DD MMM YYYY" format
    const dmyMatch = dateStr.match(/^(\d{1,2})\s+(\w{3})\s+(\d{1,4})$/i);
    if (dmyMatch) {
        const day = parseInt(dmyMatch[1], 10);
        const monthStr = dmyMatch[2].toLowerCase();
        const month = months[monthStr];
        const year = parseInt(dmyMatch[3], 10);

        if (month !== undefined) {
            return `${year.toString().padStart(4, '0')}-${(month + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
        }
    }

    // Attempt to handle YYYY年MM月DD日 format
    const cjkMatch = dateStr.match(/(\d{1,4})年(\d{1,2})月(\d{1,2})日/);
    if (cjkMatch) {
        return `${cjkMatch[1].padStart(4, '0')}-${cjkMatch[2].padStart(2, '0')}-${cjkMatch[3].padStart(2, '0')}`;
    }

    // As a last resort, try new Date(), but it's risky.
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
        // This will use the local timezone's year, month, day, which might be what we want if the string is ambiguous.
        const year = date.getFullYear();
        const month = date.getMonth() + 1;
        const day = date.getDate();
        return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
    }

    return ''; // Return empty if parsing fails
}


function handleInPlaceInputChange(index: number) {
    if (index < 0) return;

    let item: any;
    if (activeTab === 'conversations') {
        if (index >= filteredSummaries.length) return;
        item = filteredSummaries[index];
    } else if (activeTab === 'letters') {
        if (index >= filteredLetters.length) return;
        item = filteredLetters[index];
    } else if (activeTab === 'diaries') {
        if (index >= filteredDiaries.length) return;
        item = filteredDiaries[index];
    }

    const dateInput = document.getElementById(`summary-edit-date-${index}`) as HTMLInputElement;
    const contentInput = document.getElementById(`summary-edit-content-${index}`) as HTMLTextAreaElement;
    const editItem = dateInput.closest('.summary-item-edit');
    const saveButton = editItem?.querySelector('.save-inplace-btn') as HTMLButtonElement;

    if (!dateInput || !contentInput || !item || !saveButton) return;

    let originalDate: string = '', originalContent: string = '';
    if (activeTab === 'conversations') {
        originalDate = formatDateForInput(item.date);
        originalContent = item.content || '';
    } else if (activeTab === 'letters') {
        originalDate = formatDateForInput(item.date);
        originalContent = item.summary || '';
    } else if (activeTab === 'diaries') {
        originalDate = formatDateForInput(item.date);
        originalContent = item.summary || '';
    }

    const dateChanged = originalDate !== dateInput.value;
    const contentChanged = originalContent !== contentInput.value;

    const hasChanges = dateChanged || contentChanged;
    saveButton.disabled = !hasChanges;

    if (hasChanges) {
        saveButton.classList.add('blinking');
    } else {
        saveButton.classList.remove('blinking');
    }
}

function cancelInPlaceEdit() {
    if (editingSummaryIndex === -1) return;

    if (activeTab === 'conversations') {
        const entry = filteredSummaries[editingSummaryIndex];
        if (entry && (entry as any)._isNew) {
            const originalIndex = allSummaries.findIndex(s => s === entry);
            if (originalIndex !== -1) {
                allSummaries.splice(originalIndex, 1);
            }
        }
    } else if (activeTab === 'letters') {
        const entry = filteredLetters[editingSummaryIndex];
        if (entry && (entry as any)._isNew) {
            const originalIndex = allLetters.findIndex(l => l === entry);
            if (originalIndex !== -1) {
                allLetters.splice(originalIndex, 1);
            }
        }
    } else if (activeTab === 'diaries') {
        const entry = filteredDiaries[editingSummaryIndex];
        if (entry && (entry as any)._isNew) {
            const originalIndex = allDiaries.findIndex(d => d === entry);
            if (originalIndex !== -1) {
                allDiaries.splice(originalIndex, 1);
            }
        }
    }

    editingSummaryIndex = -1;
    filterCurrentTabData();
}

function enterEditMode(index: number) {
    if (index < 0) return;

    // Validate index based on active tab
    let isValid = false;
    if (activeTab === 'conversations') {
        isValid = index < filteredSummaries.length;
    } else if (activeTab === 'letters') {
        isValid = index < filteredLetters.length;
    } else if (activeTab === 'diaries') {
        isValid = index < filteredDiaries.length;
    }

    if (!isValid) return;

    // Exit any existing edit mode without saving
    if (editingSummaryIndex !== -1) {
        // Just cancel the previous edit
    }

    editingSummaryIndex = index;

    // Disable delete button during edit
    if (deleteItemBtn) deleteItemBtn.disabled = true;

    renderCurrentTabList();

    // Focus the content textarea
    const contentInput = document.getElementById(`summary-edit-content-${index}`) as HTMLTextAreaElement;
    if (contentInput) {
        contentInput.focus();
    }
}

function saveInPlaceEdit() {
    if (editingSummaryIndex < 0) return;

    let item: any = null;
    let originalIndex: number = -1;
    if (activeTab === 'conversations') {
        if (editingSummaryIndex >= filteredSummaries.length) return;
        item = filteredSummaries[editingSummaryIndex];
        originalIndex = allSummaries.findIndex(s => s === item);
    } else if (activeTab === 'letters') {
        if (editingSummaryIndex >= filteredLetters.length) return;
        item = filteredLetters[editingSummaryIndex];
        originalIndex = allLetters.findIndex(l => l === item);
    } else if (activeTab === 'diaries') {
        if (editingSummaryIndex >= filteredDiaries.length) return;
        item = filteredDiaries[editingSummaryIndex];
        originalIndex = allDiaries.findIndex(d => d === item);
    }

    const dateInput = document.getElementById(`summary-edit-date-${editingSummaryIndex}`) as HTMLInputElement;
    const contentInput = document.getElementById(`summary-edit-content-${editingSummaryIndex}`) as HTMLTextAreaElement;

    if (!dateInput || !contentInput) return;

    const newDate = dateInput.value;
    const newContent = contentInput.value;

    if (originalIndex !== -1) {
        if (activeTab === 'conversations') {
            allSummaries[originalIndex].date = newDate;
            allSummaries[originalIndex].content = newContent;
            delete (allSummaries[originalIndex] as any)._isNew;
        } else if (activeTab === 'letters') {
            allLetters[originalIndex].date = newDate;
            allLetters[originalIndex].summary = newContent;
            delete (allLetters[originalIndex] as any)._isNew;
        } else if (activeTab === 'diaries') {
            allDiaries[originalIndex].date = newDate;
            allDiaries[originalIndex].summary = newContent;
            delete (allDiaries[originalIndex] as any)._isNew;
        }
    }

    const justEditedIndex = editingSummaryIndex;
    editingSummaryIndex = -1;

    // Enable delete button
    if (deleteItemBtn) {
        deleteItemBtn.disabled = false;
    }

    // Refresh the list
    filterCurrentTabData();

    // Re-select the item that was just edited
    selectSummary(justEditedIndex);

    const successMsg = window.LocalizationManager.getTranslation(
        'summary_manager.update_success',
        `${activeTab.charAt(0).toUpperCase() + activeTab.slice(1).slice(0, -1)} updated`
    );
    showStatusMessage(successMsg, 'success');
    hasUnsavedChanges = true;
    updateSaveButtonState();
}
