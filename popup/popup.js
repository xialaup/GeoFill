/**
 * Popup 主逻辑 - 获取IP信息、生成数据、与content script通信
 */

// 当前生成的数据
let currentData = {};
let ipData = {};

// DOM 元素引用
const elements = {
    ipInfo: null,
    ipRefresh: null,
    fields: {},
    regenerateAll: null,
    fillForm: null,
    emailDomainType: null,
    customDomain: null,
    themeToggle: null,
    toast: null,
    // 新增元素
    copyAll: null,
    openSettings: null,
    closeSettings: null,
    settingsModal: null,
    // AI 开关
    useAIToggle: null,
    aiToggleWrapper: null,
    // 设置元素
    enableAI: null,
    openaiBaseUrl: null,
    openaiKey: null,
    openaiModel: null,
    aiPersona: null,
    passwordLength: null,
    pwdUppercase: null,
    pwdLowercase: null,
    pwdNumbers: null,
    pwdSymbols: null,
    minAge: null,
    maxAge: null,
    autoClearData: null,
    // 存档元素
    archiveName: null,
    saveArchive: null,
    archiveList: null,
    // 邮箱元素
    inboxGroup: null,
    refreshInbox: null,
    inboxList: null,
    // 历史记录元素
    openHistory: null,
    closeHistory: null,
    historyModal: null,
    historyList: null,
    clearHistory: null,
    // Geoapify 元素
    geoapifyKey: null
};

// 字段列表
const FIELD_NAMES = ['firstName', 'lastName', 'gender', 'birthday', 'username', 'email', 'password', 'phone', 'address', 'city', 'state', 'zipCode', 'country'];

// 锁定的字段集合
let lockedFields = new Set();

// 存储键名和版本
const STORAGE_KEY = 'geoFillCachedData';
const THEME_KEY = 'geoFillTheme';
const LOCKED_KEY = 'geoFillLockedFields';
const SETTINGS_KEY = 'geoFillSettings';
const ARCHIVES_KEY = 'geoFillArchives';
const AUTO_CLEAR_KEY = 'geoFillAutoClear';
const HISTORY_KEY = 'geoFillHistory';
const GEOAPIFY_KEY = 'geoFillGeoapifyKey';  // Geoapify API Key 独立存储
const CACHE_VERSION = 'v3';
const MAX_HISTORY_ITEMS = 10;

// Geoapify API Key (使用 generators.js 中已声明的变量)
// geoapifyApiKey 已在 generators.js 中声明

// 默认设置
let userSettings = {
    enableAI: false,
    openaiBaseUrl: 'https://api.openai.com/v1',
    openaiKey: '',
    openaiModel: 'gpt-3.5-turbo',
    aiPersona: '',
    passwordLength: 12,
    pwdUppercase: true,
    pwdLowercase: true,
    pwdNumbers: true,
    pwdSymbols: true,
    minAge: 18,
    maxAge: 55,
    autoClearData: false
};

/**
 * 显示 toast 提示
 */
function showToast(message) {
    const toast = elements.toast;
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 1500);
}

/**
 * 切换字段锁定状态
 */
function toggleLock(fieldName, btn) {
    if (lockedFields.has(fieldName)) {
        lockedFields.delete(fieldName);
        btn.classList.remove('locked');
        btn.textContent = '🔓';
        showToast(`${fieldName} 已解锁`);
    } else {
        lockedFields.add(fieldName);
        btn.classList.add('locked');
        btn.textContent = '🔒';
        showToast(`${fieldName} 已锁定`);
    }
    saveLockedFields();
}

/**
 * 保存锁定状态到 storage
 */
async function saveLockedFields() {
    try {
        await chrome.storage.local.set({
            [LOCKED_KEY]: Array.from(lockedFields)
        });
    } catch (e) {
        console.log('保存锁定状态失败:', e);
    }
}

/**
 * 从 storage 加载锁定状态
 */
async function loadLockedFields() {
    try {
        const result = await chrome.storage.local.get(LOCKED_KEY);
        if (result[LOCKED_KEY]) {
            lockedFields = new Set(result[LOCKED_KEY]);
            lockedFields.forEach(field => {
                const btn = document.querySelector(`.lock-btn[data-field="${field}"]`);
                if (btn) {
                    btn.classList.add('locked');
                    btn.textContent = '🔒';
                }
            });
        }
    } catch (e) {
        console.log('加载锁定状态失败:', e);
    }
}

/**
 * 复制到剪贴板
 */
async function copyToClipboard(text, btn) {
    try {
        await navigator.clipboard.writeText(text);
        btn.classList.add('copied');
        btn.textContent = '✓';
        showToast('已复制到剪贴板');
        setTimeout(() => {
            btn.classList.remove('copied');
            btn.textContent = '📋';
        }, 1000);
    } catch (err) {
        console.error('复制失败:', err);
    }
}

/**
 * 保存数据到 chrome.storage
 */
async function saveDataToStorage() {
    try {
        await chrome.storage.local.set({
            [STORAGE_KEY]: {
                version: CACHE_VERSION,
                currentData,
                ipData,
                emailDomain: elements.emailDomainType?.value,
                customDomain: elements.customDomain?.value
            }
        });
    } catch (e) {
        console.log('保存数据失败:', e);
    }
}

/**
 * 从 chrome.storage 加载数据
 */
async function loadDataFromStorage() {
    try {
        const result = await chrome.storage.local.get(STORAGE_KEY);
        const cached = result[STORAGE_KEY];
        if (cached && cached.version !== CACHE_VERSION) {
            console.log('缓存版本不匹配，清除旧缓存');
            await chrome.storage.local.remove(STORAGE_KEY);
            return null;
        }
        return cached || null;
    } catch (e) {
        console.log('加载数据失败:', e);
        return null;
    }
}

/**
 * 保存当前数据到历史记录
 */
async function saveToHistory() {
    if (!currentData || !currentData.firstName) return;

    try {
        const result = await chrome.storage.local.get(HISTORY_KEY);
        let history = result[HISTORY_KEY] || [];

        // 创建历史记录项
        const historyItem = {
            id: Date.now(),
            timestamp: new Date().toISOString(),
            data: { ...currentData },
            country: ipData.country || 'Unknown'
        };

        // 检查是否已存在相同邮箱的记录，避免重复
        const existingIndex = history.findIndex(item => item.data.email === currentData.email);
        if (existingIndex !== -1) {
            history.splice(existingIndex, 1);
        }

        // 添加到开头
        history.unshift(historyItem);

        // 限制数量
        if (history.length > MAX_HISTORY_ITEMS) {
            history = history.slice(0, MAX_HISTORY_ITEMS);
        }

        await chrome.storage.local.set({ [HISTORY_KEY]: history });
        console.log('[GeoFill] 已保存到历史记录');
    } catch (e) {
        console.log('保存历史记录失败:', e);
    }
}

/**
 * 加载历史记录列表
 */
async function loadHistoryList() {
    try {
        const result = await chrome.storage.local.get(HISTORY_KEY);
        const history = result[HISTORY_KEY] || [];
        renderHistoryList(history);
    } catch (e) {
        console.log('加载历史记录失败:', e);
    }
}

/**
 * 渲染历史记录列表
 */
