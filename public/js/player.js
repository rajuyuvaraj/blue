/**
 * BLUE - Playback Engine
 * Uses YouTube IFrame Player API with custom shuffled queue, 2-stage previous controls,
 * sessionStorage queue persistence, Media Session API, and real-time progress bar.
 */

(function () {
  // DOM Elements
  const songTitleEl = document.getElementById('song-title');
  const songSubtitleEl = document.getElementById('song-subtitle');
  const playPauseBtn = document.getElementById('play-pause-btn');
  const playPauseIcon = document.getElementById('play-pause-icon');
  const prevBtn = document.getElementById('prev-btn');
  const nextBtn = document.getElementById('next-btn');
  const progressEl = document.getElementById('playback-progress');

  // Player State
  let player = null;
  let isPlayerReady = false;
  let isPlaying = false;
  let queue = [];
  let currentIndex = 0;
  const historyStack = []; // Stack of previously played songs
  let justRestarted = false; // Two-stage previous tracking flag
  let hasUserInteracted = false;
  let progressInterval = null;

  // Fisher-Yates Shuffle Algorithm
  function shuffleArray(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // Initialize Shuffled Queue (Restoring from sessionStorage if present)
  function initQueue() {
    const playlistSource = (typeof BLUE_PLAYLIST !== 'undefined' && BLUE_PLAYLIST.length) 
      ? BLUE_PLAYLIST 
      : ((typeof MEHFIL_PLAYLIST !== 'undefined' && MEHFIL_PLAYLIST.length) ? MEHFIL_PLAYLIST : []);

    if (!playlistSource.length) {
      console.error('BLUE Playlist is empty or not loaded.');
      return;
    }

    const savedQueue = sessionStorage.getItem('blue_queue');
    const savedIdx = sessionStorage.getItem('blue_current_index');

    if (savedQueue) {
      try {
        const parsed = JSON.parse(savedQueue);
        if (Array.isArray(parsed) && parsed.length > 0) {
          queue = parsed;
          const parsedIdx = parseInt(savedIdx, 10);
          currentIndex = (Number.isInteger(parsedIdx) && parsedIdx >= 0 && parsedIdx < queue.length) ? parsedIdx : 0;
          return;
        }
      } catch (err) {
        console.warn('Failed to restore queue from sessionStorage:', err);
      }
    }

    queue = shuffleArray(playlistSource);
    currentIndex = 0;
    saveSessionQueue();
  }

  // Persist queue and current index to sessionStorage
  function saveSessionQueue() {
    try {
      sessionStorage.setItem('blue_queue', JSON.stringify(queue));
      sessionStorage.setItem('blue_current_index', String(currentIndex));
    } catch (err) {
      console.warn('Could not save queue to sessionStorage:', err);
    }
  }

  // Update Song Display in Music Bar & Media Session API
  function updateSongDisplay(song) {
    if (!song) return;
    if (songTitleEl) songTitleEl.textContent = song.title;
    if (songSubtitleEl) {
      songSubtitleEl.textContent = song.subtitle || 'Traditional / Film';
      songSubtitleEl.style.display = song.subtitle ? 'block' : 'none';
    }
    document.title = `${song.title} — BLUE`;

    // Persist to sessionStorage on song change
    saveSessionQueue();

    // Media Session API Integration
    if ('mediaSession' in navigator && song) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: song.title,
          artist: song.subtitle || 'Traditional / Film',
          album: 'BLUE',
          artwork: [
            { src: `https://i.ytimg.com/vi/${song.videoId}/maxresdefault.jpg`, sizes: '1280x720', type: 'image/jpeg' },
            { src: `https://i.ytimg.com/vi/${song.videoId}/hqdefault.jpg`, sizes: '480x360', type: 'image/jpeg' }
          ]
        });
      } catch (err) {
        console.warn('MediaSession metadata error:', err);
      }
    }

    // Notify other components (e.g. Reflections Chat) of track change
    const eventDetail = { song, index: currentIndex };
    window.dispatchEvent(new CustomEvent('blue:songchange', { detail: eventDetail }));
    window.dispatchEvent(new CustomEvent('mehfil:songchange', { detail: eventDetail }));
  }

  // Update Play/Pause UI state and progress bar display
  function setPlayState(playing) {
    isPlaying = playing;
    if (progressEl) {
      if (playing) {
        progressEl.classList.add('active');
      } else {
        progressEl.classList.remove('active');
      }
    }

    if (!playPauseIcon) return;

    if (playing) {
      // Pause Icon ⏸
      playPauseIcon.innerHTML = `
        <rect x="6" y="4" width="4" height="16" rx="1.5" fill="currentColor"></rect>
        <rect x="14" y="4" width="4" height="16" rx="1.5" fill="currentColor"></rect>
      `;
      playPauseBtn.setAttribute('aria-label', 'Pause');
      playPauseBtn.classList.add('playing-pulse');
    } else {
      // Play Icon ▶
      playPauseIcon.innerHTML = `
        <polygon points="5 3 19 12 5 21 5 3" fill="currentColor"></polygon>
      `;
      playPauseBtn.setAttribute('aria-label', 'Play');
      playPauseBtn.classList.remove('playing-pulse');
    }
  }

  // Progress Bar update loop (500ms)
  function startProgressLoop() {
    if (progressInterval) clearInterval(progressInterval);
    progressInterval = setInterval(() => {
      if (isPlayerReady && player && isPlaying) {
        try {
          const currentTime = player.getCurrentTime() || 0;
          const duration = player.getDuration() || 0;
          if (duration > 0 && progressEl) {
            const pct = Math.min(100, Math.max(0, (currentTime / duration) * 100));
            progressEl.style.width = `${pct}%`;
            progressEl.classList.add('active');
          }
        } catch (err) {
          // Ignore player polling errors
        }
      } else if (progressEl && !isPlaying) {
        progressEl.classList.remove('active');
      }
    }, 500);
  }

  // Load and Play Track
  function loadSong(song, autoPlay = true) {
    if (!song) return;
    if (progressEl) progressEl.style.width = '0%';
    updateSongDisplay(song);

    if (isPlayerReady && player) {
      if (autoPlay) {
        player.loadVideoById(song.videoId);
        setPlayState(true);
      } else {
        player.cueVideoById(song.videoId);
        setPlayState(false);
      }
    }
  }

  // Play Next Song (Re-shuffle when wrapping past last index)
  function playNextSong() {
    if (!queue.length) return;

    const currentSong = queue[currentIndex];
    if (currentSong) {
      historyStack.push(currentSong);
    }

    if (currentIndex + 1 >= queue.length) {
      // Re-shuffle before looping
      queue = shuffleArray(queue);
      currentIndex = 0;
    } else {
      currentIndex++;
    }

    justRestarted = false; // Reset 2-stage Previous flag

    const nextSong = queue[currentIndex];
    loadSong(nextSong, true);
  }

  // Play Previous Song (2-Stage Logic)
  function playPreviousSong() {
    if (!isPlayerReady || !player) return;

    if (!justRestarted) {
      // Stage 1: Restart current song from 0:00
      try {
        player.seekTo(0, true);
        player.playVideo();
        setPlayState(true);
      } catch (err) {
        console.warn('Error seeking video:', err);
      }
      justRestarted = true;
      showToast('Restarting track from beginning');
    } else {
      // Stage 2: Consecutive press - Go to actual session history
      if (historyStack.length > 0) {
        const previousSong = historyStack.pop();
        const foundIdx = queue.findIndex((s) => s.videoId === previousSong.videoId);
        if (foundIdx !== -1) {
          currentIndex = foundIdx;
        }
        justRestarted = false;
        loadSong(previousSong, true);
        showToast('Playing previous track');
      } else {
        // No prior songs in session history, restart current
        try {
          player.seekTo(0, true);
          player.playVideo();
          setPlayState(true);
        } catch (err) {
          console.warn('Error seeking video:', err);
        }
        showToast('First track of session');
      }
    }
  }

  // Toggle Play / Pause
  function togglePlayPause() {
    if (!isPlayerReady || !player) {
      hasUserInteracted = true;
      return;
    }

    hasUserInteracted = true;
    const state = player.getPlayerState();

    if (state === YT.PlayerState.PLAYING) {
      player.pauseVideo();
      setPlayState(false);
    } else {
      player.playVideo();
      setPlayState(true);
    }
  }

  // Toast notifications helper
  let toastTimer = null;
  function showToast(message) {
    let toast = document.getElementById('blue-toast') || document.getElementById('mehfil-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'blue-toast';
      toast.className = 'toast-notification';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove('show');
    }, 2400);
  }

  // Set up Event Listeners for UI and Media Session API
  function setupEventListeners() {
    if (playPauseBtn) {
      playPauseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        togglePlayPause();
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        playNextSong();
      });
    }

    if (prevBtn) {
      prevBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        playPreviousSong();
      });
    }

    // Spacebar to toggle play/pause (ignoring when typing in chat input)
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        const activeEl = document.activeElement;
        const isInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');
        if (!isInput) {
          e.preventDefault();
          togglePlayPause();
        }
      }
    });

    // Media Session Action Handlers
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.setActionHandler('nexttrack', () => {
          playNextSong();
        });
        navigator.mediaSession.setActionHandler('previoustrack', () => {
          playPreviousSong();
        });
        navigator.mediaSession.setActionHandler('play', () => {
          if (player && isPlayerReady) {
            player.playVideo();
            setPlayState(true);
          }
        });
        navigator.mediaSession.setActionHandler('pause', () => {
          if (player && isPlayerReady) {
            player.pauseVideo();
            setPlayState(false);
          }
        });
      } catch (err) {
        console.warn('MediaSession handler registration warning:', err);
      }
    }
  }

  // Global YouTube IFrame API Callback
  window.onYouTubeIframeAPIReady = function () {
    const initialSong = queue[currentIndex];

    player = new YT.Player('yt-player', {
      height: '1',
      width: '1',
      videoId: initialSong ? initialSong.videoId : '',
      playerVars: {
        controls: 0,
        disablekb: 1,
        fs: 0,
        modestbranding: 1,
        rel: 0,
        iv_load_policy: 3,
        enablejsapi: 1,
        playsinline: 1,
        origin: window.location.origin
      },
      events: {
        onReady: function () {
          isPlayerReady = true;
          setPlayState(false);
          if (initialSong) {
            updateSongDisplay(initialSong);
          }
          if (hasUserInteracted) {
            player.playVideo();
          }
          startProgressLoop();
        },
        onStateChange: function (event) {
          if (event.data === YT.PlayerState.PLAYING) {
            setPlayState(true);
          } else if (event.data === YT.PlayerState.PAUSED) {
            setPlayState(false);
          } else if (event.data === YT.PlayerState.ENDED) {
            playNextSong();
          }
        },
        onError: function (event) {
          console.warn('YouTube Player error code:', event.data);
          showToast('Song unavailable outside YouTube, moving to next');
          setTimeout(() => {
            playNextSong();
          }, 800);
        }
      }
    });
  };

  // Bootstrap
  initQueue();
  setupEventListeners();
  if (queue.length > 0) {
    updateSongDisplay(queue[currentIndex]);
  }

  // Load YouTube IFrame API script tag dynamically
  const tag = document.createElement('script');
  tag.src = 'https://www.youtube.com/iframe_api';
  const firstScriptTag = document.getElementsByTagName('script')[0];
  firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

  // Expose BLUE Player API on window for external controls and testing
  const api = {
    getQueue: () => queue,
    getCurrentSong: () => queue[currentIndex],
    getCurrentIndex: () => currentIndex,
    getHistory: () => [...historyStack],
    isPlaying: () => isPlaying,
    playNext: playNextSong,
    playPrevious: playPreviousSong,
    togglePlayPause: togglePlayPause,
    showToast: showToast
  };

  window.BluePlayer = api;
  window.MehfilPlayer = api;
})();
