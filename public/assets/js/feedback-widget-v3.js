// Feedback widget for drose.io - Clean template version
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
    if (eventSource) return;

    const vid = await getVisitorId();
    eventSource = new EventSource(`/api/threads/${vid}/stream`);

    eventSource.onopen = () => {
      isConnected = true;
      updateConnectionStatus(true);
      console.log('🟢 Visitor SSE connected');
    };

    // Listen for named 'new-message' events (consistent with admin)
    eventSource.addEventListener('new-message', (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('📨 Visitor SSE received new-message:', data);

        if (data.type === 'init') return;

        if (data.message) {
          console.log('✅ Handling new message from:', data.message.from);
          handleNewMessage(data.message);
        }
      } catch (error) {
        console.error('SSE message error:', error);
      }
    });

    eventSource.onerror = () => {
      isConnected = false;
      updateConnectionStatus(false);
      console.log('SSE disconnected, will reconnect...');

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
    console.log('📬 handleNewMessage called:', { from: message.from, expanded, panelHidden: document.getElementById('feedback-panel')?.classList.contains('hidden') });

    if (message.from !== 'david') {
      console.log('⏭️ Skipping: not from david');
      return;
    }

    lastMessageId = message.id;

    const panel = document.getElementById('feedback-panel');
    if (expanded && !panel.classList.contains('hidden')) {
      console.log('💬 Appending message to conversation');
      appendMessageToConversation(message);
    } else {
      console.log('🔔 Showing badge instead (panel not visible)');
      updateBadge(1);
    }
  }

  function appendMessageToConversation(message) {
    const conv = document.querySelector('.conversation');
    if (!conv) return;

    const wasAtBottom = conv.scrollHeight - conv.scrollTop <= conv.clientHeight + 50;

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
    setTimeout(() => msgDiv.style.opacity = '1', 10);

    if (wasAtBottom) {
      setTimeout(() => conv.scrollTop = conv.scrollHeight, 100);
    }
  }

  function updateConnectionStatus(connected) {
    const statusEl = document.getElementById('connection-status');
    if (statusEl) {
      statusEl.textContent = connected ? '🟢' : '🔴';
      statusEl.title = connected ? 'Connected' : 'Reconnecting...';
    }
  }


  function handleOffline() {
    isConnected = false;
    updateConnectionStatus(false);
    if (eventSource) {
      try {
        eventSource.close();
      } catch (error) {
        console.error('Error closing SSE on offline:', error);
      }
      eventSource = null;
    }
  }

  function handleOnline() {
    if (eventSource) {
      return;
    }
    openSSEConnection();
  }

  function updateBadge(count) {
    const badge = document.getElementById('badge-indicator');
    if (badge) {
      badge.classList.toggle('hidden', count === 0);
    }
  }

  // Load template and create widget
  async function createWidget() {
    try {
      const response = await fetch('/assets/templates/feedback-widget.html');
      if (!response.ok) throw new Error('Failed to load template');

      const html = await response.text();

      const widget = document.createElement('div');
      widget.id = 'feedback-widget';
      widget.innerHTML = html;

      document.body.appendChild(widget);
    } catch (error) {
      console.error('Failed to create widget:', error);
    }
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

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
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

  // Widget actions
  const widget = {
    handleClick: async function() {
      if (expanded) return;

      try {
        const messages = await loadConversation();
        const container = document.querySelector('.conversation-container');

        if (messages.length === 0) {
          const result = await sendFeedback('ping');

          const toast = document.getElementById('feedback-toast');
          toast.textContent = `✓ David's phone just buzzed (you're human #${result.count || '?'} today)`;
          toast.classList.remove('hidden');

          if (result.messageId) {
            lastMessageId = result.messageId;
          }

          container.innerHTML = renderConversation([]);
        } else {
          container.innerHTML = renderConversation(messages);
          lastMessageId = messages[messages.length - 1].id;

          updateBadge(0);

          setTimeout(() => {
            const conv = container.querySelector('.conversation');
            if (conv) conv.scrollTop = conv.scrollHeight;
          }, 50);
        }

        const panel = document.getElementById('feedback-panel');
        panel.classList.remove('hidden');
        expanded = true;

        openSSEConnection();

        const textarea = document.getElementById('feedback-text');
        if (textarea) {
          textarea.focus();
          textarea.addEventListener('input', updateCharCount);
          textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              widget.sendMessage();
            }
          });
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

        textarea.value = '';
        updateCharCount();

        const message = {
          id: result.messageId,
          from: 'visitor',
          text,
          ts: Date.now(),
        };
        appendMessageToConversation(message);

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
    }
  };

  // Initialize
  document.addEventListener('DOMContentLoaded', async () => {
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    await createWidget();
    visitorId = await getVisitorId();

    const messages = await loadConversation();
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      lastMessageId = lastMessage.id;

      if (lastMessage.from === 'david') {
        updateBadge(1);
      }
    }

    openSSEConnection();
  });

  // Expose to global scope
  window.feedbackWidget = widget;
})();
