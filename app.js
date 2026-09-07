const CONFIG = {
  API_URL: 'https://round-waterfall-6295.tr-kolesnik.workers.dev/v1/chat/completions',
  API_KEY: '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',
  MODEL: 'nvidia/nemotron-3-ultra-550b-a55b',
  STORAGE_KEY: 'iskra.chats.v1',
  MAX_CHATS: 40,
  MAX_HISTORY: 24,
  MAX_INPUT: 4000,
  SYSTEM: `Ты — ИСКРА, спокойный и точный ИИ-собеседник.
Отвечай на языке пользователя. Пиши ясно, без воды, без лести и без эмодзи, если они не нужны по смыслу.
Если не уверен — скажи об этом. Форматируй ответы аккуратно: короткие абзацы, списки, код в блоках.`
};

const SUGGESTIONS = [
  { title: 'Объясни сложное', prompt: 'Объясни, как работает квантовый компьютер — без формул, с живой аналогией.' },
  { title: 'Найди слабые места', prompt: 'Разбери мою идею как строгий редактор: что не сработает и как это починить.' },
  { title: 'Напиши письмо', prompt: 'Помоги написать короткое деловое письмо: вежливо, ясно, без канцелярита.' },
  { title: 'Собери план', prompt: 'Помоги спланировать день, если у меня только три свободных часа.' }
];

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
      localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify({ v: 1, chats: this.chats, activeId: this.activeId }));
    } catch (_) {}
  },
  active() { return this.chats.find(c => c.id === this.activeId) || null; },
  newChat() {
    const id = uid();
    this.chats.unshift({ id, title: 'Новый разговор', messages: [], updatedAt: Date.now() });
    this.activeId = id;
    if (this.chats.length > CONFIG.MAX_CHATS) this.chats = this.chats.slice(0, CONFIG.MAX_CHATS);
    this.save();
    return id;
  },
  select(id) { this.activeId = id; this.save(); },
  delete(id) {
    this.chats = this.chats.filter(c => c.id !== id);
    if (this.activeId === id) this.activeId = this.chats[0]?.id || null;
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
    const m = chat?.messages.find(x => x.id === assistantId);
    if (m) { m.content += chunk; chat.updatedAt = Date.now(); this.save(); }
  },
  dropEmpty(assistantId) {
    const chat = this.active();
    if (!chat) return;
    const m = chat.messages.find(x => x.id === assistantId);
    if (m && !m.content.trim()) {
      chat.messages = chat.messages.filter(x => x.id !== assistantId);
      this.save();
    }
  },
  lastUserText() {
    const chat = this.active();
    if (!chat) return null;
    for (let i = chat.messages.length - 1; i >= 0; i--) {
      if (chat.messages[i].role === 'user') return chat.messages[i].content;
    }
    return null;
  },
  trimAfterLastUser() {
    const chat = this.active();
    if (!chat) return;
    let lastUser = -1;
    for (let i = chat.messages.length - 1; i >= 0; i--) {
      if (chat.messages[i].role === 'user') { lastUser = i; break; }
    }
    if (lastUser >= 0) {
      chat.messages = chat.messages.slice(0, lastUser + 1);
      this.save();
    }
  }
};

const el = {
  sidebar: document.getElementById('sidebar'),
  backdrop: document.getElementById('backdrop'),
  chatList: document.getElementById('chatList'),
  listEmpty: document.getElementById('listEmpty'),
  thread: document.getElementById('thread'),
  input: document.getElementById('input'),
  btnSend: document.getElementById('btnSend'),
  btnStop: document.getElementById('btnStop'),
  btnNew: document.getElementById('btnNew'),
  btnNewMobile: document.getElementById('btnNewMobile'),
  btnMenu: document.getElementById('btnMenu'),
  btnCloseSidebar: document.getElementById('btnCloseSidebar'),
  topTitle: document.getElementById('topTitle'),
  topTitleMobile: document.getElementById('topTitleMobile'),
  errorBar: document.getElementById('errorBar'),
  errorText: document.getElementById('errorText'),
  btnRetry: document.getElementById('btnRetry'),
  hint: document.getElementById('hint'),
  composer: document.getElementById('composer')
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
    el.errorText.textContent = '';
    return;
  }
  el.errorText.textContent = msg;
  el.errorBar.classList.remove('hidden');
}

