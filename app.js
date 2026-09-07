const CONFIG = {
  API_URL: 'https://round-waterfall-6295.tr-kolesnik.workers.dev/v1/chat/completions',
  API_KEY: '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',
  MODEL: 'nvidia/nemotron-3-ultra-550b-a55b',
  STORAGE_KEY: 'iskra.chats.v1',
  MAX_CHATS: 40,
  MAX_HISTORY: 24,
  MAX_INPUT: 8000,
  SYSTEM: `Ты — ИСКРА, спокойный и точный ИИ-собеседник.
Отвечай на языке пользователя. Пиши ясно, без воды, без лести и без эмодзи, если они не нужны по смыслу.
Если не уверен — скажи об этом. Форматируй ответы аккуратно: короткие абзацы, списки, код в блоках.`
};

function uid() {
  return crypto.randomUUID?.() || String(Date.now()) + Math.random().toString(16).slice(2);
}

function titleFrom(text) {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return 'Новый разговор';
  return t.length > 48 ? t.slice(0, 48).trimEnd() + '…' : t;
}

const store = {
  chats: [],
  activeId: null,

  load() {
    try {
      const raw = localStorage.getItem(CONFIG.STORAGE_KEY);
      if (!raw) return;
      const p = JSON.parse(raw);
      if (p?.v === 1 && Array.isArray(p.chats)) {
        this.chats = p.chats;
        this.activeId = p.activeId;
      }
    } catch (_) {}
  },

  save() {
    try {
      localStorage.setItem(
        CONFIG.STORAGE_KEY,
        JSON.stringify({ v: 1, chats: this.chats, activeId: this.activeId })
      );
    } catch (_) {}
  },

  active() {
    return this.chats.find((c) => c.id === this.activeId) || null;
  },

  newChat() {
    const id = uid();
    this.chats.unshift({
      id,
      title: 'Новый разговор',
      messages: [],
      updatedAt: Date.now()
    });
    this.activeId = id;
    if (this.chats.length > CONFIG.MAX_CHATS) {
      this.chats = this.chats.slice(0, CONFIG.MAX_CHATS);
    }
    this.save();
    return id;
  },

  select(id) {
    this.activeId = id;
    this.save();
  },

  delete(id) {
    this.chats = this.chats.filter((c) => c.id !== id);
    if (this.activeId === id) {
      this.activeId = this.chats[0]?.id || null;
    }
    this.save();
  },

  ensureActive() {
    if (!this.activeId || !this.active()) this.newChat();
    return this.active();
  },

  addUser(text) {
    const chat = this.ensureActive();
    chat.messages.push({ id: uid(), role: 'user', content: text });
    if (chat.title === 'Новый разговор') chat.title = titleFrom(text);
    chat.updatedAt = Date.now();
    this.save();
    return chat;
  },

  addAssistantPlaceholder() {
    const chat = this.active();
    const id = uid();
    chat.messages.push({ id, role: 'assistant', content: '' });
    chat.updatedAt = Date.now();
    this.save();
    return id;
  },

  append(assistantId, chunk) {
    const chat = this.active();
    const m = chat?.messages.find((x) => x.id === assistantId);
    if (m) {
      m.content += chunk;
      chat.updatedAt = Date.now();
      this.save();
    }
  },

  dropEmpty(assistantId) {
    const chat = this.active();
    if (!chat) return;
    const m = chat.messages.find((x) => x.id === assistantId);
    if (m && !m.content.trim()) {
      chat.messages = chat.messages.filter((x) => x.id !== assistantId);
      this.save();
    }
  }
};

const el = {
  sidebar: document.getElementById('sidebar'),
  backdrop: document.getElementById('backdrop'),
  chatList: document.getElementById('chatList'),
  thread: document.getElementById('thread'),
  empty: document.getElementById('emptyState'),
  input: document.getElementById('input'),
  btnSend: document.getElementById('btnSend'),
  btnStop: document.getElementById('btnStop'),
  btnNew: document.getElementById('btnNew'),
  btnNewMobile: document.getElementById('btnNewMobile'),
  btnMenu: document.getElementById('btnMenu'),
  topTitle: document.getElementById('topTitle'),
  errorBar: document.getElementById('errorBar'),
  charCount: document.getElementById('charCount')
};

let streaming = false;
let abortCtrl = null;

function openSidebar() {
  el.sidebar.classList.add('open');
  el.backdrop.classList.add('show');
}
function closeSidebar() {
  el.sidebar.classList.remove('open');
  el.backdrop.classList.remove('show');
}

function setError(msg) {
  if (!msg) {
    el.errorBar.classList.add('hidden');
    el.errorBar.textContent = '';
    return;
  }
  el.errorBar.textContent = msg;
  el.errorBar.classList.remove('hidden');
}

function renderList() {
  el.chatList.innerHTML = '';
  store.chats.forEach((c) => {
    const row = document.createElement('div');
    row.className = 'chat-item' + (c.id === store.activeId ? ' active' : '');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chat-item-btn';
    btn.textContent = c.title;
    btn.addEventListener('click', () => {
      if (streaming) return;
      store.select(c.id);
      closeSidebar();
      renderAll();
    });
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'chat-item-del';
    del.title = 'Удалить';
    del.textContent = '×';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      if (streaming) return;
      store.delete(c.id);
      if (!store.activeId) store.newChat();
      renderAll();
    });
    row.appendChild(btn);
    row.appendChild(del);
    el.chatList.appendChild(row);
  });
}

function renderMarkdown(text) {
  if (typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
    return DOMPurify.sanitize(marked.parse(text || ''));
  }
  return (text || '').replace(/</g, '&lt;');
}

