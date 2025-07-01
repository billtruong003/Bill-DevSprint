let gapiInited = false;
let gisInited = false;
let tokenClient;

// Các hằng số cũng nên ở đây
const GOOGLE_API_KEY = 'AIzaSyA5QIxzeDT8DmscH765y_JI2QH-_xa46qg';
const GOOGLE_CLIENT_ID = '841333666544-gq7anebm9p7qkk2o56jvrli5lfen5f9n.apps.googleusercontent.com';
const GOOGLE_SCOPES = 'https://www.googleapis.com/auth/drive.file';

window.gapiLoaded = () => {
    gapi.load('client', async () => {
        await gapi.client.init({
            apiKey: GOOGLE_API_KEY,
            discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'],
        });
        gapiInited = true;
        // Kiểm tra và kích hoạt nút đăng nhập nếu cả hai đã sẵn sàng
        const authBtn = document.getElementById('auth-btn');
        if (authBtn && gisInited) authBtn.disabled = false;
    });
};

window.gisLoaded = () => {
    // Chúng ta sẽ gọi một hàm khởi tạo từ bên trong DOMContentLoaded
    document.dispatchEvent(new CustomEvent('gisDidLoaded'));
    gisInited = true;
    const authBtn = document.getElementById('auth-btn');
    if (authBtn && gapiInited) authBtn.disabled = false;
};

