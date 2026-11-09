// Helpers shared by the visitor chat and the admin inbox.

export function connect({ path, onOpen, onEvent, onClose }) {
  let ws;
  let delay = 500;
  let stopped = false;

  const open = () => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}${typeof path === 'function' ? path() : path}`);
    ws.onopen = () => {
      delay = 500;
      onOpen?.();
    };
    ws.onmessage = (e) => onEvent(JSON.parse(e.data));
    ws.onclose = () => {
      onClose?.();
      if (!stopped) setTimeout(open, (delay = Math.min(delay * 2, 10000)));
    };
  };
  open();

  return {
    send: (payload) => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify(payload)),
    close: () => {
      stopped = true;
      ws?.close();
    },
  };
}

// Uses textContent only, so message text is never parsed as HTML.
export function messageEl(message, avatarLabel = 'A') {
  const row = document.createElement('div');
  row.className = `message ${message.role}`;

  if (message.role === 'assistant') {
    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = avatarLabel;
    row.append(avatar);
  }

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = message.text;
  row.append(bubble);
  return row;
}

export function typingEl() {
  const row = document.createElement('div');
  row.className = 'message assistant typing';
  row.innerHTML = '<div class="avatar">A</div><div class="bubble"><span></span><span></span><span></span></div>';
  return row;
}

export function scrollToBottom(container) {
  container.scrollTop = container.scrollHeight;
}

// Enter sends, Shift+Enter inserts a newline. Calls onTyping at most every 2s.
export function bindComposer({ form, input, onSend, onTyping }) {
  const resize = () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 200)}px`;
  };
  const submit = () => {
    const text = input.value.trim();
    if (!text) return;
    onSend(text);
    input.value = '';
    resize();
  };

  let lastTyping = 0;
  input.addEventListener('input', () => {
    resize();
    const now = Date.now();
    if (onTyping && now - lastTyping > 2000) {
      lastTyping = now;
      onTyping();
    }
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submit();
    }
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submit();
  });
}