function md(text) {
  if (typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
    return DOMPurify.sanitize(marked.parse(text || ''));
  }
  return (text || '').replace(/</g, '&lt;');
}

function renderList() {
  const items = el.chatList.querySelectorAll('.chat-item');
  items.forEach(n => n.remove());
  const has = store.chats.length > 0;
  el.listEmpty.classList.toggle('hidden', has);
  store.chats.forEach(c => {
    const row = document.createElement('div');
    row.className = 'chat-item' + (c.id === store.activeId ? ' active' : '');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chat-item-btn';
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" style="flex-shrink:0;opacity:.5"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg><span></span>`;
    btn.querySelector('span').textContent = c.title;
    btn.addEventListener('click', () => {
      if (streaming) return;
      store.select(c.id);
      closeSidebar();
      renderAll();
    });
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'chat-item-del';
    del.setAttribute('aria-label', 'Удалить чат');
    del.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>`;
    del.addEventListener('click', e => {
      e.stopPropagation();
      if (streaming) return;
      store.delete(c.id);
      renderAll();
    });
    row.appendChild(btn);
    row.appendChild(del);
    el.chatList.appendChild(row);
  });
}

function renderEmpty() {
  const wrap = document.createElement('div');
  wrap.className = 'empty';
  wrap.innerHTML = `
    <div class="empty-head">
      <span class="mark-box">
        <svg class="spark" width="16" height="16" viewBox="0 0 32 32" fill="currentColor"><path d="M16 1.5 18.35 13.65 30.5 16 18.35 18.35 16 30.5 13.65 18.35 1.5 16 13.65 13.65Z"/></svg>
      </span>
      <div>
        <h1>ИСКРА</h1>
        <p>Спросите что угодно</p>
      </div>
    </div>
    <div class="suggest-grid"></div>`;
  const grid = wrap.querySelector('.suggest-grid');
  SUGGESTIONS.forEach((s, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'suggest-card';
    b.style.animationDelay = `${80 + i * 40}ms`;
    b.innerHTML = `<p class="t"></p><p class="d"></p>`;
    b.querySelector('.t').textContent = s.title;
    b.querySelector('.d').textContent = s.prompt;
    b.addEventListener('click', () => sendMessage(s.prompt));
    grid.appendChild(b);
  });
  return wrap;
}

function renderThread() {
  const chat = store.active();
  const title = chat?.title || 'ИСКРА';
  el.topTitle.textContent = chat?.messages?.length ? title : 'Новый разговор';
  el.topTitleMobile.textContent = title === 'Новый разговор' ? 'ИСКРА' : title;

  el.thread.innerHTML = '';
  if (!chat || chat.messages.length === 0) {
    el.thread.appendChild(renderEmpty());
    return;
  }

  const box = document.createElement('div');
  box.className = 'messages';
  chat.messages.forEach(m => {
    const div = document.createElement('div');
    div.className = 'message ' + m.role;
    div.dataset.id = m.id;
    const role = document.createElement('div');
    role.className = 'message-role';
    role.textContent = m.role === 'user' ? 'Вы' : 'ИСКРА';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    if (m.role === 'assistant') {
      bubble.innerHTML = m.content ? md(m.content) : '';
    } else {
      bubble.textContent = m.content;
    }
    div.appendChild(role);
    div.appendChild(bubble);
    box.appendChild(div);
  });
  el.thread.appendChild(box);
  el.thread.scrollTop = el.thread.scrollHeight;
}

function updateAssistantBubble(id, content, cursor) {
  const node = el.thread.querySelector(`[data-id="${id}"] .bubble`);
  if (!node) return;
  node.innerHTML = md(content) + (cursor ? '<span class="cursor"></span>' : '');
  el.thread.scrollTop = el.thread.scrollHeight;
}

function showThinking() {
  const box = el.thread.querySelector('.messages') || el.thread;
  let row = document.getElementById('thinkingRow');
  if (row) return;
  row = document.createElement('div');
  row.id = 'thinkingRow';
  row.className = 'thinking-row';
  row.innerHTML = `<div class="thinking-dots"><span></span><span></span><span></span></div><span>ИСКРА думает…</span>`;
  if (box.classList.contains('messages')) box.appendChild(row);
  else {
    const m = document.createElement('div');
    m.className = 'messages';
    m.appendChild(row);
    el.thread.innerHTML = '';
    el.thread.appendChild(m);
  }
  el.thread.scrollTop = el.thread.scrollHeight;
}

function hideThinking() {
  document.getElementById('thinkingRow')?.remove();
}

function renderAll() {
  renderList();
  renderThread();
  updateSendState();
}

function updateSendState() {
  const len = el.input.value.length;
  const has = el.input.value.trim().length > 0;
  el.hint.textContent = len > CONFIG.MAX_INPUT - 200 ? `${len} / ${CONFIG.MAX_INPUT}` : 'Enter — отправить';
  el.btnSend.disabled = streaming || !has;
  el.btnSend.classList.toggle('hidden', streaming);
  el.btnStop.classList.toggle('hidden', !streaming);
}

function autoResize() {
  el.input.style.height = '0px';
  el.input.style.height = Math.min(el.input.scrollHeight, 160) + 'px';
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
      message = (typeof j.error === 'string' && j.error) || j.error?.message || j.message || message;
    } catch (_) {
      try { message = (await res.text()) || message; } catch (__) {}
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
  const trimmed = (text ?? el.input.value).trim();
  if (!trimmed || streaming) return;
  if (trimmed.length > CONFIG.MAX_INPUT) return;

  setError(null);
  el.input.value = '';
  autoResize();

  store.addUser(trimmed);
  renderAll();
  const assistantId = store.addAssistantPlaceholder();
  renderAll();
  showThinking();

  const history = store.active().messages
    .filter(m => m.id !== assistantId && m.content.trim())
    .slice(-CONFIG.MAX_HISTORY)
    .map(m => ({ role: m.role, content: m.content }));

  const payload = [{ role: 'system', content: CONFIG.SYSTEM }, ...history];

  streaming = true;
  updateSendState();
  abortCtrl = new AbortController();

  let got = false;
  try {
    await streamChat(payload, token => {
      if (!got) {
        got = true;
        hideThinking();
      }
      store.append(assistantId, token);
      updateAssistantBubble(assistantId, store.active().messages.find(m => m.id === assistantId)?.content || '', true);
    }, abortCtrl.signal);
    if (!got) {
      store.dropEmpty(assistantId);
      setError('Пустой ответ. Попробуйте ещё раз.');
    } else {
      updateAssistantBubble(assistantId, store.active().messages.find(m => m.id === assistantId)?.content || '', false);
    }
  } catch (err) {
    hideThinking();
    if (!abortCtrl.signal.aborted) {
      store.dropEmpty(assistantId);
      setError(err.message || 'Не удалось получить ответ');
    } else {
      store.dropEmpty(assistantId);
    }
  } finally {
    streaming = false;
    abortCtrl = null;
    hideThinking();
    renderAll();
  }
}

function handleNew() {
  if (streaming) abortCtrl?.abort();
  store.newChat();
  setError(null);
  closeSidebar();
  renderAll();
  el.input.focus();
}

async function retry() {
  if (streaming) return;
  const text = store.lastUserText();
  if (!text) return;
  store.trimAfterLastUser();
  // remove last user then resend
  const chat = store.active();
  if (chat && chat.messages.length && chat.messages[chat.messages.length - 1].role === 'user') {
    chat.messages.pop();
    store.save();
  }
  await sendMessage(text);
}

el.btnNew.addEventListener('click', handleNew);
el.btnNewMobile.addEventListener('click', handleNew);
el.btnMenu.addEventListener('click', openSidebar);
el.btnCloseSidebar.addEventListener('click', closeSidebar);
el.backdrop.addEventListener('click', closeSidebar);
el.btnRetry.addEventListener('click', () => void retry());
el.btnStop.addEventListener('click', () => abortCtrl?.abort());

el.composer.addEventListener('submit', e => {
  e.preventDefault();
  if (streaming) abortCtrl?.abort();
  else sendMessage();
});

el.input.addEventListener('input', () => { autoResize(); updateSendState(); });
el.input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    if (!streaming) sendMessage();
  }
});

store.load();
renderAll();
el.input.focus();