document.addEventListener('DOMContentLoaded', () => {
    // Chờ Quill.js và Sortable.js sẵn sàng
    if (typeof Quill === 'undefined' || typeof Sortable === 'undefined') {
        setTimeout(() => document.dispatchEvent(new Event('DOMContentLoaded')), 100);
        return;
    }

    // #region ELEMENT SELECTORS
    const authScreen = document.getElementById('auth-screen');
    const authBtn = document.getElementById('auth-btn');
    const appContainer = document.getElementById('app-container');
    const globalLoader = document.getElementById('global-loader');
    const globalLoaderText = document.getElementById('global-loader-text');
    const boardContainer = document.getElementById('board-container');
    const boardSwitcher = document.getElementById('board-switcher');
    const currentBoardNameEl = document.getElementById('current-board-name');
    const boardListEl = document.getElementById('board-list');

    const listTemplate = document.getElementById('list-template');
    const cardTemplate = document.getElementById('card-template');
    const addListBtn = document.getElementById('add-list-btn');

    const cardContextMenu = document.getElementById('card-context-menu');
    const listContextMenu = document.getElementById('list-context-menu');

    const settingsBtn = document.getElementById('settings-btn');
    const settingsModal = document.getElementById('settings-modal');
    const themeSwitcher = document.getElementById('theme-switcher');
    const bgImageInput = document.getElementById('bg-image-input');
    const primaryColorPicker = document.getElementById('primary-color-picker');
    const bgAlphaSlider = document.getElementById('bg-image-alpha-slider');
    const labelsListEl = document.getElementById('labels-list');
    const addLabelForm = document.getElementById('add-label-form');
    const logoutBtn = document.getElementById('logout-btn');

    const customThemeControls = document.getElementById('custom-theme-controls');
    const customColorInputs = {
        surface1: document.getElementById('custom-surface-1'),
        surface2: document.getElementById('custom-surface-2'),
        surface3: document.getElementById('custom-surface-3'),
        textPrimary: document.getElementById('custom-text-primary'),
        textSecondary: document.getElementById('custom-text-secondary'),
    };
    const resetCustomThemeBtn = document.getElementById('reset-custom-theme-btn');

    const cardDetailModal = document.getElementById('card-detail-modal');
    const cardDetailTitleHeader = document.getElementById('card-detail-title');
    const cardDetailLabelsContainer = document.getElementById('card-detail-labels-container');
    const cardDetailSaveBtn = document.getElementById('card-detail-save-btn');
    const cardDetailDeleteBtn = document.getElementById('card-detail-delete-btn');
    const cardMetadataContainer = document.getElementById('card-metadata');
    const attachmentsSection = document.getElementById('attachments-section');
    const attachmentsGalleryContainer = document.getElementById('attachments-gallery-container');

    const createBoardModal = document.getElementById('create-board-modal');
    const createBoardForm = document.getElementById('create-board-form');

    const previewModal = document.getElementById('preview-modal');
    const previewContent = document.getElementById('preview-content');
    const previewTitle = document.getElementById('preview-title');
    const wallpaperInfoEl = document.getElementById('wallpaper-info');

    const openWallpaperGalleryBtn = document.getElementById('open-wallpaper-gallery-btn');
    const wallpaperGalleryModal = document.getElementById('wallpaper-gallery-modal');
    const wallpaperGrid = document.getElementById('wallpaper-grid');
    const wallpaperLoader = document.getElementById('wallpaper-loader');
    const wallpaperItemTemplate = document.getElementById('wallpaper-item-template');

    const globalSearchInput = document.getElementById('global-search-input');
    const storageBtn = document.getElementById('storage-btn');
    const storageModal = document.getElementById('storage-modal');
    const storageGrid = document.getElementById('storage-grid');
    const storageEmptyPlaceholder = document.getElementById('storage-empty-placeholder');
    const storageItemTemplate = document.getElementById('storage-item-template');


    // #endregion

    // #region Variables 
    let metaState = {};
    let state = {};

    let quill = null;
    let activeCardDetail = null;
    let activeListMenu = null;
    let isModalDirty = false;
    let blobUrlsToRevoke = [];

    let allWallpapers = [];
    const WALLPAPERS_PER_PAGE = 20;
    let wallpapersLoaded = 0;
    let wallpaperObserver = null;

    let wallpaperSearchInput;
    let filteredWallpapers = [];
    // #endregion

    // #region UI HELPERS
    const showLoader = (text = 'Đang tải...') => {
        globalLoaderText.textContent = text;
        globalLoader.classList.remove('hidden');
    };
    const hideLoader = () => globalLoader.classList.add('hidden');

    function showSavingIndicator() {
        let indicator = document.getElementById('saving-indicator');
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.id = 'saving-indicator';
            indicator.className = 'saving-indicator';
            indicator.textContent = 'Đang lưu...';
            document.body.appendChild(indicator);
        }
        indicator.classList.add('visible');
    }

    function hideSavingIndicator() {
        const indicator = document.getElementById('saving-indicator');
        if (indicator) {
            indicator.classList.remove('visible');
        }
    }
    // #endregion

    // #region GOOGLE DRIVE HELPER
    const driveHelper = {
        APP_FOLDER_NAME: 'BillTaskManagementData',
        META_FILE_NAME: 'meta.json',
        FILES_SUBFOLDER_NAME: 'files',
        appFolderId: null,
        filesFolderId: null,
        metaFileId: null,

        async init() {
            await this.findOrCreateAppFolder();
            await this.findOrCreateFilesFolder();
            return this.loadMetaFile();
        },

        async findItemByName(name, mimeType, parentId = 'root') {
            const query = `name = '${name}' and mimeType = '${mimeType}' and '${parentId}' in parents and trashed = false`;
            const response = await gapi.client.drive.files.list({ q: query, fields: 'files(id, name)' });
            return response.result.files.length > 0 ? response.result.files[0] : null;
        },

        async createFolder(name, parentId = 'root') {
            const metadata = { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] };
            const response = await gapi.client.drive.files.create({ resource: metadata, fields: 'id' });
            return response.result;
        },

        async findOrCreateAppFolder() {
            let folder = await this.findItemByName(this.APP_FOLDER_NAME, 'application/vnd.google-apps.folder');
            if (!folder) folder = await this.createFolder(this.APP_FOLDER_NAME);
            this.appFolderId = folder.id;
        },

        async findOrCreateFilesFolder() {
            let folder = await this.findItemByName(this.FILES_SUBFOLDER_NAME, 'application/vnd.google-apps.folder', this.appFolderId);
            if (!folder) folder = await this.createFolder(this.FILES_SUBFOLDER_NAME, this.appFolderId);
            this.filesFolderId = folder.id;
        },

        async loadMetaFile() {
            const metaFile = await this.findItemByName(this.META_FILE_NAME, 'application/json', this.appFolderId);
            if (metaFile) {
                this.metaFileId = metaFile.id;
                const response = await gapi.client.drive.files.get({ fileId: this.metaFileId, alt: 'media' });
                return JSON.parse(response.body);
            }
            return null;
        },

        async loadBoardFile(fileId) {
            if (!fileId) return null;
            const response = await gapi.client.drive.files.get({ fileId: fileId, alt: 'media' });
            return JSON.parse(response.body);
        },

        async saveFile(fileObject, fileName, parentId, existingFileId = null) {
            showSavingIndicator();
            try {
                const metadata = { name: fileName, mimeType: 'application/json' };
                if (!existingFileId) metadata.parents = [parentId];

                const boundary = '-------314159265358979323846';
                const delimiter = `\r\n--${boundary}\r\n`;
                const close_delim = `\r\n--${boundary}--`;

                const multipartRequestBody =
                    delimiter + 'Content-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(metadata) +
                    delimiter + 'Content-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(fileObject, null, 2) +
                    close_delim;

                const requestPath = existingFileId
                    ? `/upload/drive/v3/files/${existingFileId}?uploadType=multipart`
                    : '/upload/drive/v3/files?uploadType=multipart';

                const response = await gapi.client.request({
                    path: requestPath,
                    method: existingFileId ? 'PATCH' : 'POST',
                    headers: { 'Content-Type': 'multipart/related; boundary="' + boundary + '"' },
                    body: multipartRequestBody
                });

                return response.result;
            } catch (error) {
                console.error(`Error saving ${fileName} to Drive:`, error);
                alert(`Lỗi: Không thể lưu file ${fileName} lên Google Drive.`);
                return null;
            } finally {
                hideSavingIndicator();
            }
        },

        async saveMetaState(metaStateObject) {
            const result = await this.saveFile(metaStateObject, this.META_FILE_NAME, this.appFolderId, this.metaFileId);
            if (result && !this.metaFileId) this.metaFileId = result.id;
        },

        async saveBoardState(boardStateObject, boardFileId) {
            const boardName = `${boardStateObject.id}.json`;
            return await this.saveFile(boardStateObject, boardName, this.appFolderId, boardFileId);
        },

        uploadFile(fileObject, onProgress) {
            return new Promise((resolve, reject) => {
                const metadata = { name: fileObject.name, parents: [this.filesFolderId] };
                const accessToken = gapi.client.getToken().access_token;

                const form = new FormData();
                form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
                form.append('file', fileObject);

                const xhr = new XMLHttpRequest();
                xhr.open('POST', 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart');
                xhr.setRequestHeader('Authorization', 'Bearer ' + accessToken);

                xhr.upload.onprogress = (event) => {
                    if (event.lengthComputable) {
                        const progress = Math.round((event.loaded / event.total) * 100);
                        onProgress(progress);
                    }
                };

                xhr.onload = () => {
                    if (xhr.status === 200) {
                        resolve(JSON.parse(xhr.responseText));
                    } else {
                        reject(new Error(`Upload failed: ${xhr.statusText}`));
                    }
                };

                xhr.onerror = () => reject(new Error('Network error during upload.'));
                xhr.send(form);
            });
        },

        async deleteFile(fileId) {
            try {
                await gapi.client.drive.files.delete({ fileId: fileId });
            } catch (error) {
                console.error(`Failed to delete file ${fileId} from Drive:`, error);
            }
        },

        async getFileAsBlob(fileId) {
            const response = await gapi.client.drive.files.get({ fileId: fileId, alt: 'media' });
            return new Blob([response.body], { type: response.headers['Content-Type'] });
        },

        async getFileAsText(fileId) {
            const response = await gapi.client.drive.files.get({ fileId: fileId, alt: 'media' });
            return response.body;
        }
    };
    // #endregion

    async function handleAuthResponse(tokenResponse) {
        if (tokenResponse.error) {
            alert("Lỗi xác thực Google. Vui lòng thử lại.");
            console.error("Google Auth Error:", tokenResponse.error);
            return;
        }
        gapi.client.setToken(tokenResponse);
        authScreen.style.display = 'none';
        showLoader('Đang khởi tạo ứng dụng...');
        try {
            await startApp();
        } catch (error) {
            console.error("Failed to start app:", error);
            alert("Không thể khởi động ứng dụng. Vui lòng kiểm tra kết nối và thử lại.");
            hideLoader();
            authScreen.style.display = 'flex';
        }
    }

    function initializeGisClient() {
        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: GOOGLE_CLIENT_ID,
            scope: GOOGLE_SCOPES,
            callback: handleAuthResponse, // Bây giờ hàm này đã ở đúng phạm vi
        });
    }

    document.addEventListener('gisDidLoaded', initializeGisClient);

    if (gisInited) {
        initializeGisClient();
    }

    function handleAuthClick() {
        if (gapiInited && gisInited) {
            tokenClient.requestAccessToken({ prompt: 'consent' });
        }
    }

    async function startApp() {
        showLoader('Đang tìm dữ liệu...');
        const loadedMeta = await driveHelper.init();

        if (loadedMeta) {
            metaState = loadedMeta;
        } else {
            showLoader('Thiết lập lần đầu...');
            metaState = { boards: [], activeBoardId: null };
            await handleCreateBoard(null, 'Board đầu tiên');
        }

        if (metaState.activeBoardId) {
            await switchBoard(metaState.activeBoardId);
        } else if (metaState.boards.length > 0) {
            await switchBoard(metaState.boards[0].id);
        } else {
            alert("Không tìm thấy board nào. Vui lòng tạo một board mới.");
            hideLoader();
            appContainer.style.display = 'flex';
        }

        setupCoreEventListeners();
    }

    async function switchBoard(boardId, isNewBoard = false) {
        if (!isNewBoard) showLoader(`Đang tải board...`);

        const boardInfo = metaState.boards.find(b => b.id === boardId);
        if (!boardInfo) {
            alert("Lỗi: Không tìm thấy thông tin board.");
            hideLoader();
            return;
        }

        try {
            const loadedState = await driveHelper.loadBoardFile(boardInfo.fileId);
            if (loadedState) {
                state = loadedState;
                state.lists.forEach(list => {
                    (list.cards || []).forEach(card => {
                        if (!card.createdAt) card.createdAt = Date.now();
                        if (!card.updatedAt) card.updatedAt = card.createdAt;
                        if (card.imageIds && !card.attachments) {
                            card.attachments = card.imageIds.map(id => ({ id, name: 'image.jpg', type: 'image/jpeg' }));
                            delete card.imageIds;
                        }
                        if (!card.attachments) card.attachments = [];
                    });
                });
            } else {
                alert(`Không thể tải dữ liệu cho board "${boardInfo.name}". Có thể file đã bị xoá.`)
                state = getDefaultState(boardId, boardInfo.name);
            }
        } catch (error) {
            console.error("Error loading board file:", error);
            alert(`Đã xảy ra lỗi khi tải board "${boardInfo.name}".`);
            hideLoader();
            return;
        }

        metaState.activeBoardId = boardId;
        await driveHelper.saveMetaState(metaState);

        appContainer.style.display = 'flex';
        hideLoader();

        renderAppUI();
    }

    function renderAppUI() {
        renderBoardSwitcher();
        loadUISettings();
        renderBoard();

        if (window.youtubePlayer) {
            window.youtubePlayer.init(state, saveBoardState);
        }
    }

    function handleLogout() {
        if (!confirm("Bạn có chắc chắn muốn đăng xuất không?")) return;
        const token = gapi.client.getToken();
        if (token) {
            google.accounts.oauth2.revoke(token.access_token, () => {
                gapi.client.setToken(null);
                state = {}; metaState = {};
                appContainer.style.display = 'none';
                authScreen.style.display = 'flex';
                document.body.innerHTML = '<h1>Đã đăng xuất. Vui lòng tải lại trang để đăng nhập.</h1>';
                window.location.reload();
            });
        }
    }
    // #endregion

    // #region STATE MANAGEMENT
    const debounce = (func, delay) => {
        let timeout;
        return function (...args) {
            showSavingIndicator();
            clearTimeout(timeout);
            timeout = setTimeout(() => {
                func.apply(this, args);
            }, delay);
        };
    };

    const debounceUI = (func, delay) => {
        let timeout;
        return function (...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => {
                func.apply(this, args);
            }, delay);
        };
    };

    const saveBoardState = debounce(() => {
        const boardInfo = metaState.boards.find(b => b.id === state.id);
        if (boardInfo) {
            driveHelper.saveBoardState(state, boardInfo.fileId);
        }
    }, 1500);

    const defaultCustomColors = {
        surface1: '#2c2f33',
        surface2: '#23272a',
        surface3: '#1e1f22',
        textPrimary: '#f2f3f5',
        textSecondary: '#b9bbbe'
    };

    function getDefaultState(boardId, boardName) {
        const now = Date.now();
        return {
            id: boardId,
            name: boardName,
            labels: [
                { id: `lbl-${now}-1`, name: "Lỗi", color: "#d93f44" },
                { id: `lbl-${now}-2`, name: "Tính năng", color: "#007aff" },
            ],
            lists: [
                { id: `list-${now}-1`, title: "Cần làm", cards: [{ id: `card-${now}-1`, title: `Chào mừng đến với board ${boardName}!`, description: "<p>Kéo-thả các thẻ để sắp xếp công việc.</p>", labelId: `lbl-${now}-2`, createdAt: now, updatedAt: now, attachments: [] }] },
                { id: `list-${now}-2`, title: "Đang làm", cards: [] },
                { id: `list-${now}-3`, title: "Hoàn thành", cards: [] },
            ],
            uiSettings: {
                theme: 'system',
                primaryColor: '#007aff',
                bgImage: '',
                bgAlpha: 0.3,
                customColors: { ...defaultCustomColors }
            },
            youtubeBookmarks: [] 
        };
    }
    // #endregion

    // #region BOARD MANAGEMENT
    function renderBoardSwitcher() {
        const activeBoard = metaState.boards.find(b => b.id === metaState.activeBoardId);
        currentBoardNameEl.textContent = activeBoard ? activeBoard.name : 'Chọn Board';

        boardListEl.innerHTML = '';
        metaState.boards.forEach(board => {
            const li = document.createElement('li');
            li.textContent = board.name;
            li.dataset.boardId = board.id;
            if (board.id === metaState.activeBoardId) {
                li.classList.add('active');
            }
            li.addEventListener('click', () => switchBoard(board.id));
            boardListEl.appendChild(li);
        });
    }

    async function handleRenameBoard() {
        const activeBoardId = metaState.activeBoardId;
        const boardInfo = metaState.boards.find(b => b.id === activeBoardId);
        if (!boardInfo) return;

        const newName = prompt("Nhập tên mới cho board:", boardInfo.name);

        if (newName && newName.trim() && newName.trim() !== boardInfo.name) {
            const trimmedName = newName.trim();
            showLoader(`Đang đổi tên board thành "${trimmedName}"...`);

            state.name = trimmedName;
            boardInfo.name = trimmedName;

            try {
                await Promise.all([
                    driveHelper.saveBoardState(state, boardInfo.fileId),
                    driveHelper.saveMetaState(metaState)
                ]);

                renderBoardSwitcher();
                hideLoader();
            } catch (error) {
                console.error("Lỗi khi đổi tên board:", error);
                alert("Đã có lỗi xảy ra khi đổi tên board. Vui lòng thử lại.");
                state.name = boardInfo.name;
                boardInfo.name = boardInfo.name;
                hideLoader();
            }
        }
    }

    async function handleDeleteBoard() {
        const activeBoardId = metaState.activeBoardId;
        const boardInfo = metaState.boards.find(b => b.id === activeBoardId);
        if (!boardInfo) return;

        if (!confirm(`Hành động này không thể hoàn tác!\n\nBạn có chắc chắn muốn xóa vĩnh viễn board "${boardInfo.name}" không? Toàn bộ dữ liệu, bao gồm cả các tệp đính kèm, sẽ bị xóa khỏi Google Drive của bạn.`)) {
            return;
        }

        showLoader(`Đang xóa board "${boardInfo.name}"...`);

        try {
            const boardStateToDelete = await driveHelper.loadBoardFile(boardInfo.fileId);
            if (boardStateToDelete && boardStateToDelete.lists) {
                const attachmentIds = boardStateToDelete.lists.flatMap(
                    list => (list.cards || []).flatMap(card => (card.attachments || []).map(att => att.id))
                );
                const deletePromises = attachmentIds.map(id => driveHelper.deleteFile(id));
                await Promise.all(deletePromises);
            }

            await driveHelper.deleteFile(boardInfo.fileId);

            const boardIndex = metaState.boards.findIndex(b => b.id === activeBoardId);
            metaState.boards.splice(boardIndex, 1);

            let nextBoardId = null;
            if (metaState.boards.length > 0) {
                nextBoardId = (metaState.boards[boardIndex] || metaState.boards[0]).id;
            }

            metaState.activeBoardId = nextBoardId;

            await driveHelper.saveMetaState(metaState);

            if (nextBoardId) {
                await switchBoard(nextBoardId);
            } else {
                hideLoader();
                await handleCreateBoard(null, 'Board đầu tiên');
            }
        } catch (error) {
            console.error("Lỗi khi xóa board:", error);
            alert("Đã có lỗi xảy ra trong quá trình xóa board. Vui lòng thử lại.");
            hideLoader();
        }
    }

    async function handleCreateBoard(e, defaultName = '') {
        if (e) e.preventDefault();
        const input = document.getElementById('new-board-name-input');
        const boardName = defaultName || input.value.trim();

        if (!boardName) return;

        showLoader('Đang tạo board mới...');
        closeModal(createBoardModal);
        input.value = '';

        const boardId = `board_${Date.now()}`;
        const newBoardState = getDefaultState(boardId, boardName);

        const savedFile = await driveHelper.saveBoardState(newBoardState, null);
        if (!savedFile) {
            alert('Không thể tạo board mới. Vui lòng thử lại.');
            hideLoader();
            return;
        }

        const newBoardInfo = {
            id: boardId,
            name: boardName,
            fileId: savedFile.id,
        };

        metaState.boards.push(newBoardInfo);
        await switchBoard(boardId, true);
    }
    // #endregion

    // #region RENDERING & DOM
    function renderBoard() {
        boardContainer.innerHTML = '';
        (state.lists || []).forEach(listData => boardContainer.appendChild(createListElement(listData)));
        new Sortable(boardContainer, {
            group: 'lists', animation: 150, handle: '.list-header', ghostClass: 'sortable-ghost',
            filter: '.list-title-input, .list-action-btn', preventOnFilter: true, onEnd: handleListDragEnd
        });
    }

    function createListElement(listData) {
        const listEl = document.importNode(listTemplate.content, true).firstElementChild;
        listEl.dataset.listId = listData.id;
        const listTitleText = listEl.querySelector('.list-title-text');
        listTitleText.textContent = listData.title;
        listTitleText.addEventListener('dblclick', () => editTitle(listTitleText, listData.id, 'list'));
        listEl.querySelector('.card-count').textContent = `(${(listData.cards || []).length})`;
        listEl.querySelector('.delete-list-btn').addEventListener('click', () => deleteList(listData.id));
        listEl.querySelector('.list-options-btn').addEventListener('click', (e) => showListContextMenu(e, listData.id));
        const cardsContainer = listEl.querySelector('.cards-container');
        (listData.cards || []).forEach(cardData => cardsContainer.appendChild(createCardElement(cardData, listData.id)));
        new Sortable(cardsContainer, {
            group: 'cards', animation: 150, ghostClass: 'sortable-ghost', chosenClass: 'sortable-chosen',
            filter: '.card-title-input, .edit-card-btn', preventOnFilter: true, onEnd: handleCardDragEnd
        });
        listEl.querySelector('.add-card-btn').addEventListener('click', () => showAddCardForm(listEl));
        listEl.querySelector('.add-card-cancel-btn').addEventListener('click', () => hideAddCardForm(listEl));
        listEl.querySelector('.add-card-submit-btn').addEventListener('click', () => handleAddCard(listData.id, listEl));
        return listEl;
    }

    function createCardElement(cardData, listId) {
        const cardEl = document.importNode(cardTemplate.content, true).firstElementChild;
        cardEl.dataset.cardId = cardData.id;
        cardEl.dataset.listId = listId;
        updateCardDisplay(cardEl, cardData);
        const handleCardClick = (e) => {
            if (e.target.closest('.card-action-btn') || e.target.closest('.card-title-input')) return;
            openCardDetailModal(cardData.id, listId);
        };
        cardEl.addEventListener('click', handleCardClick);
        cardEl.querySelector('.card-title-text').addEventListener('dblclick', (e) => {
            e.stopPropagation();
            editTitle(e.target, cardData.id, 'card', listId);
        });
        cardEl.addEventListener('contextmenu', e => showCardContextMenu(e, cardData.id, listId));
        const editBtn = cardEl.querySelector('.edit-card-btn');
        editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const titleTextEl = cardEl.querySelector('.card-title-text');
            editTitle(titleTextEl, cardData.id, 'card', listId);
        });
        return cardEl;
    }

    function updateCardDisplay(cardEl, cardData) {
        const label = state.labels.find(l => l.id === cardData.labelId);
        cardEl.querySelector('.card-label-strip').style.backgroundColor = label ? label.color : 'transparent';
        cardEl.querySelector('.card-title-text').textContent = cardData.title;
    }

    function reRenderList(listId) {
        const listData = state.lists.find(l => l.id === listId);
        const oldListEl = boardContainer.querySelector(`[data-list-id="${listId}"]`);
        if (listData && oldListEl) {
            const newListEl = createListElement(listData);
            boardContainer.replaceChild(newListEl, oldListEl);
        }
    }

    function handleGlobalSearch() {
        const searchTerm = normalizeVietnamese(globalSearchInput.value.toLowerCase().trim());
        const allListElements = boardContainer.querySelectorAll('.list');

        // Nếu không có từ khóa, hiện tất cả và thoát
        if (!searchTerm) {
            allListElements.forEach(listEl => {
                listEl.classList.remove('hidden');
                const cards = listEl.querySelectorAll('.card');
                if (cards) cards.forEach(cardEl => cardEl.classList.remove('hidden'));
            });
            document.body.classList.remove('is-searching');
            return;
        }

        document.body.classList.add('is-searching');

        allListElements.forEach(listEl => {
            const listId = listEl.dataset.listId;
            const listData = state.lists.find(l => l.id === listId);
            if (!listData) return; // Bỏ qua nếu không tìm thấy dữ liệu

            let listHasVisibleCards = false;

            // Tìm kiếm trong các thẻ của cột này
            const allCardElements = listEl.querySelectorAll('.card');
            if (allCardElements.length > 0) {
                allCardElements.forEach(cardEl => {
                    const cardId = cardEl.dataset.cardId;
                    // Dùng (listData.cards || []) để tránh lỗi khi list không có thẻ
                    const cardData = (listData.cards || []).find(c => c.id === cardId);

                    // Nếu không tìm thấy card data (trường hợp hiếm), ẩn nó đi
                    if (!cardData) {
                        cardEl.classList.add('hidden');
                        return;
                    }

                    // Lấy text từ description để tìm kiếm
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = cardData.description || '';
                    const descriptionText = tempDiv.textContent || '';

                    const cardTitle = normalizeVietnamese(cardData.title.toLowerCase());
                    const cardDesc = normalizeVietnamese(descriptionText.toLowerCase());

                    if (cardTitle.includes(searchTerm) || cardDesc.includes(searchTerm)) {
                        cardEl.classList.remove('hidden');
                        listHasVisibleCards = true;
                    } else {
                        cardEl.classList.add('hidden');
                    }
                });
            }

            // Kiểm tra xem tiêu đề cột có khớp không
            const listTitle = normalizeVietnamese(listData.title.toLowerCase());
            if (listTitle.includes(searchTerm) || listHasVisibleCards) {
                listEl.classList.remove('hidden');
            } else {
                listEl.classList.add('hidden');
            }
        });
    }
    // #endregion

    // #region CORE LOGIC (LISTS & CARDS)
    function addList() {
        const newList = { id: `list-${Date.now()}`, title: "Cột mới", cards: [] };
        state.lists.push(newList);
        saveBoardState();
        const listEl = createListElement(newList);
        boardContainer.appendChild(listEl);
        editTitle(listEl.querySelector('.list-title-text'), newList.id, 'list');
    }

    function deleteList(listId) {
        const list = state.lists.find(l => l.id === listId);
        if (!list || !confirm(`Xóa cột "${list.title}"? Thao tác này sẽ xóa vĩnh viễn tất cả các thẻ bên trong.`)) return;

        const filesToDelete = (list.cards || []).flatMap(card => (card.attachments || []).map(att => att.id));
        filesToDelete.forEach(fileId => driveHelper.deleteFile(fileId));

        state.lists = state.lists.filter(l => l.id !== listId);
        saveBoardState();
        boardContainer.querySelector(`[data-list-id="${listId}"]`)?.remove();
    }

    function handleAddCard(listId, listEl) {
        const textarea = listEl.querySelector('.add-card-textarea');
        const title = textarea.value.trim();
        if (title) {
            const now = Date.now();
            const newCard = { id: `card-${now}`, title, description: "", labelId: null, createdAt: now, updatedAt: now, attachments: [] };
            const list = state.lists.find(l => l.id === listId);
            if (!list.cards) list.cards = [];
            list.cards.push(newCard);
            saveBoardState();
            reRenderList(listId);
            textarea.value = '';
            textarea.focus();
        }
    }

    function updateCard(listId, cardId, updates) {
        const list = state.lists.find(l => l.id === listId);
        const card = list?.cards.find(c => c.id === cardId);
        if (card) {
            Object.assign(card, updates, { updatedAt: Date.now() });
            saveBoardState();
            return card;
        }
        return null;
    }

    async function deleteCard(cardId, listId) {
        const list = state.lists.find(l => l.id === listId);
        if (!list) return;

        const cardIndex = list.cards.findIndex(c => c.id === cardId);
        if (cardIndex > -1) {
            const card = list.cards[cardIndex];
            if (card && card.attachments) {
                const deletePromises = card.attachments.map(att => driveHelper.deleteFile(att.id));
                await Promise.all(deletePromises);
            }
            list.cards.splice(cardIndex, 1);
            saveBoardState();
            reRenderList(listId);
        }
    }
    // #endregion

    // #region INLINE EDITING & DRAG-DROP
    function editTitle(element, id, type, listId = null) {
        element.style.display = 'none';
        const input = document.createElement('input');
        input.type = 'text';
        input.value = element.textContent;
        input.className = type === 'list' ? 'list-title-input' : 'card-title-input';
        element.parentNode.insertBefore(input, element);
        input.focus();
        input.select();
        const save = () => {
            const newTitle = input.value.trim();
            if (type === 'list') {
                const list = state.lists.find(l => l.id === id);
                if (newTitle && list) {
                    list.title = newTitle;
                    element.textContent = newTitle;
                    saveBoardState();
                } else {
                    element.textContent = list.title;
                }
            } else {
                const list = state.lists.find(l => l.id === listId);
                const card = list?.cards.find(c => c.id === id);
                if (newTitle && card) {
                    updateCard(listId, id, { title: newTitle });
                    element.textContent = newTitle;
                } else {
                    element.textContent = card.title;
                }
            }
            input.remove();
            element.style.display = '';
        };
        input.addEventListener('blur', save);
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') input.blur();
            if (e.key === 'Escape') { input.value = element.textContent; input.blur(); }
        });
    }

    function handleCardDragEnd(evt) {
        const cardId = evt.item.dataset.cardId;
        const fromListId = evt.from.closest('.list').dataset.listId;
        const toListId = evt.to.closest('.list').dataset.listId;
        const newIndex = evt.newDraggableIndex;
        const fromList = state.lists.find(l => l.id === fromListId);
        const cardIndex = fromList.cards.findIndex(c => c.id === cardId);
        const [card] = fromList.cards.splice(cardIndex, 1);
        card.updatedAt = Date.now();
        const toList = state.lists.find(l => l.id === toListId);
        toList.cards.splice(newIndex, 0, card);
        saveBoardState();
        reRenderList(fromListId);
        if (fromListId !== toListId) reRenderList(toListId);
    }

    function handleListDragEnd(evt) {
        const [movedList] = state.lists.splice(evt.oldDraggableIndex, 1);
        state.lists.splice(evt.newDraggableIndex, 0, movedList);
        saveBoardState();
    }
    // #endregion

    // #region CONTEXT MENUS & LIST SORTING
    function normalizeVietnamese(str) {
        if (typeof str !== 'string') return str;
        return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
    }
    function showCardContextMenu(e, cardId, listId) {
        e.preventDefault(); e.stopPropagation(); hideContextMenus();
        activeListMenu = { cardId, listId };
        cardContextMenu.style.top = `${e.clientY}px`; cardContextMenu.style.left = `${e.clientX}px`;
        cardContextMenu.classList.remove('hidden');
        document.addEventListener('click', hideContextMenus, { once: true });
    }
    function showListContextMenu(e, listId) {
        e.preventDefault(); e.stopPropagation(); hideContextMenus();
        activeListMenu = { listId };
        listContextMenu.style.top = `${e.clientY}px`; listContextMenu.style.left = `${e.clientX}px`;
        listContextMenu.classList.remove('hidden');
        document.addEventListener('click', hideContextMenus, { once: true });
    }
    function hideContextMenus() {
        cardContextMenu.classList.add('hidden'); listContextMenu.classList.add('hidden');
        activeListMenu = null;
    }
    cardContextMenu.addEventListener('click', e => {
        const action = e.target.dataset.action;
        if (!action || !activeListMenu) return;
        const { cardId, listId } = activeListMenu;
        if (action === 'details') openCardDetailModal(cardId, listId);
        if (action === 'delete' && confirm('Bạn chắc chắn muốn xóa vĩnh viễn thẻ này?')) deleteCard(cardId, listId);
        hideContextMenus();
    });
    listContextMenu.addEventListener('click', e => {
        const actionTarget = e.target.closest('li[data-action]');
        if (!actionTarget || !activeListMenu) return;

        const action = actionTarget.dataset.action;
        const { listId } = activeListMenu;

        if (action.startsWith('sort-')) {
            sortList(listId, action.replace('sort-', ''));
        } else if (action === 'delete-all-cards') {
            const list = state.lists.find(l => l.id === listId);
            if (list && confirm(`Bạn chắc chắn muốn xóa vĩnh viễn tất cả ${list.cards.length} thẻ trong cột "${list.title}"?`)) {
                const filesToDelete = (list.cards || []).flatMap(card => (card.attachments || []).map(att => att.id));
                const deletePromises = filesToDelete.map(fileId => driveHelper.deleteFile(fileId));
                Promise.all(deletePromises).then(() => {
                    list.cards = [];
                    saveBoardState();
                    reRenderList(listId);
                });
            }
        } else if (action === 'delete-list') {
            deleteList(listId);
        }

        hideContextMenus();
    });
    function sortList(listId, criteria) {
        const list = state.lists.find(l => l.id === listId);
        if (!list || !list.cards) return;
        const [field, order] = criteria.split('-');
        list.cards.sort((a, b) => {
            let valA = a[field], valB = b[field];
            if (typeof valA === 'string' && field === 'title') {
                valA = normalizeVietnamese(valA.toLowerCase()); valB = normalizeVietnamese(valB.toLowerCase());
            }
            if (valA < valB) return order === 'asc' ? -1 : 1;
            if (valA > valB) return order === 'asc' ? 1 : -1;
            return 0;
        });
        saveBoardState(); reRenderList(listId);
    }
    // #endregion

    // #region CARD DETAIL MODAL, QUILL, & ATTACHMENTS
    function openCardDetailModal(cardId, listId) {
        const list = state.lists.find(l => l.id === listId);
        const card = list?.cards.find(c => c.id === cardId);
        if (!card) return;
        activeCardDetail = { cardId, listId };
        isModalDirty = false;
        cardDetailTitleHeader.textContent = card.title;
        renderCardDetailLabels(card.labelId);
        renderCardMetadata(card);
        if (quill) quill = null;
        quill = new Quill('#card-detail-description', {
            modules: { toolbar: '#quill-toolbar' },
            placeholder: 'Thêm mô tả chi tiết...', theme: 'snow'
        });
        quill.on('text-change', () => { isModalDirty = true; });
        if (card.description) quill.root.innerHTML = card.description;

        attachmentsSection.style.display = 'block';
        renderAttachmentsGallery(card.attachments || []);

        attachQuillCustomHandlers();
        setupQuillDropZone();

        cardDetailModal.classList.remove('hidden');
        quill.focus();
    }

    async function renderAttachmentsGallery(attachments) {
        attachmentsGalleryContainer.innerHTML = '';

        if (!attachments || attachments.length === 0) {
            const placeholder = document.createElement('div');
            placeholder.className = 'gallery-item gallery-item-upload-placeholder';
            placeholder.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                <span>Thêm tệp</span>
            `;
            placeholder.addEventListener('click', () => {
                document.getElementById('quill-attach-file-btn').click();
            });
            attachmentsGalleryContainer.appendChild(placeholder);
            return;
        }

        for (const attachment of attachments) {
            const item = document.createElement('div');
            item.className = 'gallery-item';
            item.dataset.attachmentId = attachment.id;
            item.dataset.attachmentData = JSON.stringify(attachment);
            item.setAttribute('draggable', 'true');
            item.addEventListener('dragstart', handleAttachmentDragStart);

            let itemContent = `<div class="spinner-small"></div>`;
            item.innerHTML = itemContent;
            attachmentsGalleryContainer.appendChild(item);

            if (attachment.type.startsWith('image/')) {
                try {
                    const blob = await driveHelper.getFileAsBlob(attachment.id);
                    const url = URL.createObjectURL(blob);
                    blobUrlsToRevoke.push(url);
                    itemContent = `<img src="${url}" alt="${attachment.name}">`;
                } catch {
                    itemContent = '<span class="gallery-error" title="Lỗi tải ảnh">⚠️</span>';
                }
            } else {
                const fileIcon = getFileIconSVG(attachment.type);
                itemContent = `<div class="file-icon">${fileIcon}</div><div class="file-name" title="${attachment.name}">${attachment.name}</div>`;
                item.classList.add('file-type-item');
            }
            item.innerHTML = `
                ${itemContent}
                <div class="gallery-item-overlay">
                    <button class="gallery-delete-btn" title="Xóa tệp">×</button>
                </div>
                <div class="attachment-progress-bar"></div>
            `;

            item.addEventListener('click', (e) => {
                if (e.target.closest('.gallery-delete-btn')) return;
                openPreviewModal(attachment);
            });

            item.querySelector('.gallery-delete-btn').addEventListener('click', async (e) => {
                e.stopPropagation();
                if (confirm(`Bạn chắc chắn muốn xóa tệp "${attachment.name}"?`)) {
                    item.remove();
                    const card = state.lists.find(l => l.id === activeCardDetail.listId).cards.find(c => c.id === activeCardDetail.cardId);
                    const attachmentIndex = card.attachments.findIndex(att => att.id === attachment.id);
                    if (attachmentIndex > -1) {
                        card.attachments.splice(attachmentIndex, 1);
                    }
                    isModalDirty = true;
                    await driveHelper.deleteFile(attachment.id);
                    renderAttachmentsGallery(card.attachments);
                }
            });
        }
    }

    function attachQuillCustomHandlers() {
        document.getElementById('quill-attach-file-btn').onclick = () => {
            const input = document.createElement('input');
            input.type = 'file'; input.multiple = true;
            input.onchange = e => {
                const card = state.lists.find(l => l.id === activeCardDetail.listId).cards.find(c => c.id === activeCardDetail.cardId);
                renderAttachmentsGallery(card.attachments);
                for (const file of e.target.files) handleFileUpload(file);
            };
            input.click();
        };
        quill.root.addEventListener('paste', handleQuillPaste);
        document.getElementById('quill-uppercase-btn').onclick = () => transformSelection('uppercase');
        document.getElementById('quill-lowercase-btn').onclick = () => transformSelection('lowercase');
    }

    function setupQuillDropZone() {
        const editorEl = quill.root;
        const dragEvents = ['dragenter', 'dragover', 'dragleave', 'drop'];
        dragEvents.forEach(eventName => editorEl.addEventListener(eventName, e => e.preventDefault()));
        editorEl.addEventListener('dragenter', () => editorEl.classList.add('drop-target'));
        editorEl.addEventListener('dragleave', (e) => {
            if (e.target === editorEl || !editorEl.contains(e.relatedTarget)) {
                editorEl.classList.remove('drop-target');
            }
        });
        editorEl.addEventListener('drop', (e) => {
            editorEl.classList.remove('drop-target');
            const attachmentJSON = e.dataTransfer.getData('application/json');
            if (attachmentJSON) {
                const attachment = JSON.parse(attachmentJSON);
                insertAttachmentPill(attachment, quill.getSelection(true).index);
                isModalDirty = true;
            } else if (e.dataTransfer.files.length > 0) {
                for (const file of e.dataTransfer.files) {
                    handleFileUpload(file);
                }
            }
        });
    }

    function handleAttachmentDragStart(e) {
        e.dataTransfer.setData('application/json', e.currentTarget.dataset.attachmentData);
        e.dataTransfer.effectAllowed = 'copy';
    }

    function insertAttachmentPill(attachment, index) {
        const fileIcon = getFileIconSVG(attachment.type);
        const pillHTML = `<a href="https://docs.google.com/uc?id=${attachment.id}" target="_blank" class="file-attachment" data-file-id="${attachment.id}" title="${attachment.name}">${fileIcon}<span class="file-attachment-name">${attachment.name}</span></a>`;
        quill.clipboard.dangerouslyPasteHTML(index, pillHTML, 'user');
        quill.insertText(quill.getSelection().index, ' ', 'user');
    }

    function transformSelection(mode) {
        const range = quill.getSelection(true);
        if (range && range.length > 0) {
            const text = quill.getText(range.index, range.length);
            const transformed = mode === 'uppercase' ? text.toUpperCase() : text.toLowerCase();
            quill.deleteText(range.index, range.length);
            quill.insertText(range.index, transformed, 'user');
            quill.setSelection(range.index, range.length);
        }
    }

    async function handleQuillPaste(e) {
        if (e.clipboardData && e.clipboardData.files.length > 0) {
            e.preventDefault();
            for (const file of e.clipboardData.files) {
                handleFileUpload(file);
            }
        }
    }

    function handleFileUpload(file) {
        const tempId = `temp_${Date.now()}`;
        const item = document.createElement('div');
        item.className = 'gallery-item uploading';
        item.id = tempId;
        const fileIcon = getFileIconSVG(file.type);
        item.innerHTML = `
            <div class="file-icon">${fileIcon}</div>
            <div class="file-name" title="${file.name}">${file.name}</div>
            <div class="gallery-item-overlay"></div>
            <div class="attachment-progress-bar" style="width: 0%;"></div>
        `;
        const placeholder = attachmentsGalleryContainer.querySelector('.gallery-item-upload-placeholder');
        if (placeholder) placeholder.remove();

        attachmentsGalleryContainer.appendChild(item);

        const onProgress = (progress) => {
            const progressBar = item.querySelector('.attachment-progress-bar');
            if (progressBar) progressBar.style.width = `${progress}%`;
        };

        driveHelper.uploadFile(file, onProgress)
            .then(driveFile => {
                const card = state.lists.find(l => l.id === activeCardDetail.listId).cards.find(c => c.id === activeCardDetail.cardId);
                const newAttachment = { id: driveFile.id, name: driveFile.name, type: file.type };

                if (!card.attachments) card.attachments = [];
                card.attachments.push(newAttachment);
                isModalDirty = true;
                renderAttachmentsGallery(card.attachments);
            })
            .catch(error => {
                console.error("Lỗi tải tệp lên:", error);
                alert(`Không thể tải tệp "${file.name}".`);
                document.getElementById(tempId)?.remove();
                const card = state.lists.find(l => l.id === activeCardDetail.listId).cards.find(c => c.id === activeCardDetail.cardId);
                renderAttachmentsGallery(card.attachments);
            });
    }

    function getFileIconSVG(fileType) {
        if (fileType.startsWith('image/')) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>`;
        if (fileType.startsWith('video/')) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>`;
        if (fileType.startsWith('audio/')) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>`;
        if (fileType.includes('pdf')) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`;
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>`;
    }

    function saveCardDetails() {
        if (!activeCardDetail || !quill) return;
        const { cardId, listId } = activeCardDetail;
        const card = state.lists.find(l => l.id === listId).cards.find(c => c.id === cardId);

        const updates = {
            description: quill.root.innerHTML,
            labelId: cardDetailLabelsContainer.querySelector('.label-item.selected')?.dataset.labelId || null,
            attachments: card.attachments
        };
        const updatedCard = updateCard(listId, cardId, updates);
        if (updatedCard) {
            const cardEl = document.querySelector(`[data-card-id="${cardId}"]`);
            if (cardEl) updateCardDisplay(cardEl, updatedCard);
        }
        isModalDirty = false;
        closeModal(cardDetailModal);
    }
    cardDetailSaveBtn.addEventListener('click', saveCardDetails);
    cardDetailDeleteBtn.addEventListener('click', () => {
        if (activeCardDetail && confirm('Xóa thẻ này vĩnh viễn?')) {
            deleteCard(activeCardDetail.cardId, activeCardDetail.listId);
            closeModal(cardDetailModal);
        }
    });

    function renderCardMetadata(card) {
        const createdAt = new Date(card.createdAt).toLocaleString();
        const updatedAt = new Date(card.updatedAt).toLocaleString();
        cardMetadataContainer.innerHTML = `<dt>Đã tạo:</dt><dd>${createdAt}</dd><dt>Cập nhật:</dt><dd>${updatedAt}</dd>`;
    }

    function renderCardDetailLabels(selectedLabelId) {
        cardDetailLabelsContainer.innerHTML = '';
        if (state.labels.length === 0) {
            cardDetailLabelsContainer.innerHTML = '<p>Không có nhãn.</p>'; return;
        }
        state.labels.forEach(label => {
            const labelEl = document.createElement('div');
            labelEl.className = 'label-item';
            if (label.id === selectedLabelId) labelEl.classList.add('selected');
            labelEl.dataset.labelId = label.id;
            labelEl.innerHTML = `<span class="label-color-dot" style="background-color: ${label.color};"></span><span>${label.name}</span>`;
            labelEl.addEventListener('click', () => {
                isModalDirty = true;
                const currentSelected = cardDetailLabelsContainer.querySelector('.selected');
                if (currentSelected) currentSelected.classList.remove('selected');
                if (!currentSelected || currentSelected.dataset.labelId !== label.id) {
                    labelEl.classList.add('selected');
                }
            });
            cardDetailLabelsContainer.appendChild(labelEl);
        });
    }
    // #endregion

    // #region PREVIEW MODAL (LIGHTBOX)
    async function openPreviewModal(attachment) {
        previewTitle.textContent = attachment.name;
        previewContent.innerHTML = `<div class="spinner"></div>`;

        const downloadBtn = document.getElementById('media-viewer-download-btn');
        const downloadUrl = `https://docs.google.com/uc?export=download&id=${attachment.id}`;
        downloadBtn.href = downloadUrl;
        downloadBtn.download = attachment.name;

        previewModal.classList.remove('hidden');

        try {
            if (attachment.type.startsWith('image/')) {
                const blob = await driveHelper.getFileAsBlob(attachment.id);
                const url = URL.createObjectURL(blob);
                blobUrlsToRevoke.push(url);
                previewContent.innerHTML = `<img src="${url}" alt="${attachment.name}">`;
            } else if (attachment.type.startsWith('video/')) {
                const blob = await driveHelper.getFileAsBlob(attachment.id);
                const url = URL.createObjectURL(blob);
                blobUrlsToRevoke.push(url);
                previewContent.innerHTML = `<video src="${url}" controls autoplay></video>`;
            } else if (attachment.type.startsWith('audio/')) {
                const blob = await driveHelper.getFileAsBlob(attachment.id);
                const url = URL.createObjectURL(blob);
                blobUrlsToRevoke.push(url);
                previewContent.innerHTML = `<audio src="${url}" controls autoplay></audio>`;
            } else if (attachment.type.startsWith('text/')) {
                const text = await driveHelper.getFileAsText(attachment.id);
                previewContent.innerHTML = `<pre>${text.replace(/</g, "<").replace(/>/g, ">")}</pre>`;
            } else {
                previewContent.innerHTML = `<div class="preview-unsupported">
                    <p>Không hỗ trợ xem trước cho loại tệp này.</p>
                    <a href="${downloadUrl}" target="_blank" rel="noopener noreferrer" class="primary-btn">Tải xuống hoặc mở trong Drive</a>
                 </div>`;
            }
        } catch (error) {
            console.error("Lỗi khi xem trước tệp:", error);
            previewContent.innerHTML = `<div class="preview-unsupported"><p>Đã xảy ra lỗi khi tải tệp để xem trước.</p></div>`;
        }
    }

    function closePreviewModal() {
        previewModal.classList.add('hidden');
        previewContent.innerHTML = '';
    }
    // #endregion

    // #region SETTINGS & UI
    function openSettingsModal() { renderLabelsList(); settingsModal.classList.remove('hidden'); }
    function closeModal(modal) {
        if (modal === cardDetailModal && isModalDirty) {
            if (!confirm("Bạn có các thay đổi chưa được lưu. Bạn có muốn đóng và hủy bỏ chúng không?")) {
                return;
            }
        }
        modal.classList.add('hidden');
        if (modal === cardDetailModal) {
            quill = null; activeCardDetail = null; isModalDirty = false;
            blobUrlsToRevoke.forEach(url => URL.revokeObjectURL(url));
            blobUrlsToRevoke = [];
        }
        if (modal === previewModal) {
            closePreviewModal();
        }
        if (modal === wallpaperGalleryModal) {
            if (wallpaperSearchInput) {
                wallpaperSearchInput.removeEventListener('input', handleWallpaperSearch);
            }
            if (wallpaperObserver) {
                wallpaperObserver.disconnect();
                wallpaperObserver = null;
            }
        }
    }

    function renderLabelsList() {
        labelsListEl.innerHTML = '';
        (state.labels || []).forEach(label => {
            const li = document.createElement('li');
            li.innerHTML = `<div class="label-info"><span class="label-color-dot" style="background-color: ${label.color};"></span><span>${label.name}</span></div><button class="label-delete-btn" data-label-id="${label.id}" aria-label="Xóa nhãn">×</button>`;
            labelsListEl.appendChild(li);
        });
    }

    function handleAddLabel(e) {
        e.preventDefault();
        const nameInput = document.getElementById('new-label-name');
        const colorInput = document.getElementById('new-label-color');
        const name = nameInput.value.trim();
        if (name) {
            if (!state.labels) state.labels = [];
            state.labels.push({ id: `lbl-${Date.now()}`, name, color: colorInput.value });
            saveBoardState(); renderLabelsList(); nameInput.value = '';
        }
    }

    function handleDeleteLabel(e) {
        if (!e.target.classList.contains('label-delete-btn')) return;
        const labelId = e.target.dataset.labelId;
        const label = state.labels.find(l => l.id === labelId);
        if (confirm(`Xóa nhãn "${label.name}"? Thao tác này sẽ xóa nhãn khỏi tất cả các thẻ.`)) {
            state.labels = state.labels.filter(l => l.id !== labelId);
            state.lists.forEach(list => list.cards.forEach(card => {
                if (card.labelId === labelId) card.labelId = null;
            }));
            saveBoardState(); renderLabelsList(); renderBoard();
        }
    }

    function hexToHSL(H) { let r = 0, g = 0, b = 0; if (H.length == 4) { r = "0x" + H[1] + H[1]; g = "0x" + H[2] + H[2]; b = "0x" + H[3] + H[3] } else if (H.length == 7) { r = "0x" + H[1] + H[2]; g = "0x" + H[3] + H[4]; b = "0x" + H[5] + H[6] } r /= 255; g /= 255; b /= 255; let cmin = Math.min(r, g, b), cmax = Math.max(r, g, b), delta = cmax - cmin, h = 0, s = 0, l = 0; l = (cmax + cmin) / 2; if (delta == 0) h = s = 0; else { s = l > .5 ? delta / (2 - cmax - cmin) : delta / (cmax + cmin); switch (cmax) { case r: h = (g - b) / delta + (g < b ? 6 : 0); break; case g: h = (b - r) / delta + 2; break; case b: h = (r - g) / delta + 4; break }h /= 6 } h = Math.round(h * 360); s = Math.round(s * 100); return { h, s } }
    function updatePrimaryColor(hexColor) { const { h, s } = hexToHSL(hexColor); document.documentElement.style.setProperty('--primary-hue', h); document.documentElement.style.setProperty('--primary-saturation', `${s}%`); }

    function applyTheme(themeName) {
        const root = document.documentElement;
        root.style.cssText = '';
        root.className = '';

        if (themeName === 'light') {
            root.classList.add('light-theme');
        } else if (themeName === 'dark') {
            root.classList.add('dark-theme');
        } else if (themeName === 'custom') {
            applyCustomTheme(state.uiSettings.customColors);
        }
    }

    function applyCustomTheme(colors) {
        const root = document.documentElement;

        root.style.setProperty('--surface-1', colors.surface1);
        root.style.setProperty('--surface-2', colors.surface2);
        root.style.setProperty('--surface-3', colors.surface3);
        root.style.setProperty('--text-primary', colors.textPrimary);
        root.style.setProperty('--text-secondary', colors.textSecondary);

        const hexColor = colors.surface3;
        const r = parseInt(hexColor.slice(1, 3), 16);
        const g = parseInt(hexColor.slice(3, 5), 16);
        const b = parseInt(hexColor.slice(5, 7), 16);
        const brightness = ((r * 299) + (g * 587) + (b * 114)) / 1000;

        root.classList.remove('light-theme', 'dark-theme');
        root.classList.add(brightness > 128 ? 'light-theme' : 'dark-theme');
    }

    function toggleCustomThemeControls(show) {
        customThemeControls.classList.toggle('hidden', !show);
    }

    function handleSystemThemeChange(e) { if (themeSwitcher.value === 'system') applyTheme(e.matches ? 'dark' : 'light'); }

    function saveUISettings() {
        if (!state.uiSettings) state.uiSettings = {};
        const settings = state.uiSettings;
        settings.theme = themeSwitcher.value;
        settings.primaryColor = primaryColorPicker.value;
        settings.bgImage = bgImageInput.value.trim();
        settings.bgAlpha = bgAlphaSlider.value;

        if (settings.theme === 'custom') {
            settings.customColors = {
                surface1: customColorInputs.surface1.value,
                surface2: customColorInputs.surface2.value,
                surface3: customColorInputs.surface3.value,
                textPrimary: customColorInputs.textPrimary.value,
                textSecondary: customColorInputs.textSecondary.value,
            };
        }
        saveBoardState();
    }

    function loadUISettings() {
        const settings = state.uiSettings || getDefaultState('', '').uiSettings;
        if (!settings.customColors) settings.customColors = { ...defaultCustomColors };

        themeSwitcher.value = settings.theme;
        const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)');

        if (settings.theme === 'system') {
            applyTheme(systemPrefersDark.matches ? 'dark' : 'light');
        } else {
            applyTheme(settings.theme);
        }
        toggleCustomThemeControls(settings.theme === 'custom');

        systemPrefersDark.removeEventListener('change', handleSystemThemeChange);
        systemPrefersDark.addEventListener('change', handleSystemThemeChange);

        for (const key in customColorInputs) {
            customColorInputs[key].value = settings.customColors[key];
        }

        primaryColorPicker.value = settings.primaryColor;
        updatePrimaryColor(settings.primaryColor);

        bgImageInput.value = settings.bgImage;
        if (settings.bgImage) {
            applyBackground(settings.bgImage);
        }

        bgAlphaSlider.value = settings.bgAlpha;
        document.documentElement.style.setProperty('--bg-overlay-alpha', settings.bgAlpha);
    }

    function applyBackground(wallpaperData) {
        const videoEl = document.getElementById('background-video');
        const body = document.body;

        body.style.backgroundImage = '';
        videoEl.style.opacity = '0';
        videoEl.innerHTML = '';
        if (wallpaperInfoEl) wallpaperInfoEl.innerHTML = '';

        if (!wallpaperData) {
            videoEl.style.display = 'none';
            return;
        }

        let sources = [];
        let title = '';
        let urlInput = '';

        if (typeof wallpaperData === 'object' && wallpaperData !== null && wallpaperData.media) {
            // Trường hợp là object từ thư viện
            title = wallpaperData.title || '';
            if (wallpaperData.media.webm) {
                const url = wallpaperData.media.webm;
                sources.push({ src: url, type: 'video/webm' });
                urlInput = url;
            }
            if (wallpaperData.media.mp4) {
                const url = wallpaperData.media.mp4;
                sources.push({ src: url, type: 'video/mp4' });
                if (!urlInput) urlInput = url;
            }
        } else if (typeof wallpaperData === 'string' && wallpaperData.trim() !== '') {
            // Trường hợp là URL string từ input
            const url = wallpaperData.trim();
            urlInput = url;
            const isVideo = url.endsWith('.mp4') || url.endsWith('.webm') || url.endsWith('.ogv');
            if (isVideo) {
                const type = url.endsWith('.mp4') ? 'video/mp4' : (url.endsWith('.webm') ? 'video/webm' : 'video/ogg');
                sources.push({ src: url, type: type });
            } else {
                body.style.backgroundImage = `url(${url})`;
                videoEl.style.display = 'none';
                return;
            }
        }

        if (sources.length === 0) {
            videoEl.style.display = 'none';
            return;
        }

        sources.forEach(sourceInfo => {
            const sourceEl = document.createElement('source');
            sourceEl.src = sourceInfo.src;
            sourceEl.type = sourceInfo.type;
            videoEl.appendChild(sourceEl);
        });

        videoEl.style.display = 'block';
        videoEl.load();
        videoEl.play().then(() => {
            videoEl.style.opacity = '1';
        }).catch(error => {
            console.error("Lỗi khi chạy video:", error);
            videoEl.style.display = 'none';
        });

        if (title && wallpaperInfoEl) {
            wallpaperInfoEl.innerHTML = `<span>${title}</span>`;
        }

        // Cập nhật giá trị cho input, dù là từ thư viện hay nhập tay
        bgImageInput.value = urlInput;
    }

    async function getRandomWallpaperData() {
        try {
            const response = await fetch('wallpapers.json');
            if (!response.ok) {
                throw new Error(`Không thể tải file wallpapers.json. Status: ${response.status}`);
            }
            const data = await response.json();
            const videos = data.videos;
            if (videos && videos.length > 0) {
                const randomIndex = Math.floor(Math.random() * videos.length);
                return videos[randomIndex];
            }
        } catch (error) {
            console.warn("Không thể lấy dữ liệu wallpaper:", error);
        }
        return null;
    }

    const handleWallpaperSearch = debounce(() => {
        const searchTerm = normalizeVietnamese(wallpaperSearchInput.value.toLowerCase().trim());

        if (searchTerm) {
            filteredWallpapers = allWallpapers.filter(w =>
                normalizeVietnamese(w.title.toLowerCase()).includes(searchTerm)
            );
        } else {
            filteredWallpapers = [...allWallpapers];
        }

        // Reset và render lại từ đầu
        wallpaperGrid.innerHTML = '';
        wallpapersLoaded = 0;
        wallpaperLoader.style.display = 'flex';
        if (wallpaperObserver) wallpaperObserver.observe(wallpaperLoader); // Đảm bảo observer vẫn chạy
        renderMoreWallpapers();

    }, 300);

    function showAddCardForm(listEl) {
        listEl.querySelector('.add-card-btn').style.display = 'none';
        const formContainer = listEl.querySelector('.add-card-form-container');
        formContainer.style.display = 'flex';

        const textarea = formContainer.querySelector('.add-card-textarea');
        const submitBtn = formContainer.querySelector('.add-card-submit-btn');

        // --- LOGIC NÂNG CẤP TOÀN DIỆN ---

        // 1. Mặc định vô hiệu hóa nút
        submitBtn.disabled = true;

        // 2. Lắng nghe sự kiện input
        const handleInput = () => {
            submitBtn.disabled = textarea.value.trim() === '';
        };

        // 3. Lắng nghe sự kiện keydown (nhấn phím)
        const handleKeydown = (e) => {
            // Nếu nhấn Enter (và không giữ Shift)
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault(); // Ngăn việc xuống dòng

                // Chỉ submit nếu nút không bị vô hiệu hóa
                if (!submitBtn.disabled) {
                    submitBtn.click(); // Giả lập click vào nút "Thêm thẻ"
                }
            }
        };

        textarea.addEventListener('input', handleInput);
        textarea.addEventListener('keydown', handleKeydown);
        const originalHideFunc = () => hideAddCardForm(listEl, { handleInput, handleKeydown });

        const cancelBtn = formContainer.querySelector('.add-card-cancel-btn');
        cancelBtn.addEventListener('click', originalHideFunc, { once: true });


        textarea.focus();
    }

    function hideAddCardForm(listEl, listenersToRemove = null) {
        listEl.querySelector('.add-card-btn').style.display = 'block';
        const formContainer = listEl.querySelector('.add-card-form-container');
        formContainer.style.display = 'none';

        const textarea = formContainer.querySelector('.add-card-textarea');
        textarea.value = '';

        if (listenersToRemove) {
            textarea.removeEventListener('input', listenersToRemove.handleInput);
            textarea.removeEventListener('keydown', listenersToRemove.handleKeydown);
        }
    }
    // #endregion

    // #region WALLPAPER GALLERY LOGIC
    async function fetchWallpapersIfNeeded() {
        if (allWallpapers.length > 0) return;

        showLoader('Đang tải thư viện...');
        try {
            const response = await fetch('wallpapers.json');
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();
            allWallpapers = (data.videos || []).filter(v => v.media && (v.media.webm || v.media.mp4));
        } catch (error) {
            console.error("Không thể tải thư viện wallpaper:", error);
            alert("Đã xảy ra lỗi khi tải thư viện hình nền.");
        } finally {
            hideLoader();
        }
    }

    function renderMoreWallpapers() {
        // Thay allWallpapers bằng filteredWallpapers
        const wallpapersToRender = filteredWallpapers.slice(wallpapersLoaded, wallpapersLoaded + WALLPAPERS_PER_PAGE);

        // Xóa thông báo "Không tìm thấy" cũ nếu có
        const noResultsEl = wallpaperGrid.querySelector('.wallpaper-no-results');
        if (noResultsEl) noResultsEl.remove();

        if (wallpapersToRender.length === 0 && wallpapersLoaded === 0) {
            // Thêm thông báo không tìm thấy kết quả
            wallpaperGrid.innerHTML = `<p class="wallpaper-no-results">Không tìm thấy hình nền nào khớp.</p>`;
        }

        if (wallpapersToRender.length === 0) {
            wallpaperLoader.style.display = 'none';
            if (wallpaperObserver) wallpaperObserver.disconnect();
            return;
        }

        wallpapersToRender.forEach(wallpaperData => {
            const item = wallpaperItemTemplate.content.cloneNode(true).firstElementChild;
            const url = wallpaperData.media.webm || wallpaperData.media.mp4;

            item.querySelector('.wallpaper-thumbnail').src = wallpaperData.thumbnailUrl;
            item.querySelector('.wallpaper-title').textContent = wallpaperData.title;
            item.dataset.wallpaperUrl = url;
            item.dataset.wallpaperData = JSON.stringify(wallpaperData);

            if (bgImageInput.value === url) {
                item.classList.add('selected');
            }

            item.addEventListener('click', handleWallpaperSelect);
            wallpaperGrid.appendChild(item);
        });

        wallpapersLoaded += wallpapersToRender.length;
    }

    function handleWallpaperSelect(e) {
        const selectedItem = e.currentTarget;
        const wallpaperData = JSON.parse(selectedItem.dataset.wallpaperData);

        applyBackground(wallpaperData);
        saveUISettings();

        const allSelectedItems = wallpaperGrid.querySelectorAll('.wallpaper-item.selected');
        allSelectedItems.forEach(item => item.classList.remove('selected'));

        selectedItem.classList.add('selected');
    }


    async function openWallpaperGallery() {
        wallpaperGalleryModal.classList.remove('hidden');
        await fetchWallpapersIfNeeded();

        // Gán selector ở đây vì element chỉ tồn tại khi modal mở
        wallpaperSearchInput = document.getElementById('wallpaper-search-input');
        wallpaperSearchInput.value = ''; // Xóa tìm kiếm cũ

        // Bắt đầu với danh sách đầy đủ
        filteredWallpapers = [...allWallpapers];

        wallpaperGrid.innerHTML = '';
        wallpapersLoaded = 0;
        wallpaperLoader.style.display = 'flex';
        renderMoreWallpapers(); // Render lần đầu

        // Gắn listener tìm kiếm
        wallpaperSearchInput.addEventListener('input', handleWallpaperSearch);


        if (wallpaperObserver) wallpaperObserver.disconnect();
        wallpaperObserver = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting) {
                renderMoreWallpapers();
            }
        }, { root: wallpaperGrid.parentElement, threshold: 0.1 });

        if (wallpaperLoader) {
            wallpaperObserver.observe(wallpaperLoader);
        }
    }
    // #endregion

    //#region STORAGE MANAGER
    function getAllBoardAttachments() {
        const allAttachments = [];
        state.lists.forEach(list => {
            (list.cards || []).forEach(card => {
                (card.attachments || []).forEach(attachment => {
                    allAttachments.push({
                        ...attachment,
                        cardId: card.id,
                        cardTitle: card.title,
                        listId: list.id
                    });
                });
            });
        });
        return allAttachments;
    }

    function renderStorageModal() {
        storageGrid.innerHTML = '';
        const allAttachments = getAllBoardAttachments();

        storageEmptyPlaceholder.classList.toggle('hidden', allAttachments.length > 0);

        allAttachments.forEach(attachment => {
            const itemEl = storageItemTemplate.content.cloneNode(true).firstElementChild;
            const thumbnailContainer = itemEl.querySelector('.storage-item-thumbnail');
            const nameEl = itemEl.querySelector('.storage-item-name');
            const cardLinkEl = itemEl.querySelector('.storage-item-card-link');
            const deleteBtn = itemEl.querySelector('.storage-item-delete-btn');

            thumbnailContainer.innerHTML = getFileIconSVG(attachment.type);
            nameEl.textContent = attachment.name;
            nameEl.title = attachment.name;
            cardLinkEl.textContent = attachment.cardTitle;

            cardLinkEl.addEventListener('click', (e) => {
                e.preventDefault();
                closeModal(storageModal);
                openCardDetailModal(attachment.cardId, attachment.listId);
            });

            deleteBtn.addEventListener('click', async () => {
                if (confirm(`Bạn có chắc chắn muốn xóa vĩnh viễn tệp "${attachment.name}" không? Hành động này không thể hoàn tác.`)) {
                    // Xóa file trên Drive
                    await driveHelper.deleteFile(attachment.id);

                    // Cập nhật state
                    const list = state.lists.find(l => l.id === attachment.listId);
                    const card = list.cards.find(c => c.id === attachment.cardId);
                    card.attachments = card.attachments.filter(att => att.id !== attachment.id);

                    saveBoardState();
                    renderStorageModal(); // Render lại modal
                }
            });

            storageGrid.appendChild(itemEl);
        });
    }

    function openStorageModal() {
        renderStorageModal();
        storageModal.classList.remove('hidden');
    }
    // #endregion

    // #region EVENT LISTENERS
    function setupCoreEventListeners() {
        addListBtn.addEventListener('click', addList);
        settingsBtn.addEventListener('click', openSettingsModal);
        logoutBtn.addEventListener('click', handleLogout);

        document.querySelectorAll('.modal-backdrop').forEach(m => m.addEventListener('click', e => { if (e.target === m) closeModal(m); }));
        document.querySelectorAll('.modal-close-btn').forEach(b => b.addEventListener('click', () => closeModal(b.closest('.modal-backdrop'))));

        themeSwitcher.addEventListener('change', (e) => {
            const selectedTheme = e.target.value;
            const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            if (selectedTheme === 'system') {
                applyTheme(systemPrefersDark ? 'dark' : 'light');
            } else {
                applyTheme(selectedTheme);
            }
            toggleCustomThemeControls(selectedTheme === 'custom');
            saveUISettings();
        });

        bgImageInput.addEventListener('blur', (e) => {
            const url = e.target.value.trim();
            applyBackground(url);
            saveUISettings();

            const allSelectedItems = wallpaperGrid.querySelectorAll('.wallpaper-item.selected');
            allSelectedItems.forEach(item => item.classList.remove('selected'));
        });

        bgAlphaSlider.addEventListener('input', () => { document.documentElement.style.setProperty('--bg-overlay-alpha', bgAlphaSlider.value); });
        bgAlphaSlider.addEventListener('change', saveUISettings);
        primaryColorPicker.addEventListener('input', (e) => { updatePrimaryColor(e.target.value); });
        primaryColorPicker.addEventListener('change', saveUISettings);

        addLabelForm.addEventListener('submit', handleAddLabel);
        labelsListEl.addEventListener('click', handleDeleteLabel);

        createBoardForm.addEventListener('submit', handleCreateBoard);

        openWallpaperGalleryBtn.addEventListener('click', openWallpaperGallery);

        for (const key in customColorInputs) {
            customColorInputs[key].addEventListener('input', () => {
                // FIX: Gỡ bỏ điều kiện if, cho phép live preview ngay cả khi theme custom chưa được chọn
                const currentCustomColors = {
                    surface1: customColorInputs.surface1.value,
                    surface2: customColorInputs.surface2.value,
                    surface3: customColorInputs.surface3.value,
                    textPrimary: customColorInputs.textPrimary.value,
                    textSecondary: customColorInputs.textSecondary.value,
                };
                applyCustomTheme(currentCustomColors);
            });
            customColorInputs[key].addEventListener('change', saveUISettings);
        }

        resetCustomThemeBtn.addEventListener('click', () => {
            if (confirm('Đặt lại màu tùy chỉnh về mặc định?')) {
                state.uiSettings.customColors = { ...defaultCustomColors };
                loadUISettings();
                saveUISettings();
            }
        });

        boardSwitcher.querySelector('#board-switcher-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            boardSwitcher.classList.toggle('open');
        });

        const boardSwitcherDropdown = document.getElementById('board-switcher-dropdown');
        boardSwitcherDropdown.addEventListener('click', (e) => {
            e.stopPropagation();
            const actionTarget = e.target.closest('[data-action]');
            if (!actionTarget) return;
            const action = actionTarget.dataset.action;
            if (action) {
                boardSwitcher.classList.remove('open');
                switch (action) {
                    case 'create-board':
                        createBoardModal.classList.remove('hidden');
                        document.getElementById('new-board-name-input').focus();
                        break;
                    case 'delete-board':
                        handleDeleteBoard();
                        break;
                    case 'rename-board':
                        handleRenameBoard();
                        break;
                }
            }
        });
        globalSearchInput.addEventListener('input', debounceUI(handleGlobalSearch, 300)); // SỬA THÀNH debounceUI
        storageBtn.addEventListener('click', openStorageModal);
        document.addEventListener('click', () => boardSwitcher.classList.remove('open'));
    }

    async function init() {
        console.log("Bill Task Management v8.7 (Theme & Gallery UI Fix)");
        const randomWallpaperData = await getRandomWallpaperData();
        if (randomWallpaperData) {
            applyBackground(randomWallpaperData);
        }
        authBtn.disabled = true;
        authBtn.addEventListener('click', handleAuthClick); // Gắn sự kiện click
    }
    init();
    // #endregion
});