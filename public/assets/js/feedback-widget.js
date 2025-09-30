// Feedback widget for drose.io
(function() {
  'use strict';

  // Widget state
  let expanded = false;
  let showingConfirmation = false;
  let visitorId = null;
  let lastMessageId = null;
  let pollingInterval = null;

  // Device ID generation (extensible for future fingerprinting)
  async function getVisitorId() {
    // Try localStorage first (primary)
    let id = localStorage.getItem('__vid');
    if (id) return id;

    // Try cookie (fallback)
    const cookieId = getCookie('__vid');
    if (cookieId) {
      localStorage.setItem('__vid', cookieId);
      return cookieId;
    }

    // Generate new ID (simple UUID for now)
    id = generateUUID();

    // Store in both places
    localStorage.setItem('__vid', id);
    setCookie('__vid', id, 365 * 10); // 10 years

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
          width: 320px;
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

        #feedback-panel p {
          margin: 0 0 12px 0;
          font-size: 12px;
          line-height: 1.4;
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

        .badge {
          position: absolute;
          top: -8px;
          right: -8px;
          background: #ff0000;
          color: white;
          border-radius: 50%;
          width: 20px;
          height: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: bold;
          border: 2px solid var(--win98-face);
        }

        .conversation {
          max-height: 250px;
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
          <span>📬 Send Message</span>
          <button class="close-btn" onclick="window.feedbackWidget.closePanel()">×</button>
        </div>
        <div class="content">
          <h3>Text me directly. Right now.</h3>
          <p>Type anything and it goes straight to my phone. Try "banana" and I'll reply with proof 🍌</p>
          <textarea id="feedback-text" placeholder="Say anything..." maxlength="280"></textarea>
          <div class="char-count"><span id="char-count">0</span>/280</div>
          <button id="send-btn" onclick="window.feedbackWidget.sendMessage()">Send to David's phone →</button>
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

  async function checkForReplies() {
    const vid = await getVisitorId();
    const since = lastMessageId || '';

    const response = await fetch(`/api/threads/${vid}/check?since=${since}`);
    if (!response.ok) return null;

    return response.json();
  }

  // Helper functions
  function formatTime(ts) {
    const date = new Date(ts);
    const now = new Date();
    const diff = now - date;

    // Less than 1 minute
    if (diff < 60000) return 'just now';

    // Less than 1 hour
    if (diff < 3600000) {
      const mins = Math.floor(diff / 60000);
      return `${mins}m ago`;
    }

    // Less than 24 hours
    if (diff < 86400000) {
      const hours = Math.floor(diff / 3600000);
      return `${hours}h ago`;
    }

    // Less than 7 days
    if (diff < 604800000) {
      const days = Math.floor(diff / 86400000);
      return `${days}d ago`;
    }

    // Format as date
    return date.toLocaleDateString();
  }

  function renderConversation(messages) {
    if (!messages || messages.length === 0) {
      return '<p style="text-align: center; color: #666; font-size: 12px;">No messages yet</p>';
    }

    return messages.map(m => `
      <div class="message ${m.from}">
        <div class="author">${m.from === 'david' ? 'David' : 'You'}</div>
        <div class="text">${escapeHtml(m.text)}</div>
        <div class="time">${formatTime(m.ts)}</div>
      </div>
    `).join('');
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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

  // Widget actions
  const widget = {
    handleClick: async function() {
      if (expanded) return;

      try {
        // Load existing conversation
        const messages = await loadConversation();

        // If no messages, send ping
        if (messages.length === 0) {
          const result = await sendFeedback('ping');

          // Show confirmation toast
          const toast = document.getElementById('feedback-toast');
          toast.textContent = `✓ David's phone just buzzed (you're human #${result.count || '?'} today)`;
          toast.classList.remove('hidden');
          showingConfirmation = true;

          // Update lastMessageId
          if (result.messageId) {
            lastMessageId = result.messageId;
          }
        } else {
          // Update lastMessageId to latest
          lastMessageId = messages[messages.length - 1].id;

          // Clear badge
          updateBadge(0);
        }

        // Update panel with conversation
        const panel = document.getElementById('feedback-panel');
        const contentDiv = panel.querySelector('.content');

        if (messages.length > 0) {
          contentDiv.innerHTML = `
            <h3>💬 Conversation</h3>
            <div class="conversation">
              ${renderConversation(messages)}
            </div>
            <textarea id="feedback-text" placeholder="Type your reply..." maxlength="280"></textarea>
            <div class="char-count"><span id="char-count">0</span>/280</div>
            <button id="send-btn" onclick="window.feedbackWidget.sendMessage()">Send reply →</button>
          `;

          // Re-attach character counter
          const textarea = contentDiv.querySelector('#feedback-text');
          if (textarea) {
            textarea.addEventListener('input', updateCharCount);
          }

          // Scroll to bottom of conversation
          setTimeout(() => {
            const conv = contentDiv.querySelector('.conversation');
            if (conv) conv.scrollTop = conv.scrollHeight;
          }, 100);
        }

        // Show panel
        panel.classList.remove('hidden');
        expanded = true;

        const textarea = document.getElementById('feedback-text');
        if (textarea) textarea.focus();

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

        // Update lastMessageId
        if (result.messageId) {
          lastMessageId = result.messageId;
        }

        // Success!
        const toast = document.getElementById('feedback-toast');
        toast.textContent = '✓ Message sent! David will reply soon.';
        toast.classList.remove('hidden');

        // Reload conversation to show new message
        const messages = await loadConversation();
        const panel = document.getElementById('feedback-panel');
        const contentDiv = panel.querySelector('.content');

        contentDiv.innerHTML = `
          <h3>💬 Conversation</h3>
          <div class="conversation">
            ${renderConversation(messages)}
          </div>
          <textarea id="feedback-text" placeholder="Type your reply..." maxlength="280"></textarea>
          <div class="char-count"><span id="char-count">0</span>/280</div>
          <button id="send-btn" onclick="window.feedbackWidget.sendMessage()">Send reply →</button>
        `;

        // Re-attach character counter
        const newTextarea = contentDiv.querySelector('#feedback-text');
        if (newTextarea) {
          newTextarea.addEventListener('input', updateCharCount);
        }

        // Scroll to bottom
        setTimeout(() => {
          const conv = contentDiv.querySelector('.conversation');
          if (conv) conv.scrollTop = conv.scrollHeight;
        }, 100);

      } catch (error) {
        console.error('Send error:', error);
        btn.textContent = '❌ Failed. Try again?';
        btn.disabled = false;
        setTimeout(() => {
          btn.textContent = 'Send reply →';
        }, 2000);
      }
    },

    closePanel: function() {
      document.getElementById('feedback-panel').classList.add('hidden');
      document.getElementById('feedback-toast').classList.add('hidden');
      expanded = false;
      showingConfirmation = false;
    }
  };

  // Character counter
  function updateCharCount() {
    const textarea = document.getElementById('feedback-text');
    const counter = document.getElementById('char-count');
    if (textarea && counter) {
      counter.textContent = textarea.value.length;
    }
  }

  // Polling for replies
  async function startPolling() {
    if (pollingInterval) return;

    pollingInterval = setInterval(async () => {
      try {
        const data = await checkForReplies();
        if (data && data.unreadCount > 0) {
          updateBadge(data.unreadCount);

          // Update lastMessageId
          if (data.messages && data.messages.length > 0) {
            lastMessageId = data.messages[data.messages.length - 1].id;
          }
        }
      } catch (error) {
        console.error('Polling error:', error);
      }
    }, 30000); // Every 30 seconds
  }

  function updateBadge(count) {
    const button = document.getElementById('feedback-button');
    if (!button) return;

    // Add red dot with count
    let badge = button.querySelector('.badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'badge';
      button.appendChild(badge);
    }
    badge.textContent = count;
    badge.style.display = count > 0 ? 'inline-block' : 'none';
  }

  // Initialize
  document.addEventListener('DOMContentLoaded', async () => {
    createWidget();

    // Add character counter listener
    const textarea = document.getElementById('feedback-text');
    if (textarea) {
      textarea.addEventListener('input', updateCharCount);
    }

    // Initialize visitor ID and start polling
    visitorId = await getVisitorId();
    startPolling();

    // Check immediately for any existing replies
    const data = await checkForReplies();
    if (data && data.unreadCount > 0) {
      updateBadge(data.unreadCount);
    }
  });

  // Expose to global scope
  window.feedbackWidget = widget;
})();
