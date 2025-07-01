/**
 * Bill's DevSprint - YouTube Player Module
 *
 * Handles the YouTube player widget, playlist management, and API integration.
 * This script is designed to be self-contained and decoupled from the main app logic.
 */
const youtubePlayer = (() => {
    // State variables for this module
    let player;
    let appState = null;
    let saveBoardStateCallback = () => { };
    let isApiReady = false;
    let isPlayerReady = false;
    let currentVideoIndex = -1;

    // DOM Element selectors
    let elements = {};

    function getElements() {
        return {
            widget: document.getElementById('youtube-player-widget'),
            expandBtn: document.getElementById('player-expand-btn'),
            collapseBtn: document.getElementById('player-collapse-btn'),
            playPauseBtn: document.getElementById('player-play-pause-btn'),
            nextBtn: document.getElementById('player-next-btn'),
            prevBtn: document.getElementById('player-prev-btn'),
            videoTitle: document.getElementById('player-video-title'),
            openYoutubeBtn: document.getElementById('player-open-youtube-btn'),
            playlistModal: document.getElementById('youtube-playlist-modal'),
            openPlaylistBtn: document.getElementById('open-playlist-btn'),
            addBookmarkForm: document.getElementById('add-bookmark-form'),
            newBookmarkUrlInput: document.getElementById('new-bookmark-url'),
            bookmarkList: document.getElementById('bookmark-list'),
            bookmarkListEmpty: document.getElementById('bookmark-list-empty'),
            bookmarkItemTemplate: document.getElementById('bookmark-item-template'),
        };
    }

    /**
     * Initializes the module. Called from the main script.
     * @param {object} state - The main application state object.
     * @param {function} saveCallback - The function to call to save the state.
     */
    function init(state, saveCallback) {
        appState = state;
        saveBoardStateCallback = saveCallback;

        elements = getElements();

        if (!appState.youtubeBookmarks) {
            appState.youtubeBookmarks = [];
        }

        loadYoutubeApi();
        attachEventListeners();
        renderPlaylist();
    }

    function loadYoutubeApi() {
        if (document.getElementById('youtube-api-script')) return;

        const tag = document.createElement('script');
        tag.id = 'youtube-api-script';
        tag.src = "https://www.youtube.com/iframe_api";
        const firstScriptTag = document.getElementsByTagName('script')[0];
        firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

        window.onYouTubeIframeAPIReady = () => {
            isApiReady = true;
            player = new YT.Player('youtube-iframe-container', {
                height: '100',
                width: '100',
                playerVars: {
                    'playsinline': 1,
                    'controls': 0,
                    'disablekb': 1,
                },
                events: {
                    'onReady': onPlayerReady,
                    'onStateChange': onPlayerStateChange
                }
            });
        };
    }

    function onPlayerReady(event) {
        isPlayerReady = true;
        // Load the first video if playlist is not empty
        if (appState.youtubeBookmarks.length > 0) {
            currentVideoIndex = 0;
            loadVideo(currentVideoIndex);
        }
    }

    function onPlayerStateChange(event) {
        if (event.data === YT.PlayerState.PLAYING) {
            updateUiOnPlay();
        } else if (event.data === YT.PlayerState.PAUSED) {
            updateUiOnPause();
        } else if (event.data === YT.PlayerState.ENDED) {
            playNext();
        }
    }

    function attachEventListeners() {
        elements.expandBtn.addEventListener('click', () => elements.widget.classList.remove('collapsed'));
        elements.collapseBtn.addEventListener('click', () => elements.widget.classList.add('collapsed'));
        elements.playPauseBtn.addEventListener('click', togglePlayPause);
        elements.nextBtn.addEventListener('click', playNext);
        elements.prevBtn.addEventListener('click', playPrev);
        elements.openPlaylistBtn.addEventListener('click', openPlaylistModal);
        elements.addBookmarkForm.addEventListener('submit', handleAddBookmark);

        // Make widget draggable
        makeDraggable(elements.widget, elements.widget.querySelector('.drag-handle'));
    }

    function togglePlayPause() {
        if (!isPlayerReady || currentVideoIndex < 0) return;

        const playerState = player.getPlayerState();
        if (playerState === YT.PlayerState.PLAYING) {
            player.pauseVideo();
        } else {
            player.playVideo();
        }
    }

    function playNext() {
        if (appState.youtubeBookmarks.length === 0) return;
        currentVideoIndex = (currentVideoIndex + 1) % appState.youtubeBookmarks.length;
        loadVideo(currentVideoIndex, true);
    }

    function playPrev() {
        if (appState.youtubeBookmarks.length === 0) return;
        currentVideoIndex = (currentVideoIndex - 1 + appState.youtubeBookmarks.length) % appState.youtubeBookmarks.length;
        loadVideo(currentVideoIndex, true);
    }

    function loadVideo(index, autoplay = false) {
        if (!isPlayerReady || !appState.youtubeBookmarks[index]) return;

        currentVideoIndex = index;
        const videoId = appState.youtubeBookmarks[index].id;

        if (autoplay) {
            player.loadVideoById(videoId);
        } else {
            player.cueVideoById(videoId);
        }

        elements.videoTitle.textContent = "Đang tải...";
        elements.videoTitle.title = "Đang tải...";
        elements.openYoutubeBtn.href = `https://www.youtube.com/watch?v=${videoId}`;

        // Wait a moment for video data to be available
        setTimeout(() => {
            const videoData = player.getVideoData();
            const title = videoData.title || 'Không có tiêu đề';
            elements.videoTitle.textContent = title;
            elements.videoTitle.title = title;

            // Update title in state if it was a placeholder
            if (appState.youtubeBookmarks[index].title.startsWith('Đang tải')) {
                appState.youtubeBookmarks[index].title = title;
                saveBoardStateCallback();
                renderPlaylist();
            }
        }, 1500);

        highlightCurrentInPlaylist();
    }

    function updateUiOnPlay() {
        elements.playPauseBtn.classList.add('playing');
        elements.playPauseBtn.setAttribute('aria-label', 'Tạm dừng');
    }

    function updateUiOnPause() {
        elements.playPauseBtn.classList.remove('playing');
        elements.playPauseBtn.setAttribute('aria-label', 'Phát');
    }

    function openPlaylistModal() {
        renderPlaylist();
        elements.playlistModal.classList.remove('hidden');
    }

    function renderPlaylist() {
        elements.bookmarkList.innerHTML = '';
        const bookmarks = appState.youtubeBookmarks;

        elements.bookmarkListEmpty.classList.toggle('hidden', bookmarks.length > 0);

        bookmarks.forEach((bookmark, index) => {
            const item = elements.bookmarkItemTemplate.content.cloneNode(true).firstElementChild;
            item.dataset.index = index;
            item.querySelector('.bookmark-title').textContent = bookmark.title;
            item.querySelector('.bookmark-thumbnail').src = `https://i.ytimg.com/vi/${bookmark.id}/default.jpg`;

            item.addEventListener('click', (e) => {
                if (e.target.closest('.bookmark-delete-btn')) return;
                loadVideo(index, true);
            });

            item.querySelector('.bookmark-delete-btn').addEventListener('click', () => {
                deleteBookmark(index);
            });

            elements.bookmarkList.appendChild(item);
        });

        highlightCurrentInPlaylist();
    }

    function highlightCurrentInPlaylist() {
        document.querySelectorAll('.bookmark-item.playing').forEach(el => el.classList.remove('playing'));
        const currentItem = elements.bookmarkList.querySelector(`[data-index="${currentVideoIndex}"]`);
        if (currentItem) {
            currentItem.classList.add('playing');
        }
    }

    function handleAddBookmark(e) {
        e.preventDefault();
        const url = elements.newBookmarkUrlInput.value.trim();
        if (!url) return;

        const videoId = extractYouTubeId(url);
        if (!videoId) {
            alert("Link YouTube không hợp lệ. Vui lòng kiểm tra lại.");
            return;
        }

        if (appState.youtubeBookmarks.some(b => b.id === videoId)) {
            alert("Bài hát này đã có trong danh sách.");
            return;
        }

        const newBookmark = {
            id: videoId,
            title: `Đang tải tiêu đề... (${videoId})`
        };

        appState.youtubeBookmarks.push(newBookmark);
        saveBoardStateCallback();
        renderPlaylist();
        elements.newBookmarkUrlInput.value = '';

        // If this is the first song, load and play it
        if (appState.youtubeBookmarks.length === 1) {
            loadVideo(0, true);
        }
    }

    function deleteBookmark(index) {
        if (!confirm(`Xóa "${appState.youtubeBookmarks[index].title}" khỏi danh sách?`)) return;

        appState.youtubeBookmarks.splice(index, 1);
        saveBoardStateCallback();
        renderPlaylist();

        if (index === currentVideoIndex) {
            player.stopVideo();
            elements.videoTitle.textContent = "Chưa có nhạc";
            currentVideoIndex = -1;
        } else if (index < currentVideoIndex) {
            currentVideoIndex--;
        }
    }

    function extractYouTubeId(url) {
        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
        const match = url.match(regExp);
        return (match && match[2].length === 11) ? match[2] : null;
    }

    function makeDraggable(element, handle) {
        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
        handle.onmousedown = dragMouseDown;

        function dragMouseDown(e) {
            e.preventDefault();
            pos3 = e.clientX;
            pos4 = e.clientY;
            document.onmouseup = closeDragElement;
            document.onmousemove = elementDrag;
        }

        function elementDrag(e) {
            e.preventDefault();
            pos1 = pos3 - e.clientX;
            pos2 = pos4 - e.clientY;
            pos3 = e.clientX;
            pos4 = e.clientY;

            let newTop = element.offsetTop - pos2;
            let newLeft = element.offsetLeft - pos1;

            // Constrain within viewport
            newTop = Math.max(0, Math.min(newTop, window.innerHeight - element.offsetHeight));
            newLeft = Math.max(0, Math.min(newLeft, window.innerWidth - element.offsetWidth));

            element.style.top = newTop + "px";
            element.style.left = newLeft + "px";
            element.style.bottom = 'auto'; // Override original position
            element.style.right = 'auto';
        }

        function closeDragElement() {
            document.onmouseup = null;
            document.onmousemove = null;
        }
    }

    // Public interface
    return {
        init: init
    };
})();