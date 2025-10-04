// Feedback widget for drose.io - Clean template version
(function() {
  'use strict';

  // Widget state
  let expanded = false;
  let visitorId = null;
  let lastMessageId = null;
  let isConnected = false;
  let textareaHandlers = null;

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
  let abortController = null;
  let reconnectTimer = null;

  async function openSSEConnection() {
    if (abortController) return;

    const vid = await getVisitorId();
    const url = `/api/threads/${vid}/stream`;
    abortController = new AbortController();

    try {
      const response = await fetch(url, {
        headers: {
          'Accept': 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`SSE connection failed: ${response.status}`);
      }

      isConnected = true;
      updateConnectionStatus(true);

      // Parse SSE stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let eventName = '';
      let dataLines = [];

      while (isConnected && abortController) {
        const {value, done} = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, {stream: true});

        while (true) {
          const newlineIndex = buffer.indexOf('\n');
          if (newlineIndex === -1) break;

          let line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);

          if (line.endsWith('\r')) line = line.slice(0, -1);

          // Empty line = dispatch event
          if (line === '') {
            if (dataLines.length > 0) {
              const data = dataLines.join('\n');

              if (eventName === 'new-message' || !eventName) {
                try {
                  const parsed = JSON.parse(data);
                  if (parsed.type !== 'init' && parsed.message) {
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

          // Skip comments
          if (line.startsWith(':')) continue;

          // Parse field: value
          const colonIndex = line.indexOf(':');
          if (colonIndex === -1) continue;

          const field = line.slice(0, colonIndex);
          let value = line.slice(colonIndex + 1);
          if (value.startsWith(' ')) value = value.slice(1);

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
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function handleNewMessage(message) {
    if (message.from !== 'david') return;

    lastMessageId = message.id;

    const panel = document.getElementById('feedback-panel');
    if (expanded && !panel.classList.contains('hidden')) {
      appendMessageToConversation(message);
    } else {
      updateBadge(1);
    }
  }

  function appendMessageToConversation(message) {
    const container = document.querySelector('.conversation-container');
    if (!container) return;

    let conv = container.querySelector('.conversation');
    if (!conv) return;

    // If this is the first real message, rebuild the conversation without placeholder
    const hasOnlyPlaceholder = conv.querySelector('.empty-placeholder') !== null;
    const hasNoMessages = conv.querySelectorAll('.message').length === 0;

    if (hasOnlyPlaceholder || hasNoMessages) {
      container.innerHTML = '<div class="conversation"></div>';
      conv = container.querySelector('.conversation');
    }

    const wasAtBottom = conv.scrollHeight - conv.scrollTop <= conv.clientHeight + 50;

    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${message.from}`;
    msgDiv.style.opacity = '0';
    msgDiv.style.transition = 'opacity 0.3s ease-in';
    msgDiv.innerHTML = `
      <div class="author">${getAuthorName(message.from)}</div>
      <div class="text">${escapeHtml(message.text)}</div>
      <div class="time">${formatTime(message.ts)}</div>
    `;

    conv.appendChild(msgDiv);
    requestAnimationFrame(() => {
      msgDiv.style.opacity = '1';
      if (wasAtBottom) {
        conv.scrollTop = conv.scrollHeight;
      }
    });
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

  function showToast(message, duration = 3000) {
    const toast = document.getElementById('feedback-toast');
    if (!toast) return;

    toast.textContent = message;
    toast.classList.remove('hidden');

    setTimeout(() => {
      toast.classList.add('hidden');
    }, duration);
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

  function getAuthorName(from) {
    return from === 'david' ? 'David' : 'You';
  }

  function renderConversation(messages) {
    if (!messages || messages.length === 0) {
      return '<div class="conversation"><p class="empty-placeholder" style="text-align: center; color: #666; font-size: 12px; padding: 20px;">No messages yet</p></div>';
    }

    const html = messages.map(m => `
      <div class="message ${m.from}">
        <div class="author">${getAuthorName(m.from)}</div>
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

          showToast(`✓ David's phone just buzzed (you're human #${result.count || '?'} today)`);

          if (result.messageId) {
            lastMessageId = result.messageId;
          }

          container.innerHTML = renderConversation([]);
        } else {
          container.innerHTML = renderConversation(messages);
          lastMessageId = messages[messages.length - 1].id;

          updateBadge(0);

          requestAnimationFrame(() => {
            const conv = container.querySelector('.conversation');
            if (conv) conv.scrollTop = conv.scrollHeight;
          });
        }

        const panel = document.getElementById('feedback-panel');
        panel.classList.remove('hidden');
        expanded = true;

        openSSEConnection();

        const textarea = document.getElementById('feedback-text');
        if (textarea) {
          // Remove old listeners if they exist
          if (textareaHandlers) {
            textarea.removeEventListener('input', textareaHandlers.input);
            textarea.removeEventListener('keydown', textareaHandlers.keydown);
          }

          // Create new handlers
          textareaHandlers = {
            input: updateCharCount,
            keydown: (e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                widget.sendMessage();
              }
            }
          };

          textarea.addEventListener('input', textareaHandlers.input);
          textarea.addEventListener('keydown', textareaHandlers.keydown);
          textarea.focus();
        }

      } catch (error) {
        console.error('Feedback error:', error);
        showToast('❌ Oops, something broke. Try again?');
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
        showToast('❌ Failed. Try again?', 2000);
        btn.disabled = false;
        btn.textContent = 'Send message →';
      }
    },

    closePanel: function() {
      const panel = document.getElementById('feedback-panel');
      const toast = document.getElementById('feedback-toast');

      // Clean up event listeners
      const textarea = document.getElementById('feedback-text');
      if (textarea && textareaHandlers) {
        textarea.removeEventListener('input', textareaHandlers.input);
        textarea.removeEventListener('keydown', textareaHandlers.keydown);
        textareaHandlers = null;
      }

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
