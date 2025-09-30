// Feedback widget for drose.io
(function() {
  'use strict';

  // Widget state
  let expanded = false;
  let showingConfirmation = false;

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
    const response = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
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

  // Widget actions
  const widget = {
    handleClick: async function() {
      if (expanded) return;

      try {
        // Send ping
        const result = await sendFeedback('ping');

        // Show confirmation toast
        const toast = document.getElementById('feedback-toast');
        toast.textContent = `✓ David's phone just buzzed (you're human #${result.count || '?'} today)`;
        toast.classList.remove('hidden');
        showingConfirmation = true;

        // Expand panel after short delay
        setTimeout(() => {
          document.getElementById('feedback-panel').classList.remove('hidden');
          expanded = true;
          document.getElementById('feedback-text').focus();
        }, 1000);

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
        await sendFeedback('message', text);

        // Success!
        const toast = document.getElementById('feedback-toast');
        toast.textContent = '✓ Message sent! David will probably reply soon.';
        toast.classList.remove('hidden');

        // Hide panel
        document.getElementById('feedback-panel').classList.add('hidden');
        expanded = false;
        textarea.value = '';

      } catch (error) {
        console.error('Send error:', error);
        btn.textContent = '❌ Failed. Try again?';
      } finally {
        btn.disabled = false;
        setTimeout(() => {
          btn.textContent = 'Send to David\'s phone →';
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

  // Initialize
  document.addEventListener('DOMContentLoaded', () => {
    createWidget();

    // Add character counter listener
    const textarea = document.getElementById('feedback-text');
    if (textarea) {
      textarea.addEventListener('input', updateCharCount);
    }
  });

  // Expose to global scope
  window.feedbackWidget = widget;
})();
