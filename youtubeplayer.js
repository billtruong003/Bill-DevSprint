/**
 * Bill's DevSprint - YouTube Player Module (v2.2 - CRITICAL BUGFIX & UI POLISH)
 * FIX: Resolves TypeError from Sortable.js by properly managing instance lifecycle.
 * FIX: Prevents async errors by adding guard clauses to all player control functions.
 * FIX: Ensures player object is always defined before use.
 * Author: AI Assistant
 */
const youtubePlayer = (() => {
    let player;
    let appState = null;
    let saveBoardStateCallback = () => { };
    let isApiReady = false;
    let isPlayerReady = false;
    let currentVideoIndex = -1;
    let progressInterval = null;
    let elements = {};
    let playlistSortable = null; // Will be managed carefully
    let lastVolume = 50;
    let isSeeking = false;

    function getElements() {
        return {
            widget: document.getElementById('youtube-player-widget'),
            expandBtn: document.getElementById('player-expand-btn'),
            collapseBtn: document.getElementById('player-collapse-btn'),
            playPauseBtn: document.getElementById('player-play-pause-btn'),
            nextBtn: document.getElementById('player-next-btn'),
            prevBtn: document.getElementById('player-prev-btn'),
            videoTitle: document.getElementById('player-video-title'),
            progressSlider: document.getElementById('player-progress'),
            thumbnail: document.getElementById('player-thumbnail'),
            openYoutubeBtn: document.getElementById('player-open-youtube-btn'),
            playlistModal: document.getElementById('youtube-playlist-modal'),
            openPlaylistBtn: document.getElementById('open-playlist-btn'),
            addBookmarkForm: document.getElementById('add-bookmark-form'),
            newBookmarkUrlInput: document.getElementById('new-bookmark-url'),
            bookmarkList: document.getElementById('bookmark-list'),
            bookmarkListEmpty: document.getElementById('bookmark-list-empty'),
            bookmarkItemTemplate: document.getElementById('bookmark-item-template'),
            volumeControl: document.getElementById('player-volume-control'),
            volumeBtn: document.getElementById('player-volume-btn'),
            volumeSlider: document.getElementById('player-volume-slider'),
            volumeIconHigh: document.getElementById('volume-icon-high'),
            volumeIconLow: document.getElementById('volume-icon-low'),
            volumeIconMuted: document.getElementById('volume-icon-muted'),
        };
    }

    // ==========================================================================
    // BUGFIX: All functions interacting with the player now have a guard clause
    // ==========================================================================

    function attachUIEventListeners() {
        if (!elements.widget || !elements.expandBtn) return;

        elements.expandBtn.addEventListener('click', () => elements.widget.classList.remove('collapsed'));
        elements.collapseBtn.addEventListener('click', () => elements.widget.classList.add('collapsed'));
        elements.playPauseBtn.addEventListener('click', togglePlayPause);
        elements.nextBtn.addEventListener('click', playNext);
        elements.prevBtn.addEventListener('click', playPrev);
        elements.openPlaylistBtn.addEventListener('click', openPlaylistModal);

        elements.progressSlider.addEventListener('input', handleProgressDrag);
        elements.progressSlider.addEventListener('change', handleProgressSeek);
        elements.progressSlider.addEventListener('mousedown', () => { isSeeking = true; });
        elements.progressSlider.addEventListener('mouseup', () => { isSeeking = false; handleProgressSeek(); });

        elements.playlistModal.querySelector('.modal-close-btn')?.addEventListener('click', () => elements.playlistModal.classList.add('hidden'));
        elements.playlistModal.addEventListener('click', (e) => {
            if (e.target === elements.playlistModal) elements.playlistModal.classList.add('hidden');
        });

        elements.volumeBtn.addEventListener('click', toggleMute);
        elements.volumeSlider.addEventListener('input', handleVolumeChange);
    }

    function handleProgressDrag() {
        if (!isPlayerReady || !player.getDuration) return;
        const duration = player.getDuration();
        const newTime = duration * (elements.progressSlider.value / 100);
        const progressPercent = (newTime / duration) * 100;
        elements.progressSlider.style.setProperty('--progress-percent', `${progressPercent}%`);
    }

    function handleProgressSeek() {
        if (!isPlayerReady || !player || !player.getDuration) return;
        isSeeking = false;
        const duration = player.getDuration();
        const newTime = duration * (elements.progressSlider.value / 100);
        player.seekTo(newTime, true);
    }

    function updateProgressBar() {
        // FIX: Add guard clause and check isSeeking flag
        if (!isPlayerReady || !player || !player.getCurrentTime || isSeeking) return;

        const currentTime = player.getCurrentTime();
        const duration = player.getDuration();
        if (duration > 0) {
            const progress = (currentTime / duration) * 100;
            elements.progressSlider.value = progress;
            elements.progressSlider.style.setProperty('--progress-percent', `${progress}%`);
        }
    }

    function onPlayerStateChange(event) {
        clearInterval(progressInterval);
        if (event.data === YT.PlayerState.PLAYING) {
            updateUiOnPlay();
            progressInterval = setInterval(updateProgressBar, 250);
        } else if (event.data === YT.PlayerState.PAUSED) {
            updateUiOnPause();
        } else if (event.data === YT.PlayerState.ENDED) {
            updateUiOnPause();
            elements.progressSlider.value = 0;
            elements.progressSlider.style.setProperty('--progress-percent', '0%');
            playNext();
        }
    }

    function togglePlayPause() {
        if (!isPlayerReady || !player || currentVideoIndex < 0) return;
        const playerState = player.getPlayerState();
        if (playerState === YT.PlayerState.PLAYING) {
            player.pauseVideo();
        } else {
            player.playVideo();
        }
    }

    function loadVideo(index, autoplay = false) {
        if (!isApiReady) { console.warn("[YT Player] API not ready, deferring load."); return; }
        if (!player) { console.error("[YT Player] Player object not found, cannot load video."); return; }
        if (!appState.youtubeBookmarks[index]) {
            elements.thumbnail.classList.add('hidden');
            return;
        }

        elements.thumbnail.classList.remove('hidden');
        currentVideoIndex = index;
        const videoId = appState.youtubeBookmarks[index].id;

        if (autoplay) {
            player.loadVideoById(videoId);
        } else {
            player.cueVideoById(videoId);
        }

        elements.videoTitle.textContent = "Đang tải...";
        elements.videoTitle.title = "Đang tải...";
        elements.thumbnail.style.backgroundImage = `url('https://i.ytimg.com/vi/${videoId}/mqdefault.jpg')`;
        elements.openYoutubeBtn.href = `https://www.youtube.com/watch?v=${videoId}`;

        // Use a timeout to wait for video data to be available
        setTimeout(() => {
            if (!player || typeof player.getVideoData !== 'function') return;
            const videoData = player.getVideoData();
            const title = videoData.title || appState.youtubeBookmarks[index].title;
            elements.videoTitle.textContent = title;
            elements.videoTitle.title = title;
            // Update title in state if it was a placeholder
            if (appState.youtubeBookmarks[index] && appState.youtubeBookmarks[index].title.startsWith('Đang tải')) {
                appState.youtubeBookmarks[index].title = title;
                saveBoardStateCallback();
                renderPlaylist();
            }
        }, 1500);
        highlightCurrentInPlaylist();
    }

    function onPlayerReady(event) {
        console.log('[YT Player] Player is ready.');
        isPlayerReady = true;
        player = event.target; // Ensure player is assigned correctly

        const savedVolume = appState?.uiSettings?.youtubePlayerVolume ?? 50;
        player.setVolume(savedVolume);
        elements.volumeSlider.value = savedVolume;
        lastVolume = savedVolume > 0 ? savedVolume : 50;
        updateVolumeUI();

        if (appState?.youtubeBookmarks?.length > 0) {
            loadVideo(0, false); // Cue first video without autoplaying
        }
    }

    function handleVolumeChange(e) {
        // FIX: Add guard clause
        if (!isPlayerReady || !player) return;
        const newVolume = parseInt(e.target.value, 10);
        player.setVolume(newVolume);
        if (player.isMuted()) player.unMute();

        if (appState) appState.uiSettings.youtubePlayerVolume = newVolume;
        saveBoardStateCallback();

        if (newVolume > 0) lastVolume = newVolume;
        updateVolumeUI();
    }

    function toggleMute() {
        if (!isPlayerReady || !player) return;
        if (player.isMuted()) {
            player.unMute();
            player.setVolume(lastVolume);
            if (appState) appState.uiSettings.youtubePlayerVolume = lastVolume;
        } else {
            lastVolume = player.getVolume();
            player.mute();
            if (appState) appState.uiSettings.youtubePlayerVolume = 0;
        }
        saveBoardStateCallback();
        updateVolumeUI();
    }

    function updateVolumeUI() {
        if (!isPlayerReady || !player) return;
        const isMuted = player.isMuted();
        const currentVolume = player.getVolume();

        elements.volumeSlider.value = isMuted ? 0 : currentVolume;
        elements.volumeSlider.style.setProperty('--volume-percent', `${isMuted ? 0 : currentVolume}%`);

        elements.volumeIconHigh.style.display = 'none';
        elements.volumeIconLow.style.display = 'none';
        elements.volumeIconMuted.style.display = 'none';

        if (isMuted || currentVolume === 0) {
            elements.volumeIconMuted.style.display = 'block';
        } else if (currentVolume > 50) {
            elements.volumeIconHigh.style.display = 'block';
        } else {
            elements.volumeIconLow.style.display = 'block';
        }
    }

    function playNext() {
        if (!isPlayerReady || !player || !appState?.youtubeBookmarks?.length) return;
        currentVideoIndex = (currentVideoIndex + 1) % appState.youtubeBookmarks.length;
        loadVideo(currentVideoIndex, true);
    }

    function playPrev() {
        if (!isPlayerReady || !player || !appState?.youtubeBookmarks?.length) return;
        currentVideoIndex = (currentVideoIndex - 1 + appState.youtubeBookmarks.length) % appState.youtubeBookmarks.length;
        loadVideo(currentVideoIndex, true);
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
        // FIX: Properly destroy and nullify the Sortable instance to prevent errors
        if (playlistSortable) {
            playlistSortable.destroy();
            playlistSortable = null;
        }

        elements.bookmarkList.innerHTML = '';
        const bookmarks = appState?.youtubeBookmarks || [];
        elements.bookmarkListEmpty.classList.toggle('hidden', bookmarks.length === 0);

        bookmarks.forEach((bookmark, index) => {
            const item = elements.bookmarkItemTemplate.content.cloneNode(true).firstElementChild;
            item.dataset.index = index;
            item.querySelector('.bookmark-title').textContent = bookmark.title;
            item.querySelector('.bookmark-thumbnail').src = `https://i.ytimg.com/vi/${bookmark.id}/default.jpg`;

            item.addEventListener('click', (e) => {
                if (e.target.closest('.bookmark-delete-btn')) return;
                loadVideo(index, true);
                elements.playlistModal.classList.add('hidden');
            });
            item.querySelector('.bookmark-delete-btn').addEventListener('click', () => deleteBookmark(index));
            elements.bookmarkList.appendChild(item);
        });

        // Re-initialize SortableJS on the updated list
        if (typeof Sortable !== 'undefined' && elements.bookmarkList.children.length > 1) {
            playlistSortable = new Sortable(elements.bookmarkList, {
                animation: 150,
                onEnd: (evt) => {
                    // Update state array based on new DOM order
                    const [movedItem] = appState.youtubeBookmarks.splice(evt.oldIndex, 1);
                    appState.youtubeBookmarks.splice(evt.newIndex, 0, movedItem);

                    // Update the current playing index if it was affected
                    if (currentVideoIndex === evt.oldIndex) {
                        currentVideoIndex = evt.newIndex;
                    } else if (evt.oldIndex < currentVideoIndex && evt.newIndex >= currentVideoIndex) {
                        currentVideoIndex--;
                    } else if (evt.oldIndex > currentVideoIndex && evt.newIndex <= currentVideoIndex) {
                        currentVideoIndex++;
                    }
                    saveBoardStateCallback();
                    renderPlaylist(); // Re-render to update indices and visuals
                }
            });
        }
        highlightCurrentInPlaylist();
    }

    function highlightCurrentInPlaylist() {
        document.querySelectorAll('.bookmark-item.playing').forEach(el => el.classList.remove('playing'));
        if (currentVideoIndex > -1) {
            const currentItem = elements.bookmarkList.querySelector(`.bookmark-item[data-index="${currentVideoIndex}"]`);
            currentItem?.classList.add('playing');
        }
    }

    async function handleAddBookmark(e) {
        e.preventDefault(); // Prevent form submission
        const url = elements.newBookmarkUrlInput.value.trim();
        if (!url) return;

        const videoId = extractYouTubeId(url);
        if (!videoId) {
            alert("Link YouTube không hợp lệ.");
            return;
        }
        if (appState.youtubeBookmarks.some(b => b.id === videoId)) {
            alert("Bài hát này đã có trong danh sách.");
            return;
        }

        const newBookmark = { id: videoId, title: `Đang tải tiêu đề... (${videoId})` };
        appState.youtubeBookmarks.push(newBookmark);
        saveBoardStateCallback();
        renderPlaylist(); // This will re-render with the new item
        elements.newBookmarkUrlInput.value = '';

        if (currentVideoIndex === -1 && isPlayerReady) {
            loadVideo(0, false); // Cue the first video if playlist was empty
        }
    }

    function deleteBookmark(index) {
        if (!confirm(`Xóa "${appState.youtubeBookmarks[index].title}" khỏi danh sách?`)) return;
        const wasPlaying = (index === currentVideoIndex);
        appState.youtubeBookmarks.splice(index, 1);

        if (wasPlaying) {
            if (appState.youtubeBookmarks.length > 0) {
                const nextIndex = Math.min(index, appState.youtubeBookmarks.length - 1);
                loadVideo(nextIndex, true);
            } else {
                if (player && typeof player.stopVideo === 'function') player.stopVideo();
                elements.videoTitle.textContent = "Chưa có nhạc";
                elements.thumbnail.classList.add('hidden');
                elements.progressSlider.value = 0;
                elements.progressSlider.style.setProperty('--progress-percent', '0%');
                currentVideoIndex = -1;
                updateUiOnPause();
            }
        } else if (index < currentVideoIndex) {
            currentVideoIndex--;
        }
        saveBoardStateCallback();
        renderPlaylist(); // Re-render the list
    }

    function extractYouTubeId(url) {
        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
        const match = url.match(regExp);
        return (match && match[2].length === 11) ? match[2] : null;
    }

    function createPlayer() {
        if (player) return; // Don't create if it already exists
        console.log('[YT Player] Creating player instance.');
        // The API will call onYouTubeIframeAPIReady, which will create the new YT.Player
        const tag = document.createElement('script');
        tag.src = "https://www.youtube.com/iframe_api";
        document.head.appendChild(tag);

        const playerDiv = document.createElement('div');
        playerDiv.id = 'youtube-iframe-container';
        playerDiv.style.display = 'none';
        document.body.appendChild(playerDiv);

        window.onYouTubeIframeAPIReady = () => {
            isApiReady = true;
            new YT.Player('youtube-iframe-container', {
                height: '0',
                width: '0',
                playerVars: { 'playsinline': 1, 'controls': 0, 'disablekb': 1, 'origin': window.location.origin },
                events: {
                    'onReady': onPlayerReady,
                    'onStateChange': onPlayerStateChange
                }
            });
        };
    }

    function linkToAppState(data) {
        console.log('[YT Player] ✅ Received appState. Linking data now...');
        appState = data.state;
        saveBoardStateCallback = data.saveCallback;

        if (!appState.youtubeBookmarks) appState.youtubeBookmarks = [];
        if (typeof appState.uiSettings.youtubePlayerVolume === 'undefined') {
            appState.uiSettings.youtubePlayerVolume = 50;
        }

        createPlayer();
        renderPlaylist();
        elements.addBookmarkForm.addEventListener('submit', handleAddBookmark);
    }

    function init() {
        console.log('[YT Player] 🎵 Self-initializing UI components...');
        elements = getElements();
        attachUIEventListeners();
        document.addEventListener('appReady', (event) => {
            linkToAppState(event.detail);
        });
    }

    init();
})();