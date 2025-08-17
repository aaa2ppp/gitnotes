// ==UserScript==
// @name         GitHub Notes to Telegram
// @namespace    https://github.com/aaa2ppp/gitnotes
// @version      1.0
// @description  Быстрые пометки к строкам кода → в Telegram
// @author       aaa2ppp
// @match        https://github.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      api.telegram.org
// ==/UserScript==

(function () {
  "use strict";

  GM_addStyle(`
    .gh-note-btn {
      display: inline;
      margin-left: 0 1px;
      cursor: pointer;
      vertical-align: middle;
      user-select: none;
    }
  `);


  class TelegramConfig {
    static _key = 'telegramConfig';

    /**
     * Читает конфигурацию
     * @return {Object}
     */
    static load() {
      return GM_getValue(this._key)
    }

    /**
     * Сохраняет конфигурацию
     * @param {Object} config
     * @param {string} config.historyToken
     * @param {string} config.actionToken
     * @param {string} config.chatId
     * @param {string} config.limit
     */
    static save(config) {
      if (!config.historyToken || !config.actionToken || !config.chatId) {
        throw new Error("Не указаны обязательные поля конфига");
      }
      GM_setValue(this._key, config)
    }

    /**
     * Удаляет конфигурацию
     */
    static clear() {
      GM_setValue(this._key, undefined)
    }
  }

  function addConfigMenu() {
    GM_registerMenuCommand("Настроить Telegram", showConfigForm);
    GM_registerMenuCommand("Очистить кофигурацию Telegram", () => {
      if (confirm("⚠️ Delete ALL saved Telegram tokens and other settings?\n(This cannot be undone!)")) {
        TelegramConfig.clear();
      }
    });  
  }

  function showConfigForm() {
    return new Promise((resolve, reject) => {
      const config = TelegramConfig.load();
      const modal = document.createElement('div');
      modal.className = 'Box f6 rounded-1 text-normal color-shadow-small';
      modal.style = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        /*background: white;*/
        padding: 20px;
        border-radius: 8px;
        box-shadow: 0 0 20px rgba(0,0,0,0.2);
        z-index: 99999;
        width: 80%;
        max-width: 400px;
      `;

      modal.innerHTML = `
        <h3>Настройки GitHub Notes</h3>
        <form id="auth-form">

          <label>
            Токен чтения:
            <input type="input"
                   value="${config?.historyToken || ''}"
                   placeholder="1234567890:ABCdef..."
                   pattern="^\\d{9,10}:[A-Za-z0-9_\\-]{35}$"
                   required>
          </label><br/>

          <label>
            Токен отправки:
            <input type="input"
                   value="${config?.actionToken || ''}"
                   placeholder="1234567890:ABCdef..."
                   pattern="^\\d{9,10}:[A-Za-z0-9_\\-]{35}$"
                   required>
          </label><br/>

          <label>
            ID чата:
            <input type="text"
                   value="${config?.chatId || ''}"
                   placeholder="-1001234567890"
                   pattern="^-100\\d+$"
                   required>
          </label><br/>

          <label>
            Лимит:
            <input type="number"
                   value="${config?.limit || 50}"
                   min="1" max="100"
                   required>
          </label><br/>

          <div class="buttons">
            <button type="submit">Сохранить</button>
            <button type="button" id="cancel-btn">Отмена</button>
          </div>
        </form>
      `;

      modal.querySelector('form').onsubmit = (e) => {
        e.preventDefault();
        const inputs = e.target.elements;

        const config = {
          historyToken: inputs[0].value.trim(),
          actionToken: inputs[1].value.trim(),
          chatId: inputs[2].value.trim(),
          limit: parseInt(inputs[3].value.trim()),
        };

        TelegramConfig.save(config);
        console.log('Настройки Telegram сохранены');

        modal.remove();
        resolve(config);
      };

      modal.querySelector('#cancel-btn').addEventListener('click', () => {
        modal.remove();
        reject(new Error('Настройки Telegram отменены'));
      });

      document.body.appendChild(modal);
    });
  }

  /*------------------------------------------------------------*/

  /**
   * Представляет заметку к строке кода в GitHub
   * @property {string} repo - Репозиторий в формате owner/repo
   * @property {string} file - Путь к файлу
   * @property {string} branch - Ветка
   * @property {number} line - Номер строки (начиная с 1)
   * @property {Date} timestamp - Дата создания заметки
   * @property {string} text - Текст заметки
   */
  class Note {
    /**
     * Создает экземпляр Note
     * @param {Object} params - Параметры заметки
     * @param {string} params.repo - Репозиторий
     * @param {string} params.file - Путь к файлу
     * @param {string} params.branch - Ветка
     * @param {number} params.line - Номер строки
     * @param {Date|string} params.timestamp - Дата создания
     * @param {string} [params.text=""] - Текст заметки
     */
    constructor({ repo, file, branch, line, timestamp, text = "" }) {
      if (!Note._isValidPath(repo)) throw new Error("Invalid repo");
      if (!Note._isValidPath(file)) throw new Error("Invalid file");
      if (!Note._isValidPath(branch)) throw new Error("Invalid branch");

      this.repo = repo.trim();
      this.file = file.trim();
      this.branch = branch.trim();
      this.line = Note._validateLine(line);
      this.timestamp = Note._validateTimestamp(timestamp);
      this.text = text.trim();
    }

    static _isValidPath(input) {
      if (typeof input !== 'string' || !input.trim()) return false;
      const parts = input.split('/');
      return parts.length > 0 && parts.every(part => {
        const trimmed = part.trim();
        return trimmed !== '' && trimmed !== '.' && trimmed !== '..';
      });
    }

    static _validateLine(input) {
      if (input === undefined || input === null || typeof input === 'string' && input.trim() === '') {
        throw new Error("Line number is required");
      }

      if (typeof input === 'boolean') {
        throw new Error("Line number must be integer");
      }

      const num = Number(input);
      if (!Number.isInteger(num) || num <= 0) {
        throw new Error("Line number must be positive integer");
      }

      return num;
    }

    static INVALID_DATE_SENTINEL = () => new Date(0);

    static _validateTimestamp(input) {
      if (input === null) return Note.INVALID_DATE_SENTINEL();
      const date = new Date(input);
      return isNaN(date.getTime()) ? Note.INVALID_DATE_SENTINEL() : date;
    }

    static _encodePath(input) {
      return input.split('/').map(encodeURIComponent).join('/')
    }

    /**
     * URL на строку кода в GitHub
     * @type {string}
     */
    get url() {
      return `https://github.com/${Note._encodePath(this.repo)}/blob/${Note._encodePath(this.branch)}/${Note._encodePath(this.file)}#L${this.line}`;
    }
  }

  /**
   * Конвертирует заметки между форматами Telegram и Note
   */
  class TelegramNoteAdapter {
    /**
     * Преобразует Note в текст сообщения Telegram
     * @param {Note} note - Заметка для преобразования
     * @returns {string} Текст сообщения
     */
    static toMessage(note) {
      console.log('toMessage', {note});
      return [
        `📌 *Заметка в коде*`,
        `🔹 *Репозиторий:* ${note.repo}`,
        `🔸 *Ветка:* ${note.branch}`,
        `📎 *Файл:* ${note.file}`,
        `🔢 *Строка:* ${note.line}`,
        `🕒 *Время:* ${note.timestamp.toISOString()}`,
        `🔗 *Ссылка:* [github.com/.../${note.file}](${note.url})`,
        "",
        note.text,
      ].join("\n");
    }

    /**
     * Парсит сообщение Telegram в Note
     * @param {string} message - Сообщение из Telegram
     * @returns {Note} Распарсенная заметка
     * @throws {Error} Если сообщение имеет неверный формат
     */
    static fromMessage(message) {
      if (typeof message !== 'string') {
        throw new Error(`Ожидалась строка, получено: ${typeof message}`);
      }

      // Подготовка строк
      const lines = message.split('\n').map(line => line.trim());

      // Проверка, что это заметка (первая непустая строка)
      const firstLine = lines.find(line => line !== '');
      if (!firstLine || !/^[^a-zа-я]*(заметка|note)/i.test(firstLine)) {
        throw new Error(`Первая строка должна начинаться с "Заметка" или "Note", получено: "${firstLine}"`);
      }

      // Парсинг заголовков (до первой пустой строки)
      const headers = {};
      let i = lines.indexOf(firstLine) + 1;

      while (i < lines.length && lines[i] !== '') {
        const line = lines[i];
        const colonIdx = line.indexOf(':');

        if (colonIdx <= 0) {
          throw new Error(`Некорректный заголовок: отсутствует двоеточие в строке "${line}"`);
        }

        const key = line.slice(0, colonIdx)
        .replace(/[^a-zа-я]/gi, '') // это работает только по тому, что заголовки у нас состоят только из букв
        .toLowerCase();

        if (!key) {
          throw new Error(`Не удалось извлечь название поля из строки "${line}"`);
        }

        headers[key] = line.slice(colonIdx + 1).trim();
        i++;
      }

      const requiredFields = {
        'репозиторий': 'repo',
        'файл': 'file',
        'ветка': 'branch',
        'строка': 'line',
        'время': 'timestamp',
      };

      let fields = {};

      for (const [ruField, enField] of Object.entries(requiredFields)) {
        const value = headers[ruField] || headers[enField];
        if (!value) {
          throw new Error(`Отсутствует обязательное поле: ${ruField} или ${enField}`);
        }
        fields[enField] = value;
      }

      fields.text = lines.slice(i + 1).join('\n').trim();

      return new Note(fields);
    }
  }

  /**
   * Кэш заметок с иерархической структурой (репозиторий → ветка → файл → строка)
   */
  class HierarchicalNoteCache {
    constructor() {
      this.tree = Object.create(null); // { repo: { branch: { file: { line: [note] } } } }
    }

    /**
     * Добавляет заметку в кэш
     * @param {Note} note - Заметка для добавления
     */
    addNote(note) {
      const { repo, branch, file, line } = note;

      if (!repo || !branch || !file || !this._isValidLineNumber(line)) {
        return; // пропускаем невалидные заметки
      }

      let r = this.tree[repo] || (this.tree[repo] = Object.create(null));
      let b = r[branch] || (r[branch] = Object.create(null));
      let f = b[file] || (b[file] = Object.create(null));
      let l = f[line] || (f[line] = []);

      l.push(note);
    }

    _isValidLineNumber(line) {
      return Number.isInteger(line) && line > 0;
    }

    /**
     * Возвращает заметки для указанной строки
     * @param {Object} params - Параметры поиска
     * @param {string} params.repo - Репозиторий
     * @param {string} params.branch - Ветка
     * @param {string} params.file - Файл
     * @param {number} params.line - Номер строки
     * @returns {Note[]} Массив заметок (может быть пустым)
     */
    getNotes({ repo, branch, file, line }) {
      return this.tree[repo]?.[branch]?.[file]?.[line] || [];
    }
  }

  /**
   * Работает с Telegram API как хранилищем заметок
   */
  class TelegramStorage {
    /**
     * @param {Object} config - Конфигурация
     * @param {string} config.historyToken - Токен для чтения истории
     * @param {string} config.actionToken - Токен для отправки сообщений
     * @param {string} config.chatId - ID чата/канала
     * @param {string} [config.apiBaseUrl="https://api.telegram.org"] - Базовый URL Telegram API
     * @param {number} [config.limit=100] - Лимит сообщений
     */
    constructor({ historyToken, actionToken, chatId, apiBaseUrl = "https://api.telegram.org", limit = 100 }) {
      this.historyToken = historyToken;
      this.actionToken = actionToken;
      this.chatId = chatId;
      this.apiBaseUrl = apiBaseUrl;
      this.botUrlPrefix = `${apiBaseUrl}/bot`;
      this.limit = Math.min(limit, 100); // Не больше 100 (ограничение Telegram API)

      // Состояние
      this.lastUpdateId = null; // ID последнего обработанного обновления
      this.processedMessageIds = new Set(); // Множество полученных/отправленных ID сообщений
    }

    /**
     * Загружает заметки из Telegram
     * @returns {Promise<Note[]>} Массив заметок
     */
    async loadNotes() {
      if (this.lastUpdateId === null) {
        return this.getHistory();
      } else {
        return this.pollUpdates();
      }
    }

    /**
     * Получает "хвост" истории заметок (в пределах лимита)
     * @returns {Promise<Note[]>} Массив заметок
     */
    async getHistory() {
      const limit = this.limit;
      const url = `${this.botUrlPrefix}${this.historyToken}/getUpdates?limit=${limit}&offset=-${limit}&timeout=0`;

      console.log("TelegramStorage.getHistory: fetching...", url);
      const data = await this._httpGet(url);
      this._updateLastUpdateId(data);
      return this._parseNotes(data);
    }

    /**
     * Опрашивает новые сообщения (после lastUpdateId)
     * Для live-обновлений
     * @returns {Promise<Note[]>} Массив заметок
     */
    async pollUpdates(timeout) {
      let url = `${this.botUrlPrefix}${this.actionToken}/getUpdates?limit=100`;
      if (parseInt(timeout) > 0) {
        url += `&timeout=${parseInt(timeout)}`
      }
      if (this.lastUpdateId !== null) {
        url += `&offset=${this.lastUpdateId + 1}`;
      }

      console.log("TelegramStorage.pollUpdates: fetching...", url);
      const data = await this._httpGet(url);
      this._updateLastUpdateId(data);
      return this._parseNotes(data);
    }

    _updateLastUpdateId(data) {
      const updates = data.result || [];
      for (const update of updates) {
        if (
          this.lastUpdateId === null ||
          update.update_id > this.lastUpdateId
        ) {
          this.lastUpdateId = update.update_id;
        }
      }
    }

    /**
     * Парсит сообщения как Note (только новые)
     */
    _parseNotes(data) {
      const notes = [];
      for (const update of data.result || []) {
        const message = update.channel_post || update.edited_channel_post || update.message;
        if (!message) {
          console.warn('update no contains message:', {update});
          continue;
        }

        // Пропускаем, если это мы сами отправили или уже получали
        const messageId = message.message_id;
        if (this.processedMessageIds.has(messageId)) {
          console.warn('skip processed message:', {message});
          continue;
        }
        this.processedMessageIds.add(messageId);

        const text = message.text;
        try {
          notes.push(TelegramNoteAdapter.fromMessage(text));
        } catch (err) {
          console.warn('parse message failed', {text, err});
        }
      }

      console.log(`TelegramStorage._parseNotes: parsed ${notes.length} notes`);
      return notes;
    }

    /**
     * Отправляет заметку в Telegram
     * @param {Note} note - Заметка для отправки
     * @returns {Promise<void>}
     */
    async sendNote(note) {
      const url = `${this.botUrlPrefix}${this.actionToken}/sendMessage`;

      const payload = {
        chat_id: this.chatId,
        text: TelegramNoteAdapter.toMessage(note),
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      };

      console.log("TelegramStorage.sendNote: sending...", { url, payload });
      const data = await this._httpPost(url, payload);

      // Запоминаем ID отправленного сообщения
      const messageId = data.result.message_id;
      this.processedMessageIds.add(messageId);

      return;
    }

    _httpGet(url) {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          timeout: 30_000,
          method: "GET",
          url: url,
          headers: {
            "Content-Type": "application/json",
          },
          onload: function (response) {
            try {
              if (response.status !== 200) {
                return reject(
                  new Error(`HTTP ${response.status}: ${response.statusText}`)
                );
              }
              const data = JSON.parse(response.responseText);
              if (!data.ok) {
                return reject(
                  new Error(`Telegram error: ${data.description || JSON.stringify(data)}`)
                );
              }
              console.log(`TelegramStorage._httpGet: received:`, {data});
              resolve(data);
            } catch (err) {
              reject(new Error(`Parse error: ${err.message}`));
            }
          },
          onerror: function (err) {
            reject(new Error(`Network error: ${err.statusText || err}`));
          },
          ontimeout: function () {
            reject(new Error("Request timed out"));
          },
        });
      });
    }

    _httpPost(url, payload) {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: "POST",
          timeout: 30_000,
          url: url,
          data: JSON.stringify(payload),
          headers: {
            "Content-Type": "application/json",
          },
          onload: function (response) {
            if (response.status !== 200) {
              return reject(
                new Error(`HTTP ${response.status}: ${response.statusText}`)
              );
            }
            try {
              const data = JSON.parse(response.responseText);
              if (!data.ok) {
                return reject(
                  new Error(`Telegram error: ${data.description || JSON.stringify(data)}`)
                );
              }
              console.log(`TelegramStorage._httpPost: received:`, {data});
              resolve(data);
            } catch (err) {
              reject(new Error(`Invalid JSON response: ${err.message}`));
            }
          },
          onerror: function (err) {
            reject(new Error(`Network error: ${err.statusText || err}`));
          },
          ontimeout: function () {
            reject(new Error("Request timed out"));
          },
        });
      });
    }
  }

  /**
   * Основной интерфейс для работы с заметками
   */
  class NoteManager {
    /**
     * @param {TelegramStorage} storage - Хранилище заметок
     * @param {HierarchicalNoteCache} cache - Кэш заметок
     */
    constructor(storage, cache) {
      this.storage = storage;
      this.cache = cache;
      this.isLoaded = false;
      this._updateListeners = []; // ← массив подписчиков
    }

    /**
     * Загружает заметки в кеш
     */
    async loadFromRemote() {
      if (this.isLoaded) return;

      try {
        const newNotes = await this.storage.loadNotes();

        // Добавляем только новые заметки — не трогаем старые
        for (const note of newNotes) {
          this.cache.addNote(note);
        }

        console.log(`NoteManager: добавлено ${newNotes.length} новых заметок`);
        this.isLoaded = true;

        if (newNotes.length > 0) {
          this._notifyUpdate(newNotes); // Уведомляем UI
        }
      } catch (err) {
        console.error("NoteManager: ошибка обновления", err);
      }
    }

    /**
     * Возвращает заметки для указанной строки
     * @param {Object} params - Параметры поиска
     * @param {string} params.repo - Репозиторий
     * @param {string} params.branch - Ветка
     * @param {string} params.file - Файл
     * @param {number} params.line - Номер строки
     * @returns {Note[]} Массив заметок
     */
    getNotes({ repo, branch, file, line }) {
      return this.cache.getNotes({ repo, branch, file, line });
    }

    /**
     * Сохраняет новую заметку
     * @param {Note} note - Заметка для сохранения
     * @returns {Promise<void>}
     * @throws {Error} Если данные невалидны или отправка не удалась
     */
    async saveNote(note) {
      // Сбор ошибок для чёткого сообщения
      const errors = [];

      if (!note.repo || typeof note.repo !== "string" || !note.repo.trim()) {
        errors.push("repo must be a non-empty string");
      }
      if (
        !note.branch ||
        typeof note.branch !== "string" ||
        !note.branch.trim()
      ) {
        errors.push("branch must be a non-empty string");
      }
      if (!note.file || typeof note.file !== "string" || !note.file.trim()) {
        errors.push("file must be a non-empty string");
      }
      if (note.line == null) {
        errors.push("line is required");
      } else if (!Number.isInteger(note.line)) {
        errors.push("line must be an integer");
      } else if (note.line <= 0) {
        errors.push("line must be >= 1 (GitHub starts from 1)");
      }

      if (errors.length > 0) {
        const message = "Invalid note: " + errors.join(", ");
        console.warn("NoteManager.saveNote: validation failed", {
          note,
          errors,
        });
        throw new Error(message);
      }

      try {
        await this.storage.sendNote(note);
        this.cache.addNote(note);
        console.log("NoteManager: заметка успешно сохранена", {
          repo: note.repo,
          branch: note.branch,
          file: note.file,
          line: note.line,
        });
        this._notifyUpdate([note]);
      } catch (err) {
        console.error("NoteManager: ошибка отправки заметки", err);
        throw new Error(`Не удалось отправить заметку: ${err.message}`);
      }
    }

    /**
     * Принудительное обновление кеша
     */
    async refresh() {
      this.isLoaded = false;
      await this.loadFromRemote();
    }

    /**
     * Подписка на обновление кеша
     * @param {Function} callback
     */
    onUpdate(callback) {
      this._updateListeners.push(callback);
    }

    _notifyUpdate(notes) {
      this._updateListeners.forEach((cb) => cb(notes));
    }
  }

  /**
   * Получает текст заметки от пользователя
   */
  class NoteInput {
    /**
     * Запрашивает текст заметки
     * @param {string} msg - Текст запроса
     * @returns {Promise<string|null>} Текст заметки или null если отменено
     */
    ask(msg) {
      return new Promise((resolve) => {
        setTimeout(() => {
          // чтобы интерфейс обновился перед prompt
          const text = prompt(msg, "");
          resolve(text?.trim() ? text.trim() : null);
        }, 0);
      });
    }
  }

  /**
   * Добавляет кнопки заметок к строкам кода
   */
  class LineNoteButtons {
    /**
     * @param {NoteManager} manager - Менеджер заметок
     * @param {NoteInput} noteInput - Ввод заметок
     */
    constructor(manager, noteInput) {
      this.manager = manager;
      this.noteInput = noteInput;
      this._pendingUpdates = new Set();
      this._isFrameScheduled = false;
    }

    static pinIcon= "📌";
    static noteIcon = "🔖";
    static buttonClass = "gh-note-btn";
    static activeButtonClass = "gh-pinned-note-btn";
    static tooltipClass = "gh-notes-tooltip gh-notes-tooltip Box f6 rounded-1 text-normal color-shadow-small";
    static lineNumSelector = "div[data-line-number].react-line-number.react-code-text";
    static pendingTimeout = 50;

    /**
     * Запускает обработку строк кода
     */
    start() {
      this.manager.onUpdate(notes => this._processNotes(notes));

      const observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) {
              continue;
            }
            if (node.matches(LineNoteButtons.lineNumSelector)) {
              this._updateButton(node);
              continue;
            }
            node.querySelectorAll(LineNoteButtons.lineNumSelector).forEach(node => {
              this._updateButton(node);
            });
          }
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });

      document.querySelectorAll(LineNoteButtons.lineNumSelector).forEach(line => {
        this._updateButton(line);
      });
    }

    _processNotes(notes) {
      const { repo, branch, file } = this._parseUrl();
      if (!file) return;

      const lineNums = new Set;
      notes.forEach(note => {
        if (note.repo !== repo || note.branch !== branch || note.file !== file) return;
        lineNums.add(note.line);
      });

      document.querySelectorAll(LineNoteButtons.lineNumSelector).forEach((div) => {
        const lineNumber = parseInt(div.getAttribute("data-line-number"), 10);
        if (lineNums.has(lineNumber)) this._updateButton(div);
      });
    }

    _updateButton(div) {
      this._pendingUpdates.add(div);

      if (this._isFrameScheduled) return;
      this._isFrameScheduled = true;

      setTimeout(() => {
        requestAnimationFrame(() => {
          const aliveElements = [];
          this._pendingUpdates.forEach(div => {
            if (div.isConnected) aliveElements.push(div);
          });

          aliveElements.forEach(div => {
            const lineNumber = parseInt(div.getAttribute("data-line-number"), 10);
            if (isNaN(lineNumber) || lineNumber <= 0) return;

            let button = div.querySelector(`.${LineNoteButtons.buttonClass}`);
            if (!button) {
              button = this._createButton(lineNumber);
              div.appendChild(button);
            }

            this._updateButtonState(button, lineNumber);
          });

          this._pendingUpdates.clear();
          this._isFrameScheduled = false;
        });
      }, LineNoteButtons.pendingTimeout);
    }

    _createButton(lineNumber) {
      const button = document.createElement("span");
      button.className = LineNoteButtons.buttonClass;
      button.textContent = LineNoteButtons.pinIcon;
      button.title = "Добавить заметку";
      button.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._onButtonClick(lineNumber);
      };

      // Всплывающее окно при наведении
      button.addEventListener("mouseenter", () => {
        this._showTooltip(button, lineNumber);
      });

      button.addEventListener("mouseleave", () => {
        this._hideTooltip();
      });

      return button;
    }

    _updateButtonState(button, lineNumber) {
      const notes = this.manager.getNotes(this._getContext(lineNumber));
      const hasNotes = notes.length > 0;

      // Обновляем иконку
      if (hasNotes && button.textContent !== LineNoteButtons.noteIcon) {
        button.textContent = LineNoteButtons.noteIcon;
      } else if (!hasNotes && button.textContent !== LineNoteButtons.pinIcon) {
        button.textContent = LineNoteButtons.pinIcon;
      }

      // Обновляем класс
      button.classList.toggle(LineNoteButtons.activeButtonClass, hasNotes);

      // Обновляем title
      button.title = hasNotes
        ? `Заметки: ${notes.length} шт. Нажмите, чтобы добавить`
        : "Добавить заметку";
    }

    _showTooltip(button, lineNumber) {
      this._hideTooltip(); // убираем старое

      const notes = this.manager.getNotes(this._getContext(lineNumber));
      if (notes.length === 0) return;

      // Сортируем по timestamp (новые сверху)
      const sortedNotes = [...notes].sort((a, b) => {
        return b.timestamp.getTime() - a.timestamp.getTime();
      });

      const tooltip = document.createElement("div");
      tooltip.className = LineNoteButtons.tooltipClass;
      tooltip.style.cssText = `
        position: absolute;
        top: ${button.getBoundingClientRect().bottom + window.scrollY + 4}px;
        left: ${button.getBoundingClientRect().left + window.scrollX}px;
        border-radius: 6px;
        padding: 8px 12px;
        max-width: 400px;
        max-height: 300px;
        overflow-y: auto;
        z-index: 10000;
        line-height: 1.4;
      `;
      const title = document.createElement("div");
      title.textContent = `Заметки (${sortedNotes.length})`;
      title.style.cssText =
        "font-weight: bold; margin-bottom: 6px; color: #58a6ff;";

      tooltip.appendChild(title);

      // Ограничиваем отображение (например, 10)
      const displayNotes = sortedNotes.slice(0, 10);

      displayNotes.forEach((note) => {
        const item = document.createElement("div");
        item.style.cssText = "margin-bottom: 8px;";

        const text = document.createElement("div");
        text.textContent = note.text;
        text.style.cssText = "white-space: pre-wrap; word-break: break-word;";

        const meta = document.createElement("div");
        meta.textContent = `от ${note.timestamp.toLocaleString()}`;
        meta.style.cssText =
          "color: #8b949e; font-size: 11px; margin-top: 4px;";

        tooltip.appendChild(document.createElement("hr")); // TODO: уменьшить интервал сверху и снизу
        item.appendChild(text);
        item.appendChild(meta);
        tooltip.appendChild(item);
      });

      if (sortedNotes.length > 10) {
        const more = document.createElement("div");
        more.textContent = `и ещё ${sortedNotes.length - 10}...`;
        more.style.cssText =
          "color: #8b949e; font-size: 11px; margin-top: 8px;";
        tooltip.appendChild(more);
      }

      document.body.appendChild(tooltip);
      this._tooltip = tooltip;
    }

    _hideTooltip() {
      if (this._tooltip) {
        this._tooltip.remove();
        this._tooltip = null;
      }
    }

    async _onButtonClick(lineNumber) {
      const comment = await this.noteInput.ask(
        `Что заметил в строке ${lineNumber}?`
      );
      if (!comment) return;

      const { repo, branch, file } = this._parseUrl();
      if (!repo || !branch || !file) {
        alert("Не удалось определить repo/branch/file из URL");
        return;
      }

      const note = new Note({
        repo,
        branch,
        file,
        line: lineNumber,
        timestamp: new Date(),
        text: comment,
      });

      try {
        await this.manager.saveNote(note);
      } catch (err) {
        alert("Ошибка: " + err.message);
      }
    }

    _getContext(line) {
      const { repo, branch, file } = this._parseUrl();
      return { repo, branch, file, line };
    }

    _parseUrl() {
      return whereAreWeLocated();
    }
  }

  /**
   * Добавляет пункт "Add Note" в контекстное меню строк
   */
  class AddNoteMenuItem {
    /**
     * @param {NoteManager} manager - Менеджер заметок
     * @param {NoteInput} noteInput - Ввод заметок
     */
    constructor(manager, noteInput) {
      this.manager = manager;
      this.noteInput = noteInput;
    }

    static menuButtonSelector = '[data-testid="highlighted-line-menu-button"]';
    static menuSelector = '[data-testid="highlighted-line-menu"]';
    static menuItemHref = "#add-note";
    static menuItemId = "add-note-menu-item";

    /**
     * Запускает отслеживание контекстных меню
     */
    start() {
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) {
              continue;
            }
            if (node.matches(AddNoteMenuItem.menuSelector)) {
              this._onMenuAppeared(node);
              return;
            }
            const menu = node.querySelector(AddNoteMenuItem.menuSelector);
            if (menu) {
              this._onMenuAppeared(menu);
              return;
            }
          }
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true
      });
    }

    _onMenuAppeared(menu) {
      if (
        menu.querySelector(`[href="${AddNoteMenuItem.menuItemHref}"]`) ||
        menu.querySelector(`#${AddNoteMenuItem.menuItemId}`)
      ) {
        return;
      }

      const menuButton = document.querySelector(AddNoteMenuItem.menuButtonSelector);
      if (!menuButton) return;

      // Получаем номер строки из подсвеченного элемента
      const highlightedLine = document.querySelector(".highlighted-line");
      const lineNumber = highlightedLine?.getAttribute("data-line-number");
      if (!lineNumber) return;

      const menuItem = this._createMenuItem(() => {
        this._closeMenu(menuButton);
        this._handleAddNote(lineNumber);
      });

      const referenceItem = Array.from(menu.querySelectorAll("a")).find(
        (a) => a.textContent?.trim() === "Reference in new issue"
      );

      if (referenceItem) {
        menu.insertBefore(menuItem, referenceItem.parentElement);
      } else {
        menu.appendChild(menuItem);
      }
    }

    _createMenuItem(onClick) {
      const li = document.createElement("li");
      li.role = "none";
      li.className = "prc-ActionList-ActionListItem-uq6I7";
      li.id = AddNoteMenuItem.menuItemId;

      const a = document.createElement("a");
      a.className =
        "prc-ActionList-ActionListContent-sg9-x prc-Link-Link-85e08";
      a.tabIndex = "-1";
      a.role = "menuitem";
      a.href = AddNoteMenuItem.menuItemHref;
      a.ariaKeyshortcuts = "n"; // теперь 'n', а не 't'

      const spacer = document.createElement("span");
      spacer.className = "prc-ActionList-Spacer-dydlX";

      const subContent = document.createElement("span");
      subContent.className = "prc-ActionList-ActionListSubContent-lP9xj";
      subContent.dataset.component = "ActionList.Item--DividerContainer";

      const label = document.createElement("span");
      label.className = "prc-ActionList-ItemLabel-TmBhn";
      label.textContent = "Add Note";

      subContent.appendChild(label);
      a.appendChild(spacer);
      a.appendChild(subContent);

      a.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      };

      li.appendChild(a);
      return li;
    }

    async _handleAddNote(lineNumber) {
      const comment = await this.noteInput.ask(
        `Что заметил в строке ${lineNumber}?`
      );
      if (!comment) return;

      const { repo, branch, file } = this._parseUrl();
      if (!repo || !branch || !file) {
        alert("Не удалось определить repo/branch/file");
        return;
      }

      const note = new Note({
        repo,
        branch,
        file,
        line: lineNumber,
        timestamp: new Date(),
        text: comment,
      });

      try {
        await this.manager.saveNote(note);
        // alert('Заметка сохранена!');
      } catch (err) {
        alert("Ошибка: " + err.message);
      }
    }

    _getLineNumberFromButton(menuButton) {
      const target = menuButton
      .closest("[data-line-number]")
      ?.getAttribute("data-line-number");

      if (!target) return null;

      const num = parseInt(target, 10);
      return Number.isInteger(num) && num > 0 ? num : null;
    }

    _closeMenu(menuButton) {
      if (menuButton.getAttribute("aria-expanded") === "true") {
        menuButton.click();
      }
    }

    _parseUrl() {
      return whereAreWeLocated();
    }
  }

  function getBranch() {
    const branchButton = document.querySelector('[data-testid="anchor-button"][aria-label*="branch"]');
    const ariaLabel = branchButton?.getAttribute('aria-label');
    if (!ariaLabel) return '';

    return decodeURI(ariaLabel.slice(0, -'branch'.length).trim());
  }

  /**
   * @return {repo, branch, file}
   */
  function whereAreWeLocated() {
    // https://github.com/aaa2ppp/repo-name-with-slashes/blob/branch/name/with/slashes/some/long/path/file.code ->
    // {"repo": "aaa2ppp/repo-name-with-slashes", "branch": "branch/name/with/slashes", "file": "some/long/path/file.code"}
    //
    // https://github.com/aaa2ppp/repo-name-with-slashes/blob/латиница-в-имени-ветки/path/путь/латиница%20в%20имени%20файла ->
    // {"repo": "aaa2ppp/repo-name-with-slashes", "branch": "латиница-в-имени-ветки", "file": "path/путь/латиница в имени файла"}

    const path = window.location.pathname;
    const parts = path.split('/').filter(Boolean).map(decodeURIComponent);

    if (parts.length < 4 || !['blob', 'blame'].includes(parts[2])) {
      return { repo: null, branch: null, file: null };
    }

    const owner = parts[0];
    const repo = parts[1];
    const branch = getBranch();

    if (!branch) {
      console.warn('whereAreWeLocated: branch not found');
      return { repo: `${owner}/${repo}` };
    }

    const file = parts.slice(3 + branch.split('/').length).join('/');

    return {
      repo: `${owner}/${repo}`,
      branch,
      file
    };
  }

  async function main() {
    // Добавляем меню для смены настроек
    addConfigMenu();

    console.log("GitHub Notes to Telegram активен");

    let config = TelegramConfig.load();
    if (!config?.historyToken) {
      config = await showConfigForm();
    }

    // Зависимости
    const cache = new HierarchicalNoteCache();
    const storage = new TelegramStorage(config);
    const manager = new NoteManager(storage, cache);

    // Фоновая загрузка
    manager.loadFromRemote().catch((err) => {
      console.error("Загрузка заметок не удалась", err);
    });

    // Запуск UI
    const noteInput = new NoteInput();
    new LineNoteButtons(manager, noteInput).start();
    new AddNoteMenuItem(manager, noteInput).start();
  }

  // Запуск
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", main);
  } else {
    main();
  }
})();