function renderThread() {
  const chat = store.active();
  el.topTitle.textContent = chat?.title || 'Новый разговор';
  el.thread.innerHTML = '';

  if (!chat || chat.messages.length === 0) {
    el.thread.appendChild(el.empty);
    el.empty.classList.remove('hidden');
    return;
  }
  el.empty.classList.add('hidden');

  chat.messages.forEach((m) => {
    const div = document.createElement('div');
    div.className = 'message ' + m.role;
    div.dataset.id = m.id;
    const role = document.createElement('div');
    role.className = 'message-role';
    role.textContent = m.role === 'user' ? 'Вы' : 'ИСКРА';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    if (m.role === 'assistant') {
      if (!m.content) {
        bubble.innerHTML = '<div class="thinking"><span></span><span></span><span></span></div>';
      } else {
        bubble.innerHTML = renderMarkdown(m.content);
      }
    } else {
      bubble.textContent = m.content;
    }
    div.appendChild(role);
    div.appendChild(bubble);
    el.thread.appendChild(div);
  });
  el.thread.scrollTop = el.thread.scrollHeight;
}

function updateAssistantBubble(id, content, showCursor) {
  const node = el.thread.querySelector(`[data-id="${id}"] .bubble`);
  if (!node) return;
  node.innerHTML = renderMarkdown(content) + (showCursor ? '<span class="cursor"></span>' : '');
  el.thread.scrollTop = el.thread.scrollHeight;
}

function renderAll() {
  renderList();
  renderThread();
  updateSendState();
}

function updateSendState() {
  const has = el.input.value.trim().length > 0;
  el.charCount.textContent = `${el.input.value.length} / ${CONFIG.MAX_INPUT}`;
  el.btnSend.disabled = streaming || !has;
  el.btnSend.classList.toggle('hidden', streaming);
  el.btnStop.classList.toggle('hidden', !streaming);
}

function autoResize() {
  el.input.style.height = 'auto';
  el.input.style.height = Math.min(el.input.scrollHeight, 180) + 'px';
}

async function streamChat(messages, onToken, signal) {
  const res = await fetch(CONFIG.API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${CONFIG.API_KEY}`,
      Accept: 'application/json'
    },
    body: JSON.stringify({
      model: CONFIG.MODEL,
      messages,
      stream: true,
      max_tokens: 4096,
      temperature: 1,
      top_p: 0.95
    }),
    signal
  });

  if (!res.ok) {
    let message = `Ошибка API ${res.status}`;
    try {
      const j = await res.json();
      message =
        (typeof j.error === 'string' && j.error) ||
        j.error?.message ||
        j.message ||
        message;
    } catch (_) {
      try {
        message = (await res.text()) || message;
      } catch (__) {}
    }
    throw new Error(message);
  }

  if (!res.body) throw new Error('Пустой ответ сервера');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const json = JSON.parse(data);
          if (json.error?.message) throw new Error(json.error.message);
          const token = json.choices?.[0]?.delta?.content;
          if (token) onToken(token);
        } catch (err) {
          if (err instanceof SyntaxError) continue;
          throw err;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function sendMessage(text) {
  const trimmed = (text || el.input.value).trim();
  if (!trimmed || streaming) return;
  if (trimmed.length > CONFIG.MAX_INPUT) return;

  setError(null);
  el.input.value = '';
  autoResize();

  store.addUser(trimmed);
  const assistantId = store.addAssistantPlaceholder();
  renderAll();

  const history = store
    .active()
    .messages.filter((m) => m.id !== assistantId && m.content.trim())
    .slice(-CONFIG.MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content }));

  const payload = [{ role: 'system', content: CONFIG.SYSTEM }, ...history];

  streaming = true;
  updateSendState();
  abortCtrl = new AbortController();

  let got = false;
  try {
    await streamChat(
      payload,
      (token) => {
        got = true;
        store.append(assistantId, token);
        updateAssistantBubble(assistantId, store.active().messages.find((m) => m.id === assistantId)?.content || '', true);
      },
      abortCtrl.signal
    );
    if (!got) {
      store.dropEmpty(assistantId);
      setError('Пустой ответ. Попробуйте ещё раз.');
    } else {
      updateAssistantBubble(assistantId, store.active().messages.find((m) => m.id === assistantId)?.content || '', false);
    }
  } catch (err) {
    if (abortCtrl.signal.aborted) {
      store.dropEmpty(assistantId);
    } else {
      store.dropEmpty(assistantId);
      setError(err.message || 'Не удалось получить ответ');
    }
  } finally {
    streaming = false;
    abortCtrl = null;
    renderAll();
  }
}

function handleNew() {
  if (streaming) {
    abortCtrl?.abort();
  }
  store.newChat();
  setError(null);
  closeSidebar();
  renderAll();
  el.input.focus();
}

el.btnNew.addEventListener('click', handleNew);
el.btnNewMobile.addEventListener('click', handleNew);
el.btnMenu.addEventListener('click', openSidebar);
el.backdrop.addEventListener('click', closeSidebar);

el.btnSend.addEventListener('click', () => sendMessage());
el.btnStop.addEventListener('click', () => abortCtrl?.abort());

el.input.addEventListener('input', () => {
  autoResize();
  updateSendState();
});
el.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

document.getElementById('suggestions').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-prompt]');
  if (!btn) return;
  sendMessage(btn.getAttribute('data-prompt'));
});

store.load();
if (!store.activeId) store.newChat();
renderAll();
el.input.focus();
