// ==UserScript==
// @name         GitHub Notes to Telegram
// @namespace    https://github.com/aaa2ppp/gitnotes
// @version      1.0
// @description  Быстрые пометки к строкам кода → в Telegram
// @author       aaa2ppp
// @match        https://github.com/*/blob/*
// @match        https://github.com/*/blame/*
// @match        https://github.com/*/pull/*/files
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      api.telegram.org
// ==/UserScript==

(function () {
  "use strict";

  const TELEGRAM_BOT_TOKEN = "NNNN:XXXX";
  const TELEGRAM_CHAT_ID = "NNNN";
  const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage?disable_web_page_preview=true`;

  function sendMessage(lineNumber) {
    const comment = prompt(`Что заметил в строке ${lineNumber}?`, "");
    if (!comment?.trim()) return;

    const fileUrl = window.location.href.split("#")[0];
    const fullUrl = `${fileUrl}#L${lineNumber}`;
    const text = `${comment.trim()}\n\n${fullUrl}`;
    const payload = { chat_id: TELEGRAM_CHAT_ID, text: text };

    GM_xmlhttpRequest({
      method: "POST",
      url: TELEGRAM_API,
      data: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" },
      onload: function (response) {
        if (response.status === 200) {
          console.log("Успешный запрос:", response.response);
          // Доступ к данным: response.response
        } else {
          console.error(
            "Ошибка запроса:",
            response.status,
            response.statusText
          );
        }
      },
      onerror: function (response) {
        console.error("Ошибка запроса:", response.status, response.statusText);
      },
    });
  }

  GM_addStyle(`
    .gh-note-btn {
      display: none;
      margin: 0 1px;
      font-size: 9px;
      color: #0969da;
      cursor: pointer;
      user-select: none;
    }
    .react-line-number:hover .gh-note-btn,
    .addition .gh-note-btn,
    .deletion .gh-note-btn {
      display: inline;
    }
  `);

  function addButton(div) {
    if (div.querySelector(".gh-note-btn")) return;
    const lineNumber = div.getAttribute("data-line-number");
    if (!/^\d+$/.test(lineNumber)) return;
    if (!div.classList.contains("react-line-number")) return;
    if (
      div.closest(".diff-header") ||
      div.closest('[data-test-id="diff-header"]')
    )
      return;
    if (div.closest(".addition-header") || div.closest(".deletion-header"))
      return;

    const nextSibling = div.parentElement?.nextElementSibling;
    const codeCell =
      nextSibling?.querySelector(".react-file-line") ||
      div.parentElement?.nextElementSibling?.querySelector(
        ".addition, .deletion"
      );
    if (!codeCell) return;

    const button = document.createElement("span");
    button.className = "gh-note-btn";
    button.textContent = "📌";
    button.title = "Отправить пометку в Telegram";
    button.onclick = (e) => {
      e.preventDefault();
      setTimeout(() => {
        sendMessage(lineNumber);
      }, 0);
    };

    div.appendChild(button);
  }

  function processLines() {
    document.querySelectorAll("div[data-line-number]").forEach(addButton);
  }

  processLines();
  new MutationObserver(processLines).observe(document.body, {
    childList: true,
    subtree: true,
  });

  function addTelegramMenuItem() {
    // Находим меню
    const menu = document.querySelector(
      '[data-testid="highlighted-line-menu"]'
    );
    if (!menu) return;

    // Проверяем, не добавлено ли уже
    if (
      menu.querySelector('a[href^="#telegram"]') ||
      menu.querySelector('a[aria-labelledby*="--telegram-label"]')
    ) {
      return;
    }

    // Получаем номер строки из подсвеченного элемента
    const highlightedLine = document.querySelector(".highlighted-line");
    const lineNumber = highlightedLine?.getAttribute("data-line-number");
    if (!lineNumber) return;

    // Создаём новый пункт меню (НЕ ТРОГАТЬ! пока работает)
    const menuItem = document.createElement("li");
    menuItem.role = "none";
    menuItem.className = "prc-ActionList-ActionListItem-uq6I7";

    const link = document.createElement("a");
    link.className =
      "prc-ActionList-ActionListContent-sg9-x prc-Link-Link-85e08";
    link.tabIndex = "-1";
    link.role = "menuitem";
    link.href = "#telegram"; // символический href
    link.ariaKeyshortcuts = "t";
    link.id = ":r46:";

    const spacer = document.createElement("span");
    spacer.className = "prc-ActionList-Spacer-dydlX";

    const subContent = document.createElement("span");
    subContent.className = "prc-ActionList-ActionListSubContent-lP9xj";
    subContent.dataset.component = "ActionList.Item--DividerContainer";

    const label = document.createElement("span");
    label.id = ":r46:--telegram-label"; // уникальный id
    label.className = "prc-ActionList-ItemLabel-TmBhn";
    label.textContent = "Reference to Telegram";

    subContent.appendChild(label);
    link.appendChild(spacer);
    link.appendChild(subContent);
    // Конец создания пункта меню

    // Обработчик клика
    link.onclick = (e) => {
      e.preventDefault();

      // Поднимаем prompt в следующем тике
      setTimeout(() => {
        sendMessage(lineNumber);
      }, 0);

      // Найти кнопку меню и кликнуть по ней (чтобы закрыть меню)
      const menuButton = document.querySelector(
        '[data-testid="highlighted-line-menu-button"][aria-expanded="true"]'
      );
      if (menuButton) {
        menuButton.click();
      }
    };

    menuItem.appendChild(link);

    const referenceItem = Array.from(menu.querySelectorAll("a")).find(
      (a) => a.textContent.trim() === "Reference in new issue"
    );

    if (referenceItem) {
      referenceItem.parentElement.after(referenceItem.parentElement, menuItem);
    } else {
      menu.appendChild(menuItem);
    }
  }

  // Отслеживаем появление меню
  new MutationObserver(() => {
    const menu = document.querySelector(
      '[data-testid="highlighted-line-menu"]'
    );
    if (menu) addTelegramMenuItem();
  }).observe(document.body, { childList: true, subtree: true });

  console.log("✅ GitHub → Telegram Notes: активен");
})();
