const CONFIG = {
    STORAGE_KEYS: {
        CHAT_HISTORY: 'iskra_chat_history'
    },
    NVIDIA: {
        API_URL: 'https://round-waterfall-6295.tr-kolesnik.workers.dev/v1/chat/completions',
        API_KEY: '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',
        MODEL: 'nvidia/nemotron-3-ultra-550b-a55b'
    },
    MAX_HISTORY: 50
};

const state = {
    chatHistory: [],
    isTyping: false,
    speech: {
        recognition: null,
        isRecording: false,
        currentInput: null
    }
};

const elements = {
    homePage: document.getElementById('homePage'),
    homeMessageInput: document.getElementById('homeMessageInput'),
    homeSendBtn: document.getElementById('homeSendBtn'),
    homeVoiceBtn: document.getElementById('homeVoiceBtn'),
    chatContainer: document.getElementById('chatContainer'),
    inputContainer: document.getElementById('inputContainer'),
    messageInput: document.getElementById('messageInput'),
    sendBtn: document.getElementById('sendBtn'),
    chatVoiceBtn: document.getElementById('chatVoiceBtn'),
    clearBtn: document.getElementById('clearBtn'),
    charCount: document.getElementById('charCount'),
    homeCharCount: document.getElementById('homeCharCount')
};

function init() {
    loadFromStorage();
    setupEventListeners();
    initSpeechRecognition();

    if (state.chatHistory.length > 0) {
        showChatPage();
        renderChatHistory();
    } else {
        showHomePage();
    }
}

function showHomePage() {
    elements.homePage.classList.remove('hidden');
    elements.chatContainer.classList.add('hidden');
    elements.inputContainer.classList.add('hidden');
    const header = document.querySelector('.header');
    if (header) header.classList.add('hidden');
}

function showChatPage() {
    elements.homePage.classList.add('hidden');
    elements.chatContainer.classList.remove('hidden');
    elements.inputContainer.classList.remove('hidden');
    const header = document.querySelector('.header');
    if (header) header.classList.remove('hidden');
}

function loadFromStorage() {
    const saved = localStorage.getItem(CONFIG.STORAGE_KEYS.CHAT_HISTORY);
    if (saved) {
        try {
            state.chatHistory = JSON.parse(saved);
        } catch (e) {
            state.chatHistory = [];
        }
    }
}

function saveToStorage() {
    localStorage.setItem(CONFIG.STORAGE_KEYS.CHAT_HISTORY, JSON.stringify(state.chatHistory));
}

function setupEventListeners() {
    elements.homeSendBtn.addEventListener('click', () => handleSendMessage(true));
    elements.homeVoiceBtn.addEventListener('click', () => toggleVoiceRecording('home'));
    elements.homeMessageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage(true);
        }
    });
    elements.homeMessageInput.addEventListener('input', () => {
        autoResizeTextarea(elements.homeMessageInput);
        updateHomeCharCount();
        updateHomeButtons();
    });

    document.querySelectorAll('.suggestion-card').forEach(card => {
        card.addEventListener('click', () => {
            elements.homeMessageInput.value = card.getAttribute('data-prompt');
            autoResizeTextarea(elements.homeMessageInput);
            updateHomeCharCount();
            updateHomeButtons();
            elements.homeMessageInput.focus();
        });
    });

    elements.sendBtn.addEventListener('click', () => handleSendMessage(false));
    elements.chatVoiceBtn.addEventListener('click', () => toggleVoiceRecording('chat'));
    elements.messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage(false);
        }
    });
    elements.messageInput.addEventListener('input', () => {
        autoResizeTextarea(elements.messageInput);
        updateCharCount();
        updateChatButtons();
    });

    elements.clearBtn.addEventListener('click', handleClearHistory);
}