function renderHistoryList(history) {
    if (!elements.historyList) return;

    if (!history || history.length === 0) {
        elements.historyList.innerHTML = '<div class="history-empty">暂无历史记录</div>';
        return;
    }

    elements.historyList.innerHTML = history.map(item => {
        const data = item.data;
        const name = `${data.firstName || ''} ${data.lastName || ''}`.trim() || '未知';
        const email = data.email || '无邮箱';
        const time = formatHistoryTime(item.timestamp);

        return `
            <div class="history-item" data-id="${item.id}">
                <div class="history-item-info" title="点击加载此记录">
                    <div class="history-item-name">${name}</div>
                    <div class="history-item-email">${email}</div>
                </div>
                <div class="history-item-time">${time}</div>
                <button class="history-item-delete" data-id="${item.id}" title="删除">🗑️</button>
            </div>
        `;
    }).join('');

    // 绑定点击事件
    elements.historyList.querySelectorAll('.history-item-info').forEach(el => {
        el.addEventListener('click', (e) => {
            const item = e.currentTarget.closest('.history-item');
            const id = parseInt(item.dataset.id);
            loadHistoryItem(id);
        });
    });

    // 绑定删除事件
    elements.historyList.querySelectorAll('.history-item-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = parseInt(e.currentTarget.dataset.id);
            deleteHistoryItem(id);
        });
    });
}

/**
 * 格式化历史记录时间
 */
