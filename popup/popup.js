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
    // 设置元素
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
    archiveList: null
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
const CACHE_VERSION = 'v3';

// 默认设置
let userSettings = {
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
        await loadGeneratorsScript();
        console.log('[GeoFill] 生成器脚本加载成功');
    } catch (e) {
        console.error('[GeoFill] 加载生成器脚本失败:', e);
    }

    // 缓存 DOM 元素
    elements.ipInfo = document.getElementById('ipInfo');
    elements.ipRefresh = document.getElementById('ipRefresh');
    elements.regenerateAll = document.getElementById('regenerateAll');
    elements.fillForm = document.getElementById('fillForm');
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
    elements.passwordLength = document.getElementById('passwordLength');
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

    try { await loadTheme(); } catch (e) { console.log('loadTheme error:', e); }
    try { await loadSettings(); } catch (e) { console.log('loadSettings error:', e); }

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
function loadGeneratorsScript() {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = '../scripts/generators.js';
        script.onload = () => {
            console.log('[GeoFill] generators.js 已加载');
            resolve();
        };
        script.onerror = (e) => {
            console.error('[GeoFill] generators.js 加载失败:', e);
            reject(e);
        };
        document.head.appendChild(script);
    });
}

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

    if (elements.regenerateAll) {
        elements.regenerateAll.addEventListener('click', () => {
            if (!window.generators) return;

            const lockedValues = {};
            lockedFields.forEach(field => {
                lockedValues[field] = currentData[field];
            });

            currentData = window.generators.generateAllInfoWithSettings(ipData, userSettings);

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
function regenerateEmail() {
    if (!window.generators) return;
    updateCurrentDataFromInputs();
    currentData.email = window.generators.generateEmail(currentData.username);
    if (elements.fields.email) {
        elements.fields.email.value = currentData.email;
    }
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
 * 在页面中填写表单
 */
async function fillFormInPage() {
    updateCurrentDataFromInputs();
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        try {
            await chrome.tabs.sendMessage(tab.id, { action: 'fillForm', data: currentData });
        } catch (e) {
            await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['scripts/content.js'] });
            await new Promise(r => setTimeout(r, 100));
            await chrome.tabs.sendMessage(tab.id, { action: 'fillForm', data: currentData });
        }
        window.close();
    } catch (error) {
        console.error('填写表单失败:', error);
        alert('填写失败，请确保页面已完全加载');
    }
}

// ===== 新功能函数 =====

/**
 * 一键复制全部信息
 */
async function copyAllToClipboard() {
    updateCurrentDataFromInputs();

    const lines = [
        `姓名: ${currentData.firstName} ${currentData.lastName}`,
        `性别: ${currentData.gender === 'male' ? '男' : '女'}`,
        `生日: ${currentData.birthday}`,
        `用户名: ${currentData.username}`,
        `邮箱: ${currentData.email}`,
        `密码: ${currentData.password}`,
        `电话: ${currentData.phone}`,
        `地址: ${currentData.address}`,
        `城市: ${currentData.city}`,
        `州/省: ${currentData.state}`,
        `邮编: ${currentData.zipCode}`,
        `国家: ${currentData.country}`
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
    if (elements.passwordLength) elements.passwordLength.value = userSettings.passwordLength;
    if (elements.pwdUppercase) elements.pwdUppercase.checked = userSettings.pwdUppercase;
    if (elements.pwdLowercase) elements.pwdLowercase.checked = userSettings.pwdLowercase;
    if (elements.pwdNumbers) elements.pwdNumbers.checked = userSettings.pwdNumbers;
    if (elements.pwdSymbols) elements.pwdSymbols.checked = userSettings.pwdSymbols;
    if (elements.minAge) elements.minAge.value = userSettings.minAge;
    if (elements.maxAge) elements.maxAge.value = userSettings.maxAge;
    if (elements.autoClearData) elements.autoClearData.checked = userSettings.autoClearData;
}

/**
 * 保存设置
 */
async function saveSettings() {
    userSettings = {
        passwordLength: parseInt(elements.passwordLength?.value) || 12,
        pwdUppercase: elements.pwdUppercase?.checked ?? true,
        pwdLowercase: elements.pwdLowercase?.checked ?? true,
        pwdNumbers: elements.pwdNumbers?.checked ?? true,
        pwdSymbols: elements.pwdSymbols?.checked ?? true,
        minAge: parseInt(elements.minAge?.value) || 18,
        maxAge: parseInt(elements.maxAge?.value) || 55,
        autoClearData: elements.autoClearData?.checked ?? false
    };

    try {
        await chrome.storage.local.set({ [SETTINGS_KEY]: userSettings });
        await chrome.storage.local.set({ [AUTO_CLEAR_KEY]: userSettings.autoClearData });
        if (window.generators && window.generators.updateSettings) {
            window.generators.updateSettings(userSettings);
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
    } catch (e) {
        console.log('加载设置失败:', e);
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
                    <button class="load-btn" title="加载" onclick="loadArchive(${index})">📂</button>
                    <button class="delete-btn" title="删除" onclick="deleteArchive(${index})">🗑️</button>
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

    const settingInputs = ['passwordLength', 'pwdUppercase', 'pwdLowercase', 'pwdNumbers', 'pwdSymbols', 'minAge', 'maxAge', 'autoClearData'];
    settingInputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', saveSettings);
        }
    });
}

// 暴露函数给全局
window.loadArchive = loadArchive;
window.deleteArchive = deleteArchive;

