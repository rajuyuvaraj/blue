/**
 * BLUE — Anonymous Per-Song Reflections
 * Communal reflection wall with color-hashed listener avatars, live SSE sync,
 * focus trap, and inert drawer state management.
 */

(function () {
  // DOM Elements
  const chatToggleBtn = document.getElementById('chat-toggle-btn');
  const chatDrawer = document.getElementById('chat-drawer');
  const closeChatBtn = document.getElementById('close-chat-btn');
  const chatCurrentSongEl = document.getElementById('chat-current-song-title');
  const chatListenerNameEl = document.getElementById('chat-listener-name');
  const chatMessagesList = document.getElementById('chat-messages-list');
  const chatForm = document.getElementById('chat-form');
  const chatInput = document.getElementById('chat-input');
  const chatSendBtn = document.getElementById('chat-send-btn');
  const chatCharCount = document.getElementById('chat-char-count');
  const chatBadge = document.getElementById('chat-badge');

  let currentVideoId = null;
  let eventSource = null;
  let listenerName = 'Listener';

  // Helper to show toasts
  function notify(msg) {
    if (window.BluePlayer && typeof window.BluePlayer.showToast === 'function') {
      window.BluePlayer.showToast(msg);
    } else if (window.MehfilPlayer && typeof window.MehfilPlayer.showToast === 'function') {
      window.MehfilPlayer.showToast(msg);
    } else {
      console.log('Notification:', msg);
    }
  }

  // Retrieve persistent anonymous listener name for this browser using blue_listener_name
  function getCachedListenerName() {
    let name = localStorage.getItem('blue_listener_name');
    if (!name) {
      const poeticAdjectives = ['Quiet', 'Late Night', 'Sufi', 'Dreamy', 'Moonlit', 'Raga', 'Melody', 'Silent', 'Wandering', 'Ocean', 'Sky'];
      const randomAdj = poeticAdjectives[Math.floor(Math.random() * poeticAdjectives.length)];
      const randomNum = Math.floor(1000 + Math.random() * 9000);
      name = `${randomAdj} Listener ${randomNum}`;
      localStorage.setItem('blue_listener_name', name);
    }
    return name;
  }

  listenerName = getCachedListenerName();
  if (chatListenerNameEl) {
    chatListenerNameEl.textContent = listenerName;
  }

  // Synchronize listener identity with server-side signed cookie
  async function syncServerIdentity() {
    try {
      const res = await fetch('/api/me');
      if (res.ok) {
        const data = await res.json();
        if (data && data.author) {
          listenerName = data.author;
          localStorage.setItem('blue_listener_name', listenerName);
          if (chatListenerNameEl) {
            chatListenerNameEl.textContent = listenerName;
          }
        }
      }
    } catch (err) {
      // Offline / fallback to local name
    }
  }
  syncServerIdentity();

  // Consistent color theme hashing for anonymous usernames
  function getAuthorTheme(name) {
    const themes = ['theme-cyan', 'theme-violet', 'theme-amber', 'theme-rose', 'theme-emerald'];
    let hash = 0;
    const str = name || 'Listener';
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    const index = Math.abs(hash) % themes.length;
    return themes[index];
  }

  // Format relative timestamp
  function formatRelativeTime(dateString) {
    if (!dateString) return 'just now';
    const date = new Date(dateString);
    const now = new Date();
    const diffSec = Math.max(0, Math.floor((now - date) / 1000));

    if (diffSec < 15) return 'just now';
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return 'yesterday';
    return `${diffDays}d ago`;
  }

  // Escape HTML to prevent injection
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  // Render a reflection card
  function createReflectionCard(msg, isNew = false) {
    const card = document.createElement('div');
    const author = msg.author || 'Listener';
    const themeClass = getAuthorTheme(author);
    const initial = author.trim().charAt(0).toUpperCase() || 'L';

    card.className = `reflection-card ${themeClass}${isNew ? ' reflection-card-enter' : ''}`;

    card.innerHTML = `
      <div class="reflection-avatar-wrap" aria-hidden="true">
        <div class="reflection-avatar">${escapeHtml(initial)}</div>
      </div>
      <div class="reflection-content-col">
        <div class="reflection-meta-row">
          <span class="reflection-author-name">${escapeHtml(author)}</span>
          <span class="reflection-timestamp">${formatRelativeTime(msg.created_at)}</span>
        </div>
        <div class="reflection-text">${escapeHtml(msg.content)}</div>
      </div>
    `;
    return card;
  }

  // Render empty state
  function renderEmptyState() {
    if (!chatMessagesList) return;
    chatMessagesList.innerHTML = `
      <div class="chat-empty-state">
        <div class="empty-icon-wrap" aria-hidden="true">
          <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 18V5l12-2v13"></path>
            <circle cx="6" cy="18" r="3"></circle>
            <circle cx="18" cy="16" r="3"></circle>
          </svg>
        </div>
        <p class="empty-title">No reflections yet</p>
        <p class="empty-desc">Share what this melody brings to your mind.</p>
      </div>
    `;
  }

  // Fetch comments for song
  async function loadComments(videoId) {
    if (!videoId) return;
    if (!chatMessagesList) return;

    chatMessagesList.innerHTML = `
      <div class="chat-loading-state">
        <span class="loading-dot"></span>
        <span class="loading-dot"></span>
        <span class="loading-dot"></span>
      </div>
    `;

    try {
      const res = await fetch(`/api/comments/${encodeURIComponent(videoId)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const comments = await res.json();

      chatMessagesList.innerHTML = '';
      if (!comments.length) {
        renderEmptyState();
      } else {
        comments.forEach((msg) => {
          chatMessagesList.appendChild(createReflectionCard(msg, false));
        });
        scrollChatToBottom();
      }
    } catch (err) {
      console.warn('Could not load comments:', err);
      renderEmptyState();
    }
  }

  // Connect to SSE for real-time messages
  function connectSSE(videoId) {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }

    try {
      eventSource = new EventSource(`/api/comments/${encodeURIComponent(videoId)}/stream`);

      eventSource.onmessage = (event) => {
        try {
          const newMsg = JSON.parse(event.data);
          const emptyState = chatMessagesList.querySelector('.chat-empty-state, .chat-loading-state');
          if (emptyState) emptyState.remove();

          const card = createReflectionCard(newMsg, true);
          chatMessagesList.appendChild(card);
          scrollChatToBottom();

          // Badge indicator if drawer closed
          if (!chatDrawer.classList.contains('open') && newMsg.author !== listenerName) {
            if (chatBadge) chatBadge.classList.add('active');
          }
        } catch (e) {
          // Ignore keepalive ping comments
        }
      };

      eventSource.onerror = () => {
        // SSE automatically handles reconnect
      };
    } catch (e) {
      console.warn('SSE connection error:', e);
    }
  }

  function scrollChatToBottom() {
    if (chatMessagesList) {
      chatMessagesList.scrollTo({
        top: chatMessagesList.scrollHeight,
        behavior: 'smooth'
      });
    }
  }

  // Track song changes
  function handleSongChange(e) {
    const song = e.detail?.song;
    if (!song) return;

    currentVideoId = song.videoId;
    if (chatCurrentSongEl) {
      chatCurrentSongEl.textContent = song.title;
    }

    loadComments(currentVideoId);
    connectSSE(currentVideoId);
  }

  window.addEventListener('blue:songchange', handleSongChange);
  window.addEventListener('mehfil:songchange', handleSongChange);

  // Submit comment
  async function postComment() {
    if (!chatInput || !currentVideoId) return;
    const text = chatInput.value.trim();
    if (!text) return;

    if (text.length > 500) {
      notify('Reflection exceeds 500 characters.');
      return;
    }

    chatSendBtn.disabled = true;

    try {
      const res = await fetch(`/api/comments/${encodeURIComponent(currentVideoId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: text
        })
      });

      if (res.ok) {
        chatInput.value = '';
        updateCharCount();
        chatInput.style.height = 'auto';
        notify('Reflection shared');
      } else {
        const data = await res.json();
        notify(data.error || 'Failed to send reflection.');
      }
    } catch (err) {
      console.error('Error posting comment:', err);
      notify('Could not post reflection. Please check connection.');
    } finally {
      chatSendBtn.disabled = false;
      chatInput.focus();
    }
  }

  // Character counter with amber/rose warning thresholds
  function updateCharCount() {
    if (!chatInput || !chatCharCount) return;
    const len = chatInput.value.length;
    chatCharCount.textContent = `${len}/500`;

    chatCharCount.classList.remove('warn-amber', 'warn-rose');
    if (len >= 500) {
      chatCharCount.classList.add('warn-rose');
    } else if (len >= 450) {
      chatCharCount.classList.add('warn-amber');
    }

    if (chatSendBtn) {
      chatSendBtn.disabled = len === 0 || len > 500;
    }
  }

  // Focus trap handler for drawer
  function handleDrawerKeydown(e) {
    if (!chatDrawer.classList.contains('open')) return;

    if (e.key === 'Escape') {
      closeChatDrawer();
      return;
    }

    if (e.key === 'Tab') {
      const focusableEls = chatDrawer.querySelectorAll(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusableEls.length) return;

      const firstEl = focusableEls[0];
      const lastEl = focusableEls[focusableEls.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === firstEl || !chatDrawer.contains(document.activeElement)) {
          e.preventDefault();
          lastEl.focus();
        }
      } else {
        if (document.activeElement === lastEl || !chatDrawer.contains(document.activeElement)) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    }
  }

  // Drawer Toggle Handlers (using inert)
  function openChatDrawer() {
    chatDrawer.classList.add('open');
    chatDrawer.inert = false;
    if (chatBadge) chatBadge.classList.remove('active');
    document.addEventListener('keydown', handleDrawerKeydown);
    scrollChatToBottom();
    if (chatInput) chatInput.focus();
  }

  function closeChatDrawer() {
    chatDrawer.classList.remove('open');
    chatDrawer.inert = true;
    document.removeEventListener('keydown', handleDrawerKeydown);
    if (chatToggleBtn) chatToggleBtn.focus();
  }

  // Ensure initial inert state
  chatDrawer.inert = true;

  if (chatToggleBtn) {
    chatToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (chatDrawer.classList.contains('open')) {
        closeChatDrawer();
      } else {
        openChatDrawer();
      }
    });
  }

  if (closeChatBtn) {
    closeChatBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeChatDrawer();
    });
  }

  // Auto-resize textarea & char count
  if (chatInput) {
    chatInput.addEventListener('input', () => {
      chatInput.style.height = 'auto';
      chatInput.style.height = `${Math.min(chatInput.scrollHeight, 110)}px`;
      updateCharCount();
    });

    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        postComment();
      }
    });
  }

  if (chatForm) {
    chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      postComment();
    });
  }
})();