function updateHomeButtons() {
    const hasText = elements.homeMessageInput.value.trim().length > 0;
    if (hasText) {
        elements.homeVoiceBtn.classList.add('hidden');
        elements.homeSendBtn.classList.remove('hidden');
        elements.homeSendBtn.disabled = state.isTyping;
    } else if (!state.speech.isRecording) {
        elements.homeSendBtn.classList.add('hidden');
        elements.homeVoiceBtn.classList.remove('hidden');
        elements.homeVoiceBtn.disabled = false;
    }
}

function updateChatButtons() {
    const hasText = elements.messageInput.value.trim().length > 0;
    if (hasText) {
        elements.chatVoiceBtn.classList.add('hidden');
        elements.sendBtn.classList.remove('hidden');
        elements.sendBtn.disabled = state.isTyping;
    } else if (!state.speech.isRecording) {
        elements.sendBtn.classList.add('hidden');
        elements.chatVoiceBtn.classList.remove('hidden');
        elements.chatVoiceBtn.disabled = false;
    }
}

function autoResizeTextarea(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
}

function updateHomeCharCount() {
    if (elements.homeCharCount) {
        elements.homeCharCount.textContent = `${elements.homeMessageInput.value.length} / 4000`;
    }
}

function updateCharCount() {
    if (elements.charCount) {
        elements.charCount.textContent = `${elements.messageInput.value.length} / 4000`;
    }
}

async function handleSendMessage(fromHome = false) {
    const input = fromHome ? elements.homeMessageInput : elements.messageInput;
    const message = input.value.trim();
    if (!message || state.isTyping) return;

    if (fromHome) showChatPage();

    addMessage('user', message);
    input.value = '';
    autoResizeTextarea(input);
    if (fromHome) {
        updateHomeButtons();
        updateHomeCharCount();
    } else {
        updateCharCount();
        updateChatButtons();
    }

    state.isTyping = true;
    const typingId = showTypingIndicator();

    try {
        const result = await sendToNvidia(message);
        removeTypingIndicator(typingId);
        addMessage('ai', result.content, result.tokens);
    } catch (error) {
        removeTypingIndicator(typingId);
        addMessage('ai', `Ошибка: ${error.message}`);
        console.error(error);
    } finally {
        state.isTyping = false;
        if (fromHome) updateHomeButtons();
        else updateChatButtons();
    }
}

function addMessage(role, content, tokens = null) {
    state.chatHistory.push({ role, content, timestamp: Date.now(), tokens });
    if (state.chatHistory.length > CONFIG.MAX_HISTORY) {
        state.chatHistory = state.chatHistory.slice(-CONFIG.MAX_HISTORY);
    }
    saveToStorage();
    renderMessage(role, content, tokens);
    scrollToBottom();
}

function renderMessage(role, content, tokens = null) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = role === 'user' ? 'Вы' : 'AI';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    if (role === 'ai') {
        const roleDiv = document.createElement('div');
        roleDiv.className = 'message-role';
        roleDiv.textContent = 'ИСКРА';
        contentDiv.appendChild(roleDiv);
    }

    const textDiv = document.createElement('div');
    textDiv.className = 'message-text';
    if (role === 'ai' && typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
        textDiv.innerHTML = DOMPurify.sanitize(marked.parse(content));
    } else {
        textDiv.textContent = content;
    }
    contentDiv.appendChild(textDiv);

    if (role === 'user') {
        const userWrapper = document.createElement('div');
        userWrapper.className = 'message-user-wrapper';
        userWrapper.appendChild(contentDiv);
        messageDiv.appendChild(avatar);
        messageDiv.appendChild(userWrapper);
    } else {
        messageDiv.appendChild(avatar);
        messageDiv.appendChild(contentDiv);
    }

    elements.chatContainer.appendChild(messageDiv);
}

function showTypingIndicator() {
    const typingId = 'typing-' + Date.now();
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message ai';
    messageDiv.id = typingId;
    messageDiv.innerHTML = `
        <div class="message-avatar">AI</div>
        <div class="message-content">
            <div class="typing-indicator">
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
            </div>
        </div>
    `;
    elements.chatContainer.appendChild(messageDiv);
    scrollToBottom();
    return typingId;
}