function formatHistoryTime(isoString) {
    const date = new Date(isoString);
    const now = new Date();
    const diff = now - date;

    // 小于1分钟
    if (diff < 60000) return '刚刚';
    // 小于1小时
    if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
    // 小于24小时
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
    // 小于7天
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}天前`;
    // 其他
    return `${date.getMonth() + 1}/${date.getDate()}`;
}

/**
 * 加载历史记录项
 */
async function loadHistoryItem(id) {
    try {
        const result = await chrome.storage.local.get(HISTORY_KEY);
        const history = result[HISTORY_KEY] || [];
        const item = history.find(h => h.id === id);

        if (item && item.data) {
            currentData = { ...item.data };
            ipData.country = item.country || currentData.country || 'United States';

            updateUI();
            saveDataToStorage();

            // 关闭模态框
            if (elements.historyModal) {
                elements.historyModal.classList.remove('show');
            }

            showToast('已加载历史记录');
        }
    } catch (e) {
        console.log('加载历史记录项失败:', e);
    }
}

/**
 * 删除历史记录项
 */
async function deleteHistoryItem(id) {
    try {
        const result = await chrome.storage.local.get(HISTORY_KEY);
        let history = result[HISTORY_KEY] || [];
        history = history.filter(h => h.id !== id);

        await chrome.storage.local.set({ [HISTORY_KEY]: history });
        renderHistoryList(history);
        showToast('已删除');
    } catch (e) {
        console.log('删除历史记录项失败:', e);
    }
}

/**
 * 清空所有历史记录
 */
async function clearAllHistory() {
    try {
        await chrome.storage.local.remove(HISTORY_KEY);
        renderHistoryList([]);
        showToast('历史记录已清空');
    } catch (e) {
        console.log('清空历史记录失败:', e);
    }
}

/**
 * 加载主题设置
 */
async function loadTheme() {
    try {
        const result = await chrome.storage.local.get(THEME_KEY);
        const theme = result[THEME_KEY] || 'dark';
        applyTheme(theme);
    } catch (e) {
        console.log('加载主题失败:', e);
    }
}

/**
 * 应用主题
 */
function applyTheme(theme) {
    if (theme === 'light') {
        document.body.classList.add('light-theme');
        if (elements.themeToggle) elements.themeToggle.textContent = '☀️';
    } else {
        document.body.classList.remove('light-theme');
        if (elements.themeToggle) elements.themeToggle.textContent = '🌙';
    }
}

/**
 * 切换主题
 */
async function toggleTheme() {
    const isLight = document.body.classList.contains('light-theme');
    const newTheme = isLight ? 'dark' : 'light';
    applyTheme(newTheme);
    await chrome.storage.local.set({ [THEME_KEY]: newTheme });
}

/**
 * 初始化
 */
document.addEventListener('DOMContentLoaded', async () => {
    console.log('[GeoFill] 开始初始化...');

    try {
        // await loadGeneratorsScript();
        console.log('[GeoFill] 生成器脚本加载成功');
    } catch (e) {
        console.error('[GeoFill] 加载生成器脚本失败:', e);
    }

    // 缓存 DOM 元素
    elements.ipInfo = document.getElementById('ipInfo');
    elements.ipRefresh = document.getElementById('ipRefresh');
    elements.regenerateAll = document.getElementById('regenerateAll');
    elements.fillForm = document.getElementById('fillForm');
    // AI 开关
    elements.useAIToggle = document.getElementById('useAIToggle');
    elements.aiToggleWrapper = document.getElementById('aiToggleWrapper');
    elements.themeToggle = document.getElementById('themeToggle');
    elements.toast = document.getElementById('toast');

    FIELD_NAMES.forEach(name => {
        elements.fields[name] = document.getElementById(name);
    });

    elements.emailDomainType = document.getElementById('emailDomainType');
    elements.customDomain = document.getElementById('customDomain');

    // 新增元素
    elements.copyAll = document.getElementById('copyAll');
    elements.openSettings = document.getElementById('openSettings');
    elements.closeSettings = document.getElementById('closeSettings');
    elements.settingsModal = document.getElementById('settingsModal');
    elements.enableAI = document.getElementById('enableAI');
    elements.openaiBaseUrl = document.getElementById('openaiBaseUrl');
    elements.openaiKey = document.getElementById('openaiKey');
    elements.openaiModel = document.getElementById('openaiModel');
    elements.aiPersona = document.getElementById('aiPersona');
    elements.passwordLength = document.getElementById('passwordLength');
    elements.testAI = document.getElementById('testAI');
    elements.pwdUppercase = document.getElementById('pwdUppercase');
    elements.pwdLowercase = document.getElementById('pwdLowercase');
    elements.pwdNumbers = document.getElementById('pwdNumbers');
    elements.pwdSymbols = document.getElementById('pwdSymbols');
    elements.minAge = document.getElementById('minAge');
    elements.maxAge = document.getElementById('maxAge');
    elements.autoClearData = document.getElementById('autoClearData');
    elements.archiveName = document.getElementById('archiveName');
    elements.saveArchive = document.getElementById('saveArchive');
    elements.archiveList = document.getElementById('archiveList');
    elements.inboxGroup = document.getElementById('inboxGroup');
    elements.refreshInbox = document.getElementById('refreshInbox');
    elements.inboxList = document.getElementById('inboxList');
    // 历史记录元素
    elements.openHistory = document.getElementById('openHistory');
    elements.closeHistory = document.getElementById('closeHistory');
    elements.historyModal = document.getElementById('historyModal');
    elements.historyList = document.getElementById('historyList');
    elements.clearHistory = document.getElementById('clearHistory');
    // Geoapify 元素
    elements.geoapifyKey = document.getElementById('geoapifyKey');

    try { await loadTheme(); } catch (e) { console.log('loadTheme error:', e); }
    try { await loadSettings(); } catch (e) { console.log('loadSettings error:', e); }

    // 加载 AI 开关状态
    try {
        const result = await chrome.storage.local.get('geoFillUseAI');
        if (elements.useAIToggle && result.geoFillUseAI !== undefined) {
            elements.useAIToggle.checked = result.geoFillUseAI;
        }
    } catch (e) { console.log('loadAIToggle error:', e); }

    bindEvents();

    try { await loadLockedFields(); } catch (e) { console.log('loadLockedFields error:', e); }
    try { await loadArchiveList(); } catch (e) { console.log('loadArchiveList error:', e); }

    let cachedData = null;
    try {
        cachedData = await loadDataFromStorage();
    } catch (e) {
        console.log('loadDataFromStorage error:', e);
    }

    if (cachedData && cachedData.currentData && Object.keys(cachedData.currentData).length > 0) {
        console.log('[GeoFill] 使用缓存数据');
        currentData = cachedData.currentData;
        ipData = cachedData.ipData || {};

        if (cachedData.emailDomain && elements.emailDomainType) {
            elements.emailDomainType.value = cachedData.emailDomain;
            if (cachedData.emailDomain === 'custom' && cachedData.customDomain && elements.customDomain) {
                elements.customDomain.value = cachedData.customDomain;
                elements.customDomain.style.display = 'block';
            }

            // 如果是临时邮箱，尝试恢复会话
            if (cachedData.emailDomain === 'temp' && window.mailTM && currentData.email && currentData.password) {
                if (elements.inboxGroup) elements.inboxGroup.style.display = 'block';
                window.mailTM.login(currentData.email, currentData.password).then(() => {
                    refreshInbox();
                }).catch(e => console.log('Silent login failed:', e));
            }
        }

        if (window.generators) {
            window.generators.setCustomEmailDomain(elements.emailDomainType?.value || 'gmail.com');
        }

        if (elements.ipInfo) {
            if (ipData.city && ipData.country) {
                if (ipData.city === ipData.country || ipData.city === 'Singapore' || ipData.city === 'Hong Kong') {
                    elements.ipInfo.innerHTML = `<span class="location">📍 ${ipData.country}</span>`;
                } else {
                    elements.ipInfo.innerHTML = `<span class="location">📍 ${ipData.city}, ${ipData.country}</span>`;
                }
            } else if (ipData.country) {
                elements.ipInfo.innerHTML = `<span class="location">📍 ${ipData.country}</span>`;
            } else {
                elements.ipInfo.innerHTML = `<span class="location">📍 已缓存数据</span>`;
            }
        }

        updateUI();
    } else {
        console.log('[GeoFill] 无缓存，获取 IP 信息...');
        if (window.generators) {
            window.generators.setCustomEmailDomain(elements.emailDomainType?.value || 'gmail.com');
        }
        try {
            await fetchIPInfo();
        } catch (e) {
            console.error('[GeoFill] fetchIPInfo 失败:', e);
            // 使用默认值
            if (elements.ipInfo) {
                elements.ipInfo.innerHTML = `<span class="location">📍 United States (默认)</span>`;
            }
            if (window.generators) {
                ipData = { country: 'United States', city: 'New York', region: '' };
                currentData = window.generators.generateAllInfoWithSettings(ipData, userSettings);
                updateUI();
                saveDataToStorage();
            }
        }
    }

    console.log('[GeoFill] 初始化完成');
});

/**
 * 加载生成器脚本
 */
function loadGeneratorsScript() { return Promise.resolve(); } // Deprecated


/**
 * 绑定事件处理器
 */
function bindEvents() {
    if (elements.themeToggle) {
        elements.themeToggle.addEventListener('click', toggleTheme);
    }

    if (elements.ipRefresh) {
        elements.ipRefresh.addEventListener('click', async () => {
            showToast('正在检测 IP...');
            try {
                await fetchIPInfo();
                showToast('已更新位置信息');
            } catch (e) {
                showToast('IP 检测失败');
            }
        });
    }

    if (elements.refreshInbox) {
        elements.refreshInbox.addEventListener('click', refreshInbox);
    }

    if (elements.regenerateAll) {
        elements.regenerateAll.addEventListener('click', async () => {
            if (!window.generators) return;

            // 检查 AI 开关是否开启（主界面开关）
            const useAI = elements.useAIToggle?.checked && userSettings.openaiKey;
            if (useAI) {
                await generateWithAI();
                return;
            }

            const lockedValues = {};
            lockedFields.forEach(field => {
                lockedValues[field] = currentData[field];
            });

            currentData = window.generators.generateAllInfoWithSettings(ipData, userSettings);

            // 尝试获取真实地址（智能切换：Geoapify → OSM → 本地）
            const addressApiEnabled = document.getElementById('useAddressApiToggle')?.checked !== false;
            if (addressApiEnabled && window.generators.generateAddressAsync && !lockedFields.has('address')) {
                try {
                    showToast('正在获取真实地址...');
                    const realAddress = await window.generators.generateAddressAsync(
                        currentData.country,
                        currentData.city
                    );
                    if (realAddress && realAddress.address) {
                        currentData.address = realAddress.address;
                        // 同时更新州省和邮编（如果有值且未锁定）
                        if (realAddress.state && !lockedFields.has('state')) {
                            currentData.state = realAddress.state;
                        }
                        if (realAddress.zipCode && !lockedFields.has('zipCode')) {
                            currentData.zipCode = realAddress.zipCode;
                        }
                        const sourceText = realAddress.source === 'geoapify' ? 'Geoapify' :
                            realAddress.source === 'openstreetmap' ? 'OSM' : '本地';
                        showToast(`已获取真实地址 (${sourceText})`);
                    }
                } catch (e) {
                    console.log('[GeoFill] 地址 API 调用失败:', e);
                }
            }

            // 如果选择了临时邮箱，覆盖生成的邮箱
            const domainType = elements.emailDomainType?.value;
            if (domainType === 'temp' && !lockedFields.has('email')) {
                await regenerateEmail(); // 这会更新 currentData.email 并处理 UI
            }

            lockedFields.forEach(field => {
                if (lockedValues[field] !== undefined) {
                    currentData[field] = lockedValues[field];
                }
            });

            updateUI();
            saveDataToStorage();
            // 重新生成完成
        });
    }

    if (elements.fillForm) {
        elements.fillForm.addEventListener('click', fillFormInPage);
    }

    // AI 开关事件
    if (elements.useAIToggle) {
        elements.useAIToggle.addEventListener('change', () => {
            // 保存开关状态
            chrome.storage.local.set({ 'geoFillUseAI': elements.useAIToggle.checked });
        });
    }

    document.querySelectorAll('.lock-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const fieldName = e.currentTarget.dataset.field;
            toggleLock(fieldName, e.currentTarget);
        });
    });

    document.querySelectorAll('.copy-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const fieldName = e.currentTarget.dataset.field;
            const value = currentData[fieldName] || elements.fields[fieldName]?.value;
            if (value) {
                copyToClipboard(value, e.currentTarget);
            }
        });
    });

    document.querySelectorAll('.refresh-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            if (!window.generators) return;

            const fieldName = e.currentTarget.dataset.field;
            updateCurrentDataFromInputs();
            const result = window.generators.regenerateField(fieldName, currentData, ipData);

            if (result && result._isLocationUpdate) {
                currentData.city = result.city;
                currentData.state = result.state;
                currentData.zipCode = result.zipCode;
                if (elements.fields.city) elements.fields.city.value = result.city;
                if (elements.fields.state) elements.fields.state.value = result.state;
                if (elements.fields.zipCode) elements.fields.zipCode.value = result.zipCode;
            } else {
                currentData[fieldName] = result;
                if (elements.fields[fieldName]) {
                    elements.fields[fieldName].value = currentData[fieldName];
                }
            }
            saveDataToStorage();
        });
    });

    FIELD_NAMES.forEach(name => {
        if (elements.fields[name]) {
            elements.fields[name].addEventListener('input', () => {
                currentData[name] = elements.fields[name].value;
                saveDataToStorage();
            });
            elements.fields[name].addEventListener('change', () => {
                currentData[name] = elements.fields[name].value;
                saveDataToStorage();
            });
        }
    });

    if (elements.fields.country) {
        elements.fields.country.addEventListener('change', () => {
            if (!window.generators) return;

            const newCountry = elements.fields.country.value;
            ipData.country = newCountry;
            ipData.city = '';
            ipData.region = '';
            // 保存锁定字段的值
            const lockedValues = {};
            lockedFields.forEach(field => {
                lockedValues[field] = currentData[field];
            });

            currentData = window.generators.generateAllInfoWithSettings(ipData, userSettings);

            // 恢复锁定字段的值
            lockedFields.forEach(field => {
                if (lockedValues[field] !== undefined) {
                    currentData[field] = lockedValues[field];
                }
            });
            updateUI();
            saveDataToStorage();
            showToast(`已切换到 ${newCountry}`);
        });
    }

    if (elements.emailDomainType) {
        elements.emailDomainType.addEventListener('change', () => {
            const domain = elements.emailDomainType.value;
            if (domain === 'custom') {
                if (elements.customDomain) elements.customDomain.style.display = 'block';
                if (elements.customDomain?.value?.trim() && window.generators) {
                    window.generators.setCustomEmailDomain(elements.customDomain.value.trim());
                    regenerateEmail();
                }
            } else {
                if (elements.customDomain) elements.customDomain.style.display = 'none';
                if (window.generators) {
                    window.generators.setCustomEmailDomain(domain);
                    regenerateEmail();
                }
            }
            saveDataToStorage();
        });
    }

    if (elements.customDomain) {
        elements.customDomain.addEventListener('input', () => {
            const domain = elements.customDomain.value.trim();
            if (domain && window.generators) {
                window.generators.setCustomEmailDomain(domain);
                regenerateEmail();
            }
            saveDataToStorage();
        });
    }

    // 绑定新功能事件
    bindSettingsEvents();
}

/**
 * 重新生成邮箱
 */
/**
 * 重新生成邮箱
 */
async function regenerateEmail() {
    if (!window.generators) return;
    updateCurrentDataFromInputs();

    const domainType = elements.emailDomainType?.value;

    if (domainType === 'temp' && window.mailTM) {
        try {
            showToast('正在注册临时邮箱...');
            // 使用当前密码作为邮箱密码
            const account = await window.mailTM.register(currentData.username, currentData.password);
            currentData.email = account.address;
            if (elements.inboxGroup) elements.inboxGroup.style.display = 'block';
            refreshInbox();
        } catch (e) {
            console.error('Temp mail registration failed:', e);
            showToast('临时邮箱注册失败，使用默认邮箱');
            currentData.email = window.generators.generateEmail(currentData.username);
            if (elements.inboxGroup) elements.inboxGroup.style.display = 'none';
        }
    } else {
        currentData.email = window.generators.generateEmail(currentData.username);
        if (elements.inboxGroup) elements.inboxGroup.style.display = 'none';
    }

    if (elements.fields.email) {
        elements.fields.email.value = currentData.email;
    }
}

/**
 * 刷新收件箱
 */
async function refreshInbox() {
    if (!window.mailTM || !window.mailTM.token) return;

    if (elements.refreshInbox) {
        elements.refreshInbox.classList.add('rotating');
    }

    try {
        const messages = await window.mailTM.getMessages();
        renderInbox(messages);
        showToast('收件箱已更新');
    } catch (e) {
        console.error('Fetch messages failed:', e);
    } finally {
        if (elements.refreshInbox) {
            elements.refreshInbox.classList.remove('rotating');
        }
    }
}

/**
 * 渲染收件箱
 */
function renderInbox(messages) {
    if (!elements.inboxList) return;

    if (!messages || messages.length === 0) {
        elements.inboxList.innerHTML = '<div class="inbox-empty">暂无邮件</div>';
        return;
    }

    elements.inboxList.innerHTML = messages.map(msg => {
        const subject = msg.subject || '(无主题)';
        const from = msg.from.address;
        const intro = msg.intro || '';
        // 尝试提取验证码
        const codeMatch = subject.match(/\b\d{4,6}\b/) || intro.match(/\b\d{4,6}\b/);
        const codeHtml = codeMatch ? `<span class="verification-code" title="点击复制" onclick="copyToClipboard('${codeMatch[0]}', this)">${codeMatch[0]}</span>` : '';

        return `
            <div class="email-item">
                <div class="email-header">
                    <span class="email-from">${from}</span>
                    ${codeHtml}
                </div>
                <div class="email-subject">${subject}</div>
                <div class="email-intro">${intro}</div>
            </div>
        `;
    }).join('');
}

/**
 * 从输入框更新 currentData
 */
function updateCurrentDataFromInputs() {
    FIELD_NAMES.forEach(name => {
        if (elements.fields[name]) {
            currentData[name] = elements.fields[name].value;
        }
    });
}

/**
 * 获取 IP 信息
 */
async function fetchIPInfo() {
    console.log('[GeoFill] 开始获取 IP 信息...');

    if (elements.ipInfo) {
        elements.ipInfo.innerHTML = '<span class="loading">获取位置中...</span>';
    }

    let country = 'United States';
    let city = 'New York';
    let region = '';
    let success = false;

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        const response = await fetch('https://ipapi.co/json/', { signal: controller.signal });
        clearTimeout(timeoutId);
        const result = await response.json();
        console.log('[GeoFill] ipapi.co 响应:', result);
        if (result.country_name) {
            country = result.country_name;
            city = result.city || 'Unknown';
            region = result.region || '';
            success = true;
        }
    } catch (e) {
        console.log('[GeoFill] ipapi.co failed:', e.message);
    }

    if (!success) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            const response = await fetch('http://ip-api.com/json/', { signal: controller.signal });
            clearTimeout(timeoutId);
            const result = await response.json();
            console.log('[GeoFill] ip-api.com 响应:', result);
            if (result.status === 'success') {
                country = result.country;
                city = result.city || 'Unknown';
                region = result.regionName || '';
                success = true;
            }
        } catch (e) {
            console.log('[GeoFill] ip-api.com failed:', e.message);
        }
    }

    if (!window.generators) {
        console.error('[GeoFill] generators 未加载');
        if (elements.ipInfo) {
            elements.ipInfo.innerHTML = `<span class="location">📍 ${country} (默认)</span>`;
        }
        return;
    }

    const normalizedCountry = window.generators.normalizeCountry(country);
    console.log('[GeoFill] 标准化国家:', normalizedCountry);

    ipData = {
        country: normalizedCountry,
        city: city,
        region: region
    };

    if (elements.ipInfo) {
        if (success) {
            if (city === normalizedCountry || city === 'Singapore' || city === 'Hong Kong') {
                elements.ipInfo.innerHTML = `<span class="location">📍 ${normalizedCountry}</span>`;
            } else {
                elements.ipInfo.innerHTML = `<span class="location">📍 ${city}, ${normalizedCountry}</span>`;
            }
        } else {
            elements.ipInfo.innerHTML = `<span class="location">📍 ${normalizedCountry} (默认)</span>`;
        }
    }

    currentData = window.generators.generateAllInfoWithSettings(ipData, userSettings);
    console.log('[GeoFill] 生成数据:', currentData);
    updateUI();
    saveDataToStorage();
}

/**
 * 更新界面显示
 */
function updateUI() {
    FIELD_NAMES.forEach(name => {
        if (elements.fields[name] && currentData[name] !== undefined) {
            if (name === 'country' || name === 'gender') {
                const selectEl = elements.fields[name];
                const options = Array.from(selectEl.options).map(opt => opt.value);
                if (options.includes(currentData[name])) {
                    selectEl.value = currentData[name];
                } else if (name === 'country') {
                    selectEl.selectedIndex = 0;
                    currentData[name] = selectEl.value;
                    ipData.country = selectEl.value;
                }
            } else {
                elements.fields[name].value = currentData[name];
            }
        }
    });
}

/**
 * 使用 AI 生成数据
 */
async function generateWithAI() {
    const btn = elements.regenerateAll;
    const originalText = btn.textContent;
    btn.textContent = '🤖 生成中...';
    btn.disabled = true;

    try {
        const country = ipData.country || 'United States';

        // 1. 收集锁定字段，告知 AI
        const lockedValues = {};
        lockedFields.forEach(field => {
            lockedValues[field] = currentData[field];
        });

        let prompt = `Generate a realistic user profile for a person in ${country}.`;

        if (Object.keys(lockedValues).length > 0) {
            prompt += `\n\nLOCKED ATTRIBUTES (You MUST respect these): ${JSON.stringify(lockedValues)}`;
        }

        if (userSettings.aiPersona) {
            prompt += `\n\nPersona Description: ${userSettings.aiPersona}\n\nEnsure the generated profile matches this persona perfectly.`;
        }

        if (country === 'Japan') {
            prompt += `\n\nIMPORTANT for Japan:
            - ZipCode: "NNN-NNNN" (e.g. 100-0001)
            - Phone: Generate a **RANDOM** mobile number "090-XXXX-XXXX" (or 080/070). **DO NOT** use "1234" or "0000".
            - Name: Kanji for First/Last name, and Katakana for reading if applicable (but return standard keys).`;
        }

        prompt += ` Return ONLY a valid JSON object with the following keys: firstName, lastName, gender (male/female), birthday (YYYY-MM-DD), username, email, password, phone, address, city, state, zipCode. Ensure the data is culturally appropriate for the country.`;

        // 构建 API URL
        const apiUrl = normalizeApiUrl(userSettings.openaiBaseUrl);
        console.log('[GeoFill] AI Request URL:', apiUrl);

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${userSettings.openaiKey}`
            },
            body: JSON.stringify({
                model: userSettings.openaiModel,
                messages: [
                    { role: 'system', content: 'You are a helpful assistant that generates realistic user data in JSON format.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.7
            })
        });

        const contentType = response.headers.get('content-type');
        if (!response.ok) {
            const text = await response.text();
            console.error('API Error Response:', text);
            throw new Error(`API Error (${response.status}): ${text.slice(0, 100)}...`);
        }
        if (!contentType || !contentType.includes('application/json')) {
            const text = await response.text();
            console.error('API Invalid Content-Type:', contentType, text);
            throw new Error(`API 返回了非 JSON 数据 (可能是 HTML)。请检查 API 地址是否正确。预览: ${text.slice(0, 50)}...`);
        }

        const data = await response.json();
        const content = data.choices[0].message.content;

        // 尝试解析 JSON
        let jsonStr = content.replace(/```json\n?|\n?```/g, '').trim();
        const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            jsonStr = jsonMatch[0];
        }

        const profile = JSON.parse(jsonStr);

        // 更新数据
        currentData = { ...currentData, ...profile };

        // 2. 强制应用本地规则 (如果未锁定)

        // 密码：使用本地生成器以符合长度/复杂度规则
        if (!lockedFields.has('password') && window.generators && window.generators.generatePasswordWithSettings) {
            currentData.password = window.generators.generatePasswordWithSettings(userSettings);
        }

        // 电话：使用本地生成器以保证随机性和格式正确 (AI 容易生成 1234 等假号)
        if (!lockedFields.has('phone') && window.generators && window.generators.generatePhone) {
            currentData.phone = window.generators.generatePhone(country);
        }

        // 邮箱：如果用户指定了后缀，强制应用
        if (!lockedFields.has('email')) {
            const domainType = elements.emailDomainType.value;
            if (domainType !== 'custom' && domainType !== 'temp') {
                // 使用 AI 生成的用户名 + 指定后缀
                const username = currentData.username || 'user';
                currentData.email = `${username}@${domainType}`;
            }
        }

        // 3. 再次恢复锁定字段 (双重保险)
        lockedFields.forEach(field => {
            if (lockedValues[field] !== undefined) {
                currentData[field] = lockedValues[field];
            }
        });

        updateUI();
        saveDataToStorage();
        showToast('AI 生成成功');

    } catch (e) {
        console.error('AI Generation failed:', e);
        showToast('AI 生成失败: ' + e.message);
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

/**
 * 构建标准化的 API URL
 */
function normalizeApiUrl(baseUrl) {
    let url = baseUrl.trim();
    if (url.endsWith('/')) url = url.slice(0, -1);

    if (url.endsWith('/chat/completions')) {
        return url;
    }

    if (url.endsWith('/v1')) {
        return url + '/chat/completions';
    }

    // 如果既没有 v1 也没有 chat/completions，尝试添加 /v1/chat/completions
    // 这是一个猜测，但能覆盖大多数漏写 /v1 的情况
    return url + '/v1/chat/completions';
}

/**
 * 测试 AI 连接
 */
async function testAIConnection() {
    const btn = elements.testAI;
    const originalText = btn.textContent;
    btn.textContent = '⏳';
    btn.disabled = true;

    try {
        const apiKey = elements.openaiKey.value.trim();
        const baseUrl = elements.openaiBaseUrl.value.trim();
        const model = elements.openaiModel.value.trim();

        if (!apiKey) {
            throw new Error('请输入 API Key');
        }

        const apiUrl = normalizeApiUrl(baseUrl);
        console.log('[GeoFill] Test API URL:', apiUrl);

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: model,
                messages: [
                    { role: 'user', content: 'Hi' }
                ],
                max_tokens: 5
            })
        });

        const contentType = response.headers.get('content-type');
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`HTTP ${response.status}: ${text.slice(0, 100)}`);
        }

        if (!contentType || !contentType.includes('application/json')) {
            const text = await response.text();
            throw new Error(`返回了非 JSON 数据 (HTML?)。请检查 API 地址。预览: ${text.slice(0, 50)}`);
        }

        await response.json(); // 尝试解析
        showToast('✅ 连接成功');
    } catch (e) {
        console.error('AI Test Failed:', e);
        showToast('❌ 连接失败: ' + e.message);
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

/**
 * 在页面中填写表单
 */
async function fillFormInPage() {
    updateCurrentDataFromInputs();
    const btn = elements.fillForm;
    const originalText = btn.textContent;

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        // 检查 AI 开关是否开启（主界面开关）
        const useAI = elements.useAIToggle?.checked && userSettings.openaiKey;
        if (useAI) {
            btn.textContent = '🤖 分析中...';
            btn.disabled = true;

            // 1. 扫描页面表单
            let scanResult;
            try {
                scanResult = await chrome.tabs.sendMessage(tab.id, { action: 'scanForm' });
            } catch (e) {
                // 如果 content script 未加载，尝试注入所有依赖
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: [
                        'scripts/selectors/common.js',
                        'scripts/selectors/japan.js',
                        'scripts/content.js'
                    ]
                });
                await new Promise(r => setTimeout(r, 200)); // 稍微增加等待时间
                scanResult = await chrome.tabs.sendMessage(tab.id, { action: 'scanForm' });
            }

            if (!scanResult || !scanResult.fields || scanResult.fields.length === 0) {
                throw new Error('未找到可见的表单字段');
            }

            btn.textContent = '🧠 思考中...';

            // 2. 构建 AI Prompt
            const prompt = `
You are an advanced AI Form Assistant. Your goal is to fill a web form intelligently, acting as the Persona defined below.

Current User Profile: ${JSON.stringify(currentData)}
Persona Description: ${userSettings.aiPersona || 'None'}

Page Context:
Title: ${scanResult.pageContext.title}
Description: ${scanResult.pageContext.description}
URL: ${scanResult.pageContext.url}

Form Fields Found:
${JSON.stringify(scanResult.fields)}

Instructions:
1. **Analyze Context**: Determine the purpose of this form (e.g., "Job Application", "E-commerce Checkout", "Casual Survey", "Government Registration").
2. **Analyze Fields**: For each field, evaluate:
   - **Necessity**: Is it required? (Check 'required' attribute and context).
   - **Privacy/Risk**: Is this sensitive info (e.g., Income, ID, Phone)?
3. **Decide Strategy**:
   - **Real Format**: For standard required fields, use the Persona's data.
   - **Obfuscate/Blur**: For sensitive but optional fields (like exact income), provide a general range or a realistic but safe estimate if appropriate for the context.
   - **Leave Empty**: If a field is optional, sensitive, and not relevant to the form's core purpose, you may choose to leave it empty (return null or empty string).
   - **Refuse/N/A**: If a field is intrusive and allows text input, you may fill "N/A" or "Prefer not to say".
4. **Cultural & Language Adaptation** (CRITICAL):
   - **GLOBAL RULE**: ALWAYS use **Half-width (ASCII)** characters for: **Password**, **Email**, **Phone**, **Postal Code**, **Numbers**. NEVER use Full-width (e.g., １２３, ａｂｃ) for these fields.
   - **Address Logic**: If the form expects a **Local Address** (e.g., has "Prefecture" dropdown, or specific local Zip format) and the Current User Profile has a foreign address, **IGNORE the Profile address and INVENT a valid local address** for the page's target country.
   - **Detect Language**: The page language is '${scanResult.pageContext.language}'. Adapt formats accordingly.
   - **Japan (JP)**: 
     - **Name**: Use Surname First order. Use Kanji for Name fields, Katakana for "Furigana/Reading" fields.
     - **Postal Code**: Check placeholder. If unknown, try "NNN-NNNN" (ASCII).
     - **Phone**: Check placeholder. If unknown, generate a **RANDOM** valid mobile number (starts with 090, 080, or 070). **DO NOT** use "1234" or "0000" sequences. Example: "080-3928-4719".
   - **Germany (DE)**: Ensure addresses are precise (Street + Number, Zip City). Use formal tone.
   - **China (CN)**: Generate valid-looking Resident ID numbers (18 digits) if requested. Use +86 phone format.
   - **Tone**: Match the questionnaire tone (Conservative/Formal for Gov/Bank; Open/Casual for Social/Gaming).
5. **Invent Missing Data**: If the Persona lacks specific data (e.g., Company Name), invent it consistently with the Persona's background.

Output Format:
Return ONLY a valid JSON object where keys are the field 'id' and values are the string to fill.
Example:
{
  "field_1": "John",
  "income_field": "50,000 - 60,000 USD",
  "optional_intrusive_field": ""
}
`;

            // 3. 调用 AI
            const apiUrl = normalizeApiUrl(userSettings.openaiBaseUrl);
            console.log('[GeoFill] AI Request URL:', apiUrl);

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${userSettings.openaiKey}`
                },
                body: JSON.stringify({
                    model: userSettings.openaiModel,
                    messages: [
                        { role: 'system', content: 'You are a helpful assistant that fills forms based on user profiles.' },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.3 // 降低随机性
                })
            });

            const contentType = response.headers.get('content-type');
            if (!response.ok) {
                const text = await response.text();
                console.error('API Error Response:', text);
                throw new Error(`API Error (${response.status}): ${text.slice(0, 100)}...`);
            }
            if (!contentType || !contentType.includes('application/json')) {
                const text = await response.text();
                console.error('API Invalid Content-Type:', contentType, text);
                throw new Error(`API 返回了非 JSON 数据(可能是 HTML)。请检查 API 地址是否正确。预览: ${text.slice(0, 50)}...`);
            }

            const data = await response.json();
            const content = data.choices[0].message.content;

            let jsonStr = content.replace(/```json\n ?|\n ? ```/g, '').trim();
            const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
            if (jsonMatch) jsonStr = jsonMatch[0];

            const mapping = JSON.parse(jsonStr);

            // ===== 强制清洗数据 & 本地逻辑覆盖 (Hard Sanitization & Logic Override) =====
            Object.keys(mapping).forEach(key => {
                let val = mapping[key];
                if (typeof val === 'string') {
                    // 1. 全角转半角 (通用处理)
                    val = val.replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
                        .replace(/\u3000/g, ' ');

                    // 2. 查找字段元数据
                    const fieldMeta = scanResult.fields.find(f => f.id === key);
                    const label = fieldMeta ? (fieldMeta.label || '').toLowerCase() : '';
                    const type = fieldMeta ? (fieldMeta.type || '').toLowerCase() : '';
                    const name = fieldMeta ? (fieldMeta.name || '').toLowerCase() : '';
                    const lowerKey = key.toLowerCase();

                    // 3. 智能判断字段类型并清洗
                    const isPassword = type === 'password' || lowerKey.includes('password') || name.includes('password') || label.includes('密码') || label.includes('パスワード');
                    const isEmail = type === 'email' || lowerKey.includes('email') || name.includes('email') || label.includes('邮箱') || label.includes('メール');
                    const isPhone = type === 'tel' || lowerKey.includes('phone') || lowerKey.includes('mobile') || label.includes('电话') || label.includes('電話') || label.includes('携帯');
                    const isZip = lowerKey.includes('zip') || lowerKey.includes('postal') || label.includes('邮编') || label.includes('郵便');

                    if (isPassword) {
                        // 密码：强制使用当前 Profile 的密码 (保证一致性，避免两次生成不一致)
                        if (currentData.password) {
                            val = currentData.password;
                        } else if (window.generators && window.generators.generatePasswordWithSettings) {
                            val = window.generators.generatePasswordWithSettings(userSettings);
                        } else {
                            val = val.replace(/[^\x00-\x7F]/g, ''); // Fallback
                        }
                    } else if (isEmail) {
                        // 邮箱：只保留 ASCII
                        val = val.replace(/[^\x00-\x7F]/g, '');
                    } else if (isPhone) {
                        // 电话：强制使用当前 Profile 的电话 (保证一致性)
                        if (currentData.phone) {
                            val = currentData.phone;
                        } else if (window.generators && window.generators.generatePhone) {
                            // Fallback if currentData is missing
                            const country = ipData.country || 'United States';
                            val = window.generators.generatePhone(country);
                        } else {
                            val = val.replace(/[^\d-]/g, ''); // Fallback
                        }
                    } else if (isZip) {
                        // 邮编：只保留数字和横杠
                        val = val.replace(/[^\d-]/g, '');
                    }

                    mapping[key] = val;
                }
            });

            console.log('[GeoFill] Sanitized & Overridden Mapping:', mapping);

            btn.textContent = '✍️ 填写中...';

            // 4. 发送填表指令
            await chrome.tabs.sendMessage(tab.id, { action: 'fillFormSmart', data: mapping });

            showToast('AI 智能填写完成');
            saveToHistory();
            window.close();

        } else {
            // 传统逻辑
            try {
                await chrome.tabs.sendMessage(tab.id, { action: 'fillForm', data: currentData });
            } catch (e) {
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: [
                        'scripts/selectors/common.js',
                        'scripts/selectors/japan.js',
                        'scripts/content.js'
                    ]
                });
                await new Promise(r => setTimeout(r, 200));
                await chrome.tabs.sendMessage(tab.id, { action: 'fillForm', data: currentData });
            }
            saveToHistory();
            window.close();
        }

    } catch (error) {
        console.error('填写表单失败:', error);
        showToast('填写失败: ' + error.message);
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

/**
 * 普通填表（不使用 AI，传统方式）
 */
async function fillFormNormalInPage() {
    updateCurrentDataFromInputs();
    const btn = elements.fillFormNormal;
    const originalText = btn.textContent;

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        try {
            await chrome.tabs.sendMessage(tab.id, { action: 'fillForm', data: currentData });
        } catch (e) {
            // 如果 content script 未加载，尝试注入
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: [
                    'scripts/selectors/common.js',
                    'scripts/selectors/japan.js',
                    'scripts/content.js'
                ]
            });
            await new Promise(r => setTimeout(r, 200));
            await chrome.tabs.sendMessage(tab.id, { action: 'fillForm', data: currentData });
        }
        saveToHistory();
        showToast('普通填表完成');
        window.close();

    } catch (error) {
        console.error('普通填表失败:', error);
        showToast('填写失败: ' + error.message);
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

// ===== 新功能函数 =====

/**
 * 一键复制全部信息
 */
async function copyAllToClipboard() {
    updateCurrentDataFromInputs();

    const lines = [
        `姓名: ${currentData.firstName} ${currentData.lastName} `,
        `性别: ${currentData.gender === 'male' ? '男' : '女'} `,
        `生日: ${currentData.birthday} `,
        `用户名: ${currentData.username} `,
        `邮箱: ${currentData.email} `,
        `密码: ${currentData.password} `,
        `电话: ${currentData.phone} `,
        `地址: ${currentData.address} `,
        `城市: ${currentData.city} `,
        `州 / 省: ${currentData.state} `,
        `邮编: ${currentData.zipCode} `,
        `国家: ${currentData.country} `
    ];

    const text = lines.join('\n');

    try {
        await navigator.clipboard.writeText(text);
        showToast('已复制全部信息');
    } catch (err) {
        console.error('复制失败:', err);
        showToast('复制失败');
    }
}

/**
 * 打开设置模态框
 */
function openSettingsModal() {
    if (elements.settingsModal) {
        elements.settingsModal.classList.add('show');
        updateSettingsUI();
        loadArchiveList();
    }
}

/**
 * 关闭设置模态框
 */
function closeSettingsModal() {
    if (elements.settingsModal) {
        elements.settingsModal.classList.remove('show');
    }
}

/**
 * 更新设置 UI
 */
function updateSettingsUI() {
    if (elements.enableAI) elements.enableAI.checked = userSettings.enableAI;
    if (elements.openaiBaseUrl) elements.openaiBaseUrl.value = userSettings.openaiBaseUrl;
    if (elements.openaiKey) elements.openaiKey.value = userSettings.openaiKey;
    if (elements.openaiModel) elements.openaiModel.value = userSettings.openaiModel;
    if (elements.aiPersona) elements.aiPersona.value = userSettings.aiPersona;
    if (elements.passwordLength) elements.passwordLength.value = userSettings.passwordLength;
    if (elements.pwdUppercase) elements.pwdUppercase.checked = userSettings.pwdUppercase;
    if (elements.pwdLowercase) elements.pwdLowercase.checked = userSettings.pwdLowercase;
    if (elements.pwdNumbers) elements.pwdNumbers.checked = userSettings.pwdNumbers;
    if (elements.pwdSymbols) elements.pwdSymbols.checked = userSettings.pwdSymbols;
    if (elements.minAge) elements.minAge.value = userSettings.minAge;
    if (elements.maxAge) elements.maxAge.value = userSettings.maxAge;
    if (elements.autoClearData) elements.autoClearData.checked = userSettings.autoClearData;
    if (elements.geoapifyKey) elements.geoapifyKey.value = userSettings.geoapifyKey || '';

    // 显示/隐藏 AI 开关
    if (elements.aiToggleWrapper) {
        if (userSettings.enableAI && userSettings.openaiKey) {
            elements.aiToggleWrapper.style.display = 'flex';
        } else {
            elements.aiToggleWrapper.style.display = 'none';
        }
    }
}

/**
 * 保存设置
 */
async function saveSettings() {
    userSettings = {
        enableAI: elements.enableAI?.checked ?? false,
        openaiBaseUrl: elements.openaiBaseUrl?.value?.trim() || 'https://api.openai.com/v1',
        openaiKey: elements.openaiKey?.value?.trim() || '',
        openaiModel: elements.openaiModel?.value?.trim() || 'gpt-3.5-turbo',
        aiPersona: elements.aiPersona?.value?.trim() || '',
        passwordLength: parseInt(elements.passwordLength?.value) || 12,
        pwdUppercase: elements.pwdUppercase?.checked ?? true,
        pwdLowercase: elements.pwdLowercase?.checked ?? true,
        pwdNumbers: elements.pwdNumbers?.checked ?? true,
        pwdSymbols: elements.pwdSymbols?.checked ?? true,
        minAge: parseInt(elements.minAge?.value) || 18,
        maxAge: parseInt(elements.maxAge?.value) || 55,
        autoClearData: elements.autoClearData?.checked ?? false,
        geoapifyKey: elements.geoapifyKey?.value?.trim() || ''
    };

    try {
        await chrome.storage.local.set({ [SETTINGS_KEY]: userSettings });
        await chrome.storage.local.set({ [AUTO_CLEAR_KEY]: userSettings.autoClearData });
        if (window.generators && window.generators.updateSettings) {
            window.generators.updateSettings(userSettings);
        }
        // 设置 Geoapify API Key 到 generators
        if (window.generators && window.generators.setGeoapifyApiKey) {
            window.generators.setGeoapifyApiKey(userSettings.geoapifyKey);
        }
    } catch (e) {
        console.log('保存设置失败:', e);
    }
}

/**
 * 加载设置
 */
async function loadSettings() {
    try {
        const result = await chrome.storage.local.get(SETTINGS_KEY);
        if (result[SETTINGS_KEY]) {
            userSettings = { ...userSettings, ...result[SETTINGS_KEY] };
        }
        updateSettingsUI();
        if (window.generators && window.generators.updateSettings) {
            window.generators.updateSettings(userSettings);
        }
        // 加载 Geoapify API Key (独立存储)
        await loadGeoapifyKey();
    } catch (e) {
        console.log('加载设置失败:', e);
    }
}

/**
 * 加载 Geoapify API Key (独立存储)
 */
async function loadGeoapifyKey() {
    try {
        const result = await chrome.storage.local.get(GEOAPIFY_KEY);
        geoapifyApiKey = result[GEOAPIFY_KEY] || '';
        if (elements.geoapifyKey) {
            elements.geoapifyKey.value = geoapifyApiKey;
        }
        // 同步到 generators
        if (window.generators && window.generators.setGeoapifyApiKey) {
            window.generators.setGeoapifyApiKey(geoapifyApiKey);
        }
        console.log('[GeoFill] Geoapify API Key 已加载');
    } catch (e) {
        console.log('加载 Geoapify API Key 失败:', e);
    }
}

/**
 * 保存 Geoapify API Key (独立存储，实时保存)
 */
async function saveGeoapifyKey() {
    const key = elements.geoapifyKey?.value?.trim() || '';
    geoapifyApiKey = key;
    try {
        await chrome.storage.local.set({ [GEOAPIFY_KEY]: key });
        // 同步到 generators
        if (window.generators && window.generators.setGeoapifyApiKey) {
            window.generators.setGeoapifyApiKey(key);
        }
        showToast(key ? 'Geoapify API Key 已保存' : 'Geoapify API Key 已清除');
        console.log('[GeoFill] Geoapify API Key 已保存');
    } catch (e) {
        console.log('保存 Geoapify API Key 失败:', e);
    }
}

/**
 * 保存存档
 */
async function saveArchive() {
    const name = elements.archiveName?.value?.trim();
    if (!name) {
        showToast('请输入存档名称');
        return;
    }

    updateCurrentDataFromInputs();

    try {
        const result = await chrome.storage.local.get(ARCHIVES_KEY);
        const archives = result[ARCHIVES_KEY] || [];

        const existingIndex = archives.findIndex(a => a.name === name);
        const archiveData = {
            name,
            data: { ...currentData },
            timestamp: Date.now()
        };

        if (existingIndex >= 0) {
            archives[existingIndex] = archiveData;
            showToast(`存档 "${name}" 已更新`);
        } else {
            archives.push(archiveData);
            showToast(`存档 "${name}" 已保存`);
        }

        await chrome.storage.local.set({ [ARCHIVES_KEY]: archives });
        if (elements.archiveName) elements.archiveName.value = '';
        await loadArchiveList();
    } catch (e) {
        console.log('保存存档失败:', e);
        showToast('保存失败');
    }
}

/**
 * 加载存档列表
 */
async function loadArchiveList() {
    if (!elements.archiveList) return;

    try {
        const result = await chrome.storage.local.get(ARCHIVES_KEY);
        const archives = result[ARCHIVES_KEY] || [];

        if (archives.length === 0) {
            elements.archiveList.innerHTML = '<div class="archive-empty">暂无存档</div>';
            return;
        }

        elements.archiveList.innerHTML = archives.map((archive, index) => `
            <div class="archive-item" data-index="${index}">
                <span class="archive-item-name">${archive.name}</span>
                <div class="archive-item-actions">
                    <button class="load-btn" title="加载" data-action="load" data-index="${index}">📂</button>
                    <button class="delete-btn" title="删除" data-action="delete" data-index="${index}">🗑️</button>
                </div>
            </div>
        `).join('');
    } catch (e) {
        console.log('加载存档列表失败:', e);
    }
}

/**
 * 加载存档
 */
async function loadArchive(index) {
    try {
        const result = await chrome.storage.local.get(ARCHIVES_KEY);
        const archives = result[ARCHIVES_KEY] || [];

        if (archives[index]) {
            currentData = { ...archives[index].data };
            updateUI();
            saveDataToStorage();
            closeSettingsModal();
            showToast(`已加载存档 "${archives[index].name}"`);
        }
    } catch (e) {
        console.log('加载存档失败:', e);
    }
}

/**
 * 删除存档
 */
async function deleteArchive(index) {
    try {
        const result = await chrome.storage.local.get(ARCHIVES_KEY);
        const archives = result[ARCHIVES_KEY] || [];

        if (archives[index]) {
            const name = archives[index].name;
            archives.splice(index, 1);
            await chrome.storage.local.set({ [ARCHIVES_KEY]: archives });
            await loadArchiveList();
            showToast(`存档 "${name}" 已删除`);
        }
    } catch (e) {
        console.log('删除存档失败:', e);
    }
}

/**
 * 绑定设置相关事件
 */
function bindSettingsEvents() {
    if (elements.openSettings) {
        elements.openSettings.addEventListener('click', openSettingsModal);
    }
    if (elements.closeSettings) {
        elements.closeSettings.addEventListener('click', closeSettingsModal);
    }

    if (elements.settingsModal) {
        elements.settingsModal.addEventListener('click', (e) => {
            if (e.target === elements.settingsModal) {
                closeSettingsModal();
            }
        });
    }

    if (elements.copyAll) {
        elements.copyAll.addEventListener('click', copyAllToClipboard);
    }

    if (elements.saveArchive) {
        elements.saveArchive.addEventListener('click', saveArchive);
    }

    if (elements.testAI) {
        elements.testAI.addEventListener('click', testAIConnection);
    }

    if (elements.archiveList) {
        elements.archiveList.addEventListener('click', (e) => {
            const btn = e.target.closest('button');
            if (!btn) return;

            const action = btn.dataset.action;
            const index = parseInt(btn.dataset.index);

            if (action === 'load') {
                loadArchive(index);
            } else if (action === 'delete') {
                deleteArchive(index);
            }
        });
    }

    const settingInputs = ['enableAI', 'openaiBaseUrl', 'openaiKey', 'openaiModel', 'aiPersona', 'passwordLength', 'pwdUppercase', 'pwdLowercase', 'pwdNumbers', 'pwdSymbols', 'minAge', 'maxAge', 'autoClearData'];
    settingInputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', saveSettings);
        }
    });

    // Geoapify API Key 独立保存 (change 和 blur 事件)
    if (elements.geoapifyKey) {
        elements.geoapifyKey.addEventListener('change', saveGeoapifyKey);
        elements.geoapifyKey.addEventListener('blur', saveGeoapifyKey);
    }

    // 历史记录事件
    if (elements.openHistory) {
        elements.openHistory.addEventListener('click', () => {
            if (elements.historyModal) {
                elements.historyModal.classList.add('show');
                loadHistoryList();
            }
        });
    }

    if (elements.closeHistory) {
        elements.closeHistory.addEventListener('click', () => {
            if (elements.historyModal) {
                elements.historyModal.classList.remove('show');
            }
        });
    }

    if (elements.historyModal) {
        elements.historyModal.addEventListener('click', (e) => {
            if (e.target === elements.historyModal) {
                elements.historyModal.classList.remove('show');
            }
        });
    }

    if (elements.clearHistory) {
        elements.clearHistory.addEventListener('click', () => {
            if (confirm('确定要清空所有历史记录吗？')) {
                clearAllHistory();
            }
        });
    }
}

// 暴露函数给全局
window.loadArchive = loadArchive;
window.deleteArchive = deleteArchive;

