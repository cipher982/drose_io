// Feedback widget for drose.io - Clean template version
(function() {
  'use strict';

  // Widget state
  let expanded = false;
  let visitorId = null;
  let lastMessageId = null;
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

  // SSE Connection Management (using fetch() instead of EventSource for Cloudflare compatibility)
  let abortController = null;
  let reconnectTimer = null;

  async function openSSEConnection() {
    console.log('🔵 openSSEConnection() called');
    if (abortController) {
      console.log('⏭️ Already connected, skipping');
      return;
    }

    const vid = await getVisitorId();
    const url = `/api/threads/${vid}/stream`;
    console.log('🔌 Connecting to:', url);

    abortController = new AbortController();

    try {
      console.log('📡 Fetching SSE stream...');
      const response = await fetch(url, {
        headers: {
          'Accept': 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
        signal: abortController.signal,
      });

      console.log('📡 Response status:', response.status, response.statusText);

      if (!response.ok) {
        throw new Error(`SSE connection failed: ${response.status}`);
      }

      isConnected = true;
      updateConnectionStatus(true);
      console.log('🟢 Visitor SSE connected (fetch)');
      console.log('📖 Starting to read stream...');

      // Parse SSE stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let eventName = '';
      let dataLines = [];

      while (isConnected && abortController) {
        const {value, done} = await reader.read();
        if (done) {
          console.log('📭 Stream ended');
          break;
        }

        const chunk = decoder.decode(value, {stream: true});
        console.log('📦 Received chunk:', chunk.length, 'bytes');
        buffer += chunk;

        while (true) {
          const newlineIndex = buffer.indexOf('\n');
          if (newlineIndex === -1) break;

          let line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);

          if (line.endsWith('\r')) {
            line = line.slice(0, -1);
          }

          // Empty line = dispatch event
          if (line === '') {
            if (dataLines.length > 0) {
              const data = dataLines.join('\n');
              console.log('📨 Visitor SSE received event:', eventName || 'message', data.substring(0, 100));

              if (eventName === 'new-message' || !eventName) {
                try {
                  const parsed = JSON.parse(data);
                  if (parsed.type === 'init') continue;
                  if (parsed.message) {
                    console.log('✅ Handling message from:', parsed.message.from);
                    handleNewMessage(parsed.message);
                  }
                } catch (error) {
                  console.error('SSE parse error:', error);
                }
              }

              eventName = '';
              dataLines = [];
            }
            continue;
          }

          // Comment line
          if (line.startsWith(':')) {
            continue; // Ignore keep-alive pings
          }

          // Field: value
          const colonIndex = line.indexOf(':');
          if (colonIndex === -1) continue;

          const field = line.slice(0, colonIndex);
          let value = line.slice(colonIndex + 1);
          if (value.startsWith(' ')) {
            value = value.slice(1);
          }

          if (field === 'event') {
            eventName = value;
          } else if (field === 'data') {
            dataLines.push(value);
          }
        }
      }

    } catch (error) {
      if (error.name === 'AbortError') return; // Normal close

      console.error('SSE connection error:', error);
      isConnected = false;
      updateConnectionStatus(false);
      abortController = null;

      // Reconnect after 2 seconds
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        openSSEConnection();
      }, 2000);
    }
  }

  function closeSSEConnection() {
    if (abortController) {
      abortController.abort();
      abortController = null;
      isConnected = false;
      updateConnectionStatus(false);
      console.log('SSE closed');
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
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
    closeSSEConnection();
  }

  function handleOnline() {
    if (!abortController) {
      openSSEConnection();
    }
  }

  function updateBadge(count) {
    const notification = document.getElementById('feedback-notification');
    if (notification) {
      notification.classList.toggle('hidden', count === 0);
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