function removeTypingIndicator(typingId) {
    const el = document.getElementById(typingId);
    if (el) el.remove();
}

function scrollToBottom() {
    elements.chatContainer.scrollTop = elements.chatContainer.scrollHeight;
}

function renderChatHistory() {
    elements.chatContainer.innerHTML = '';
    state.chatHistory.forEach(msg => renderMessage(msg.role, msg.content, msg.tokens));
    scrollToBottom();
}

function handleClearHistory() {
    if (!confirm('Очистить историю чата?')) return;
    state.chatHistory = [];
    localStorage.removeItem(CONFIG.STORAGE_KEYS.CHAT_HISTORY);
    elements.chatContainer.innerHTML = '';
    showHomePage();
}

async function sendToNvidia(message) {
    const messages = state.chatHistory
        .slice(-10)
        .map(msg => ({
            role: msg.role === 'user' ? 'user' : 'assistant',
            content: msg.content
        }));

    messages.push({ role: 'user', content: message });

    const response = await fetch(CONFIG.NVIDIA.API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${CONFIG.NVIDIA.API_KEY}`,
            'Accept': 'application/json'
        },
        body: JSON.stringify({
            model: CONFIG.NVIDIA.MODEL,
            messages: messages,
            temperature: 0.7,
            max_tokens: 2000,
            stream: false
        })
    });

    if (!response.ok) {
        let errText = '';
        try {
            errText = await response.text();
        } catch (_) {}
        throw new Error(`API ${response.status}: ${errText || response.statusText}`);
    }

    const data = await response.json();
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
        throw new Error('Некорректный ответ от API');
    }

    return {
        content: data.choices[0].message.content,
        tokens: data.usage ? data.usage.total_tokens : null
    };
}

function initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        if (elements.homeVoiceBtn) elements.homeVoiceBtn.style.display = 'none';
        if (elements.chatVoiceBtn) elements.chatVoiceBtn.style.display = 'none';
        if (elements.homeSendBtn) elements.homeSendBtn.classList.remove('hidden');
        if (elements.sendBtn) elements.sendBtn.classList.remove('hidden');
        return;
    }

    state.speech.recognition = new SpeechRecognition();
    state.speech.recognition.lang = 'ru-RU';
    state.speech.recognition.interimResults = true;
    state.speech.recognition.continuous = false;

    state.speech.recognition.onresult = (event) => {
        let finalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
            if (event.results[i].isFinal) {
                finalTranscript += event.results[i][0].transcript + ' ';
            }
        }
        if (finalTranscript) {
            const input = state.speech.currentInput === 'home'
                ? elements.homeMessageInput
                : elements.messageInput;
            input.value = (input.value + ' ' + finalTranscript).trim();
            autoResizeTextarea(input);
            if (state.speech.currentInput === 'home') {
                updateHomeCharCount();
                updateHomeButtons();
            } else {
                updateCharCount();
                updateChatButtons();
            }
        }
    };

    state.speech.recognition.onend = () => {
        state.speech.isRecording = false;
        updateHomeButtons();
        updateChatButtons();
    };

    state.speech.recognition.onerror = () => {
        state.speech.isRecording = false;
        updateHomeButtons();
        updateChatButtons();
    };
}

function toggleVoiceRecording(source) {
    if (!state.speech.recognition) return;

    if (state.speech.isRecording) {
        try { state.speech.recognition.stop(); } catch (_) {}
        state.speech.isRecording = false;
    } else {
        state.speech.currentInput = source;
        state.speech.isRecording = true;
        try {
            state.speech.recognition.start();
        } catch (_) {
            state.speech.isRecording = false;
        }
    }
    updateHomeButtons();
    updateChatButtons();
}

document.addEventListener('DOMContentLoaded', init);
