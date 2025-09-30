// Feedback widget for drose.io - SSE version
(function() {
  'use strict';

  // Widget state
  let expanded = false;
  let visitorId = null;
  let lastMessageId = null;
  let eventSource = null;
  let isConnected = false;

  // Device ID generation
  async function getVisitorId() {
    let id = localStorage.getItem('__vid');
    if (id) return id;

    const cookieId = getCookie('__vid');
    if (cookieId) {
      localStorage.setItem('__vid', cookieId);
      return cookieId;
    }

    id = generateUUID();
    localStorage.setItem('__vid', id);
    setCookie('__vid', id, 365 * 10);
    return id;
  }

  function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function getCookie(name) {
    const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    return match ? match[2] : null;
  }

  function setCookie(name, value, days) {
    const expires = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = name + '=' + encodeURIComponent(value) + '; expires=' + expires + '; path=/; SameSite=Lax';
  }

  // SSE Connection Management
  async function openSSEConnection() {
    if (eventSource) return; // Already connected

    const vid = await getVisitorId();
    eventSource = new EventSource(`/api/threads/${vid}/stream`);

    eventSource.onopen = () => {
      isConnected = true;
      updateConnectionStatus(true);
      console.log('SSE connected');
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'init') {
          // Initial load handled elsewhere
          return;
        }

        if (data.type === 'new-message' && data.message) {
          handleNewMessage(data.message);
        }
      } catch (error) {
        console.error('SSE message error:', error);
      }
    };

    eventSource.onerror = () => {
      isConnected = false;
      updateConnectionStatus(false);
      console.log('SSE disconnected, will reconnect...');

      // EventSource auto-reconnects, but if it fails repeatedly, close it
      setTimeout(() => {
        if (eventSource && eventSource.readyState === EventSource.CLOSED) {
          eventSource = null;
        }
      }, 5000);
    };
  }

  function closeSSEConnection() {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
      isConnected = false;
      updateConnectionStatus(false);
      console.log('SSE closed');
    }
  }

  function handleNewMessage(message) {
    // Only handle messages from David (our replies)
    if (message.from !== 'david') return;

    lastMessageId = message.id;

    // If panel is open, append message to conversation
    const panel = document.getElementById('feedback-panel');
    if (expanded && !panel.classList.contains('hidden')) {
      appendMessageToConversation(message);
    } else {
      // Panel closed - show badge
      updateBadge(1);
    }
  }

  function appendMessageToConversation(message) {
    const conv = document.querySelector('.conversation');
    if (!conv) return;

    // Check if user has scrolled up
    const wasAtBottom = conv.scrollHeight - conv.scrollTop <= conv.clientHeight + 50;

    // Create message element
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${message.from}`;
    msgDiv.style.opacity = '0';
    msgDiv.style.transition = 'opacity 0.3s ease-in';
    msgDiv.innerHTML = `
      <div class="author">${message.from === 'david' ? 'David' : 'You'}</div>
      <div class="text">${escapeHtml(message.text)}</div>
      <div class="time">${formatTime(message.ts)}</div>
    `;

    conv.appendChild(msgDiv);

    // Fade in
    setTimeout(() => msgDiv.style.opacity = '1', 10);

    // Scroll to bottom if user was already there
    if (wasAtBottom) {
      setTimeout(() => conv.scrollTop = conv.scrollHeight, 100);
    }
  }

  function updateConnectionStatus(connected) {
    const statusEl = document.getElementById('connection-status');
    if (!statusEl) return;

    if (connected) {
      statusEl.textContent = '🟢';
      statusEl.title = 'Connected';
    } else {
      statusEl.textContent = '🔴';
      statusEl.title = 'Reconnecting...';
    }
  }

  // Create widget HTML
  function createWidget() {
    const widget = document.createElement('div');
    widget.id = 'feedback-widget';
    widget.innerHTML = `
      <style>
        #feedback-widget {
          position: fixed;
          bottom: 20px;
          right: 20px;
          z-index: 9999;
          font-family: 'MS Sans Serif', sans-serif;
        }

        #feedback-button {
          position: relative;
          background: var(--win98-face);
          border: 2px solid;
          border-color: var(--win98-highlight) var(--win98-shadow) var(--win98-shadow) var(--win98-highlight);
          padding: 8px 16px;
          cursor: pointer;
          font-size: 14px;
          font-weight: bold;
          box-shadow: 2px 2px 4px rgba(0,0,0,0.3);
          transition: all 0.1s;
        }

        #feedback-button:hover {
          filter: brightness(1.05);
        }

        #feedback-button:active {
          border-color: var(--win98-shadow) var(--win98-highlight) var(--win98-highlight) var(--win98-shadow);
          padding: 9px 15px 7px 17px;
        }

        .badge {
          position: absolute;
          top: -8px;
          right: -8px;
          background: #ff0000;
          color: white;
          border-radius: 50%;
          width: 20px;
          height: 20px;
          display: none;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: bold;
          border: 2px solid var(--win98-face);
          animation: pulse 1s ease-in-out infinite;
        }

        .badge.show {
          display: flex;
        }

        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.1); }
        }

        #feedback-toast {
          background: var(--win98-face);
          border: 2px solid;
          border-color: var(--win98-highlight) var(--win98-shadow) var(--win98-shadow) var(--win98-highlight);
          padding: 12px 16px;
          margin-bottom: 8px;
          box-shadow: 2px 2px 4px rgba(0,0,0,0.3);
          animation: slideIn 0.3s ease-out;
        }

        #feedback-panel {
          background: var(--win98-face);
          border: 2px solid;
          border-color: var(--win98-highlight) var(--win98-shadow) var(--win98-shadow) var(--win98-highlight);
          width: 340px;
          box-shadow: 2px 2px 4px rgba(0,0,0,0.3);
          animation: slideIn 0.3s ease-out;
          margin-bottom: 8px;
        }

        #feedback-panel .title-bar {
          background: linear-gradient(90deg, #000080, #1084d0);
          color: white;
          padding: 2px 4px;
          font-weight: bold;
          font-size: 11px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        #feedback-panel .close-btn {
          background: var(--win98-face);
          border: 1px solid;
          border-color: var(--win98-highlight) var(--win98-shadow) var(--win98-shadow) var(--win98-highlight);
          width: 16px;
          height: 14px;
          font-size: 11px;
          line-height: 10px;
          cursor: pointer;
          padding: 0;
        }

        #feedback-panel .content {
          padding: 12px;
        }

        #feedback-panel h3 {
          margin: 0 0 8px 0;
          font-size: 14px;
        }

        .conversation {
          max-height: 300px;
          overflow-y: auto;
          margin-bottom: 12px;
          border: 2px solid;
          border-color: var(--win98-shadow) var(--win98-highlight) var(--win98-highlight) var(--win98-shadow);
          background: white;
          padding: 8px;
        }

        .message {
          margin-bottom: 12px;
          padding: 8px;
          border-radius: 4px;
        }

        .message.visitor {
          background: #e8f4f8;
          margin-left: 20px;
        }

        .message.david {
          background: #f0f0f0;
          margin-right: 20px;
        }

        .message .author {
          font-weight: bold;
          font-size: 11px;
          margin-bottom: 4px;
          color: #000080;
        }

        .message .text {
          font-size: 12px;
          line-height: 1.4;
          word-wrap: break-word;
        }

        .message .time {
          font-size: 10px;
          color: #666;
          margin-top: 4px;
        }

        #feedback-panel textarea {
          width: 100%;
          height: 80px;
          padding: 4px;
          font-family: 'Courier New', monospace;
          font-size: 12px;
          border: 2px solid;
          border-color: var(--win98-shadow) var(--win98-highlight) var(--win98-highlight) var(--win98-shadow);
          background: white;
          resize: none;
          box-sizing: border-box;
        }

        #feedback-panel .char-count {
          font-size: 11px;
          color: #666;
          margin-top: 4px;
          text-align: right;
        }

        #feedback-panel button {
          background: var(--win98-face);
          border: 2px solid;
          border-color: var(--win98-highlight) var(--win98-shadow) var(--win98-shadow) var(--win98-highlight);
          padding: 6px 20px;
          cursor: pointer;
          font-size: 12px;
          font-weight: bold;
          margin-top: 8px;
          width: 100%;
        }

        #feedback-panel button:hover {
          filter: brightness(1.05);
        }

        #feedback-panel button:active {
          border-color: var(--win98-shadow) var(--win98-highlight) var(--win98-highlight) var(--win98-shadow);
          padding: 7px 19px 5px 21px;
        }

        #feedback-panel button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        #connection-status {
          font-size: 8px;
          margin-left: 4px;
        }

        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .hidden {
          display: none !important;
        }
      </style>

      <div id="feedback-toast" class="hidden"></div>
      <div id="feedback-panel" class="hidden">
        <div class="title-bar">
          <span>📬 Send Message <span id="connection-status"></span></span>
          <button class="close-btn" onclick="window.feedbackWidget.closePanel()">×</button>
        </div>
        <div class="content">
          <h3>Text me directly. Right now.</h3>
          <p style="font-size: 12px; margin-bottom: 12px;">Type anything and it goes straight to my phone. Try "banana" and I'll reply with proof 🍌</p>
          <div class="conversation-container"></div>
          <textarea id="feedback-text" placeholder="Say anything..." maxlength="280"></textarea>
          <div class="char-count"><span id="char-count">0</span>/280</div>
          <button id="send-btn" onclick="window.feedbackWidget.sendMessage()">Send message →</button>
        </div>
      </div>
      <button id="feedback-button" onclick="window.feedbackWidget.handleClick()">
        👋 I'm a real person
      </button>
    `;
    document.body.appendChild(widget);
  }

  // API calls
  async function sendFeedback(type, text = null) {
    const vid = await getVisitorId();

    const response = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        visitorId: vid,
        type,
        text,
        page: window.location.pathname,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return response.json();
  }

  async function loadConversation() {
    try {
      const vid = await getVisitorId();
      const response = await fetch(`/api/threads/${vid}/messages`);
      if (!response.ok) return [];

      const data = await response.json();
      return data.messages || [];
    } catch (error) {
      console.error('Error loading conversation:', error);
      return [];
    }
  }

  // Helper functions
  function formatTime(ts) {
    const date = new Date(ts);
    const now = new Date();
    const diff = now - date;

    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
    return date.toLocaleDateString();
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function renderConversation(messages) {
    if (!messages || messages.length === 0) {
      return '<div class="conversation"><p style="text-align: center; color: #666; font-size: 12px; padding: 20px;">No messages yet</p></div>';
    }

    const html = messages.map(m => `
      <div class="message ${m.from}">
        <div class="author">${m.from === 'david' ? 'David' : 'You'}</div>
        <div class="text">${escapeHtml(m.text)}</div>
        <div class="time">${formatTime(m.ts)}</div>
      </div>
    `).join('');

    return `<div class="conversation">${html}</div>`;
  }

  function updateCharCount() {
    const textarea = document.getElementById('feedback-text');
    const counter = document.getElementById('char-count');
    if (textarea && counter) {
      counter.textContent = textarea.value.length;
    }
  }

  function updateBadge(count) {
    const button = document.getElementById('feedback-button');
    if (!button) return;

    let badge = button.querySelector('.badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'badge';
      button.appendChild(badge);
    }
    badge.textContent = count;

    if (count > 0) {
      badge.classList.add('show');
    } else {
      badge.classList.remove('show');
    }
  }

  function updateConnectionStatus(connected) {
    const statusEl = document.getElementById('connection-status');
    if (statusEl) {
      statusEl.textContent = connected ? '🟢' : '🔴';
      statusEl.title = connected ? 'Connected' : 'Reconnecting...';
    }
  }

  // Widget actions
  const widget = {
    handleClick: async function() {
      if (expanded) return;

      try {
        // Load existing conversation
        const messages = await loadConversation();
        const container = document.querySelector('.conversation-container');

        // If no messages, send ping first
        if (messages.length === 0) {
          const result = await sendFeedback('ping');

          const toast = document.getElementById('feedback-toast');
          toast.textContent = `✓ David's phone just buzzed (you're human #${result.count || '?'} today)`;
          toast.classList.remove('hidden');

          if (result.messageId) {
            lastMessageId = result.messageId;
          }

          // Show empty conversation
          container.innerHTML = renderConversation([]);
        } else {
          // Show existing conversation
          container.innerHTML = renderConversation(messages);
          lastMessageId = messages[messages.length - 1].id;

          // Clear badge
          updateBadge(0);

          // Scroll to bottom
          setTimeout(() => {
            const conv = container.querySelector('.conversation');
            if (conv) conv.scrollTop = conv.scrollHeight;
          }, 50);
        }

        // Show panel
        const panel = document.getElementById('feedback-panel');
        panel.classList.remove('hidden');
        expanded = true;

        // Open SSE connection for live updates
        openSSEConnection();

        // Focus textarea
        const textarea = document.getElementById('feedback-text');
        if (textarea) {
          textarea.focus();
          textarea.addEventListener('input', updateCharCount);
        }

      } catch (error) {
        console.error('Feedback error:', error);
        const toast = document.getElementById('feedback-toast');
        toast.textContent = '❌ Oops, something broke. Try again?';
        toast.classList.remove('hidden');
      }
    },

    sendMessage: async function() {
      const textarea = document.getElementById('feedback-text');
      const text = textarea.value.trim();

      if (!text) return;

      const btn = document.getElementById('send-btn');
      btn.disabled = true;
      btn.textContent = 'Sending...';

      try {
        const result = await sendFeedback('message', text);

        if (result.messageId) {
          lastMessageId = result.messageId;
        }

        // Clear textarea
        textarea.value = '';
        updateCharCount();

        // Add message to conversation immediately (optimistic)
        const message = {
          id: result.messageId,
          from: 'visitor',
          text,
          ts: Date.now(),
        };
        appendMessageToConversation(message);

        // Reset button
        btn.disabled = false;
        btn.textContent = 'Send message →';

      } catch (error) {
        console.error('Send error:', error);
        btn.textContent = '❌ Failed. Try again?';
        btn.disabled = false;
        setTimeout(() => {
          btn.textContent = 'Send message →';
        }, 2000);
      }
    },

    closePanel: function() {
      const panel = document.getElementById('feedback-panel');
      const toast = document.getElementById('feedback-toast');

      panel.classList.add('hidden');
      toast.classList.add('hidden');
      expanded = false;

      // Close SSE connection when panel closes
      closeSSEConnection();
    }
  };

  // Initialize
  document.addEventListener('DOMContentLoaded', async () => {
    createWidget();
    visitorId = await getVisitorId();

    // Check for unread messages on load
    const messages = await loadConversation();
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.from === 'david') {
        // Has unread reply from David
        updateBadge(1);
        lastMessageId = lastMessage.id;
      }
    }
  });

  // Expose to global scope
  window.feedbackWidget = widget;
})();
