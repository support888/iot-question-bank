const PAGE_SIZE = 15;
const STORAGE_KEY = "iot-question-bank-progress-v1";
const THEME_KEY = "iot-question-bank-theme";

const typeLabels = {
  single: "单选题",
  judge: "判断题",
  short: "简答题",
  analysis: "分析题",
  discussion: "论述题",
};

const state = {
  questions: [],
  meta: null,
  filtered: [],
  page: 1,
  view: "bank",
  sources: new Set(),
  types: new Set(Object.keys(typeLabels)),
  status: "all",
  query: "",
  randomIds: [],
  expandedAll: false,
};

let progress = loadProgress();
let toastTimer = null;

const elements = {
  list: document.querySelector("#question-list"),
  empty: document.querySelector("#empty-state"),
  pagination: document.querySelector("#pagination"),
  search: document.querySelector("#search-input"),
  sourceFilters: document.querySelector("#source-filters"),
  typeFilters: document.querySelector("#type-filters"),
  statusFilters: document.querySelector("#status-filters"),
  resultCount: document.querySelector("#result-count"),
  title: document.querySelector("#question-area-title"),
  viewLabel: document.querySelector("#active-view-label"),
  progressRing: document.querySelector("#progress-ring"),
  progressPercent: document.querySelector("#progress-percent"),
  answeredCount: document.querySelector("#answered-count"),
  totalCount: document.querySelector("#total-count"),
  correctCount: document.querySelector("#correct-count"),
  wrongCount: document.querySelector("#wrong-count"),
  wrongNavCount: document.querySelector("#wrong-nav-count"),
  bookmarkNavCount: document.querySelector("#bookmark-nav-count"),
  randomBanner: document.querySelector("#random-banner"),
  expandAll: document.querySelector("#expand-all"),
  toast: document.querySelector("#toast"),
};

function loadProgress() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return {
      answers: parsed.answers || {},
      notes: parsed.notes || {},
      bookmarks: Array.isArray(parsed.bookmarks) ? parsed.bookmarks : [],
      lastQuestion: parsed.lastQuestion || null,
    };
  } catch {
    return { answers: {}, notes: {}, bookmarks: [], lastQuestion: null };
  }
}

function saveProgress() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toSuperscript(value) {
  const map = {
    0: "⁰",
    1: "¹",
    2: "²",
    3: "³",
    4: "⁴",
    5: "⁵",
    6: "⁶",
    7: "⁷",
    8: "⁸",
    9: "⁹",
  };
  return String(value)
    .split("")
    .map((character) => map[character] || character)
    .join("");
}

function toSubscript(value) {
  const map = {
    0: "₀",
    1: "₁",
    2: "₂",
    3: "₃",
    4: "₄",
    5: "₅",
    6: "₆",
    7: "₇",
    8: "₈",
    9: "₉",
  };
  return String(value)
    .split("")
    .map((character) => map[character] || character)
    .join("");
}

function renderFormula(value) {
  return value
    .replace(/\\pi/g, "π")
    .replace(/\\times/g, "×")
    .replace(/\\approx/g, "≈")
    .replace(/\\log_2/g, "log₂")
    .replace(/\\lg/g, "lg")
    .replace(/\^\\circ/g, "°")
    .replace(/\\circ/g, "°")
    .replace(/\\/g, "")
    .replace(/\^\{?([0-9]+)\}?/g, (_, number) => toSuperscript(number))
    .replace(/_\{?([0-9]+)\}?/g, (_, number) => toSubscript(number))
    .replace(/[{}]/g, "");
}

function renderInline(value = "") {
  let html = escapeHtml(value);
  html = html.replace(/\\\((.*?)\\\)/g, (_, formula) => {
    return `<span class="formula">${renderFormula(formula)}</span>`;
  });
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  return html;
}

function renderRichText(value = "") {
  const blocks = String(value)
    .trim()
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);

  return blocks
    .map((block) => {
      const lines = block.split("\n");
      if (lines.every((line) => /^-\s+/.test(line))) {
        return `<ul>${lines
          .map((line) => `<li>${renderInline(line.replace(/^-\s+/, ""))}</li>`)
          .join("")}</ul>`;
      }
      return `<p>${lines.map(renderInline).join("<br>")}</p>`;
    })
    .join("");
}

function getAnswer(questionId) {
  return progress.answers[questionId];
}

function getBookmarked(questionId) {
  return progress.bookmarks.includes(questionId);
}

function isAnswered(question) {
  const answer = getAnswer(question.id);
  return Boolean(answer && (answer.selected || typeof answer.correct === "boolean"));
}

function isCorrect(question) {
  return getAnswer(question.id)?.correct === true;
}

function isWrong(question) {
  return isAnswered(question) && !isCorrect(question);
}

function getStats() {
  const answered = state.questions.filter(isAnswered);
  const correct = answered.filter(isCorrect).length;
  const wrong = answered.length - correct;
  return { total: state.questions.length, answered: answered.length, correct, wrong };
}

function matchesSearch(question) {
  if (!state.query) return true;
  const haystack = [
    question.title,
    question.knowledge,
    question.explanation,
    question.reference,
    question.answer,
    ...question.options.map((option) => option.text),
  ]
    .join(" ")
    .toLocaleLowerCase("zh-CN");
  return haystack.includes(state.query.toLocaleLowerCase("zh-CN"));
}

function matchesStatus(question) {
  if (state.status === "unanswered") return !isAnswered(question);
  if (state.status === "wrong") return isWrong(question);
  if (state.status === "correct") return isCorrect(question);
  return true;
}

function matchesView(question) {
  if (state.view === "wrong") return isWrong(question);
  if (state.view === "bookmarks") return getBookmarked(question.id);
  return true;
}

function filterQuestions() {
  let questions = state.questions.filter(
    (question) =>
      state.sources.has(question.sourceCode) &&
      state.types.has(question.type) &&
      matchesSearch(question) &&
      matchesView(question) &&
      (state.view === "bank" ? matchesStatus(question) : true),
  );

  if (state.randomIds.length) {
    const order = new Map(state.randomIds.map((id, index) => [id, index]));
    questions = questions
      .filter((question) => order.has(question.id))
      .sort((a, b) => order.get(a.id) - order.get(b.id));
  }

  state.filtered = questions;
  const pageCount = Math.max(1, Math.ceil(questions.length / PAGE_SIZE));
  state.page = Math.min(state.page, pageCount);
}

function renderSourceFilters() {
  const allButton = `
    <button class="filter-chip ${state.sources.size === state.meta.sources.length ? "is-active" : ""}"
      type="button" data-source="all">
      全部 <em>${state.meta.questionCount}</em>
    </button>`;

  const sourceButtons = state.meta.sources
    .map(
      (source) => `
      <button class="filter-chip ${state.sources.has(source.code) ? "is-active" : ""}"
        type="button" data-source="${source.code}">
        ${escapeHtml(source.shortLabel)} <em>${source.questionCount}</em>
      </button>`,
    )
    .join("");

  elements.sourceFilters.innerHTML = allButton + sourceButtons;
}

function renderTypeFilters() {
  const counts = state.meta.typeCounts;
  elements.typeFilters.innerHTML = Object.entries(typeLabels)
    .map(
      ([type, label]) => `
        <button class="filter-chip ${state.types.has(type) ? "is-active" : ""}"
          type="button" data-type="${type}">
          ${label} <em>${counts[type] || 0}</em>
        </button>`,
    )
    .join("");
}

function renderStats() {
  const stats = getStats();
  const percent = stats.total ? Math.round((stats.answered / stats.total) * 100) : 0;
  elements.progressRing.style.background =
    `conic-gradient(var(--green-600) ${percent}%, var(--line) ${percent}%)`;
  elements.progressPercent.textContent = `${percent}%`;
  elements.answeredCount.textContent = stats.answered;
  elements.totalCount.textContent = stats.total;
  elements.correctCount.textContent = stats.correct;
  elements.wrongCount.textContent = stats.wrong;
  elements.wrongNavCount.textContent = stats.wrong;
  elements.bookmarkNavCount.textContent = progress.bookmarks.length;
}

function renderNavigation() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === state.view);
  });
}

function getViewCopy() {
  if (state.view === "wrong") {
    return { title: "错题本", label: "待复习", empty: "还没有待复习的题目" };
  }
  if (state.view === "bookmarks") {
    return { title: "我的收藏", label: "收藏", empty: "还没有收藏题目" };
  }
  if (state.randomIds.length) {
    return { title: "随机练习", label: "随机", empty: "当前条件下没有可抽取的题目" };
  }
  return { title: "全部题目", label: "题库", empty: "这里暂时没有题目" };
}

function renderToolbar() {
  const copy = getViewCopy();
  elements.title.textContent = copy.title;
  elements.viewLabel.textContent = copy.label;
  elements.resultCount.textContent = state.filtered.length;
  elements.randomBanner.hidden = state.randomIds.length === 0;
  elements.expandAll.querySelector("span")?.remove();
  elements.expandAll.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) node.textContent = "";
  });
  elements.expandAll.append(state.expandedAll ? "收起答案" : "展开答案");
}

function getAttemptMarkup(question) {
  const answer = getAnswer(question.id);
  if (!answer) return "";

  if (["short", "analysis", "discussion"].includes(question.type)) {
    if (typeof answer.correct !== "boolean") return "";
    return `
      <div class="feedback ${answer.correct ? "is-correct" : "is-wrong"}">
        <span class="feedback-icon">${answer.correct ? "✓" : "!"}</span>
        <div>
          <strong>${answer.correct ? "已标记为掌握" : "已加入错题本"}</strong>
          <p>${answer.correct ? "继续保持，可随时回来复习。" : "建议对照参考答案梳理要点，再回来重做。"}</p>
        </div>
      </div>`;
  }

  const expectedOption = question.options.find((option) => option.key === question.answer);
  const explanation = question.explanation
    ? renderInline(question.explanation)
    : `正确答案为 ${escapeHtml(question.answer)}${expectedOption ? `：${renderInline(expectedOption.text)}` : ""}。`;
  return `
    <div class="feedback ${answer.correct ? "is-correct" : "is-wrong"}">
      <span class="feedback-icon">${answer.correct ? "✓" : "×"}</span>
      <div>
        <strong>${answer.correct ? `回答正确 · 答案 ${escapeHtml(question.answer)}` : `回答不正确 · 正确答案 ${escapeHtml(question.answer)}`}</strong>
        <p>${explanation}</p>
      </div>
    </div>`;
}

function getReferenceMarkup(question, show) {
  let content = question.reference;
  let label = "查看参考答案";

  if (question.type === "single" || question.type === "judge") {
    content = question.explanation;
    label = "查看答案解析";
  }

  if (!content) return "";

  return `
    <div class="reference-block">
      <button class="reference-toggle" type="button" data-action="toggle-reference"
        aria-expanded="${show ? "true" : "false"}">
        <span>${label}</span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>
      </button>
      <div class="reference-content" ${show ? "" : "hidden"}>
        <p><strong>参考答案：</strong></p>
        ${renderRichText(content)}
      </div>
    </div>`;
}

function renderObjectiveCard(question) {
  const answer = getAnswer(question.id);
  const show = Boolean(answer) || state.expandedAll;
  const options = question.options
    .map((option) => {
      const classes = ["option-button"];
      if (answer?.selected === option.key) classes.push("is-selected");
      if (show && option.key === question.answer) classes.push("is-correct");
      if (show && answer?.selected === option.key && option.key !== question.answer) {
        classes.push("is-wrong");
      }
      return `
        <button class="${classes.join(" ")}" type="button"
          data-action="select-option" data-question-id="${question.id}" data-option="${escapeHtml(option.key)}"
          aria-pressed="${answer?.selected === option.key}">
          <span class="option-key">${escapeHtml(option.key)}</span>
          <span class="option-text">${renderInline(option.text)}</span>
        </button>`;
    })
    .join("");

  return `
    <div class="option-list">${options}</div>
    ${getAttemptMarkup(question)}
    ${getReferenceMarkup(question, show)}`;
}

function renderSubjectiveCard(question) {
  const answer = getAnswer(question.id);
  const show = Boolean(answer) || state.expandedAll;
  const note = progress.notes[question.id] || "";
  return `
    <textarea class="subjective-input" data-action="save-note" data-question-id="${question.id}"
      placeholder="先在这里写下你的答题提纲或关键词，内容会自动保存…">${escapeHtml(note)}</textarea>
    <div class="subjective-tools">
      <span>仅保存在当前浏览器</span>
      <span>${note.length} 字</span>
    </div>
    <div class="subjective-actions">
      <button class="small-action ${answer?.correct === true ? "is-active" : ""}" type="button"
        data-action="self-mark" data-question-id="${question.id}" data-mark="correct">已掌握</button>
      <button class="small-action ${answer?.correct === false ? "is-active" : ""}" type="button"
        data-action="self-mark" data-question-id="${question.id}" data-mark="wrong">加入错题本</button>
    </div>
    ${getAttemptMarkup(question)}
    ${getReferenceMarkup(question, show)}`;
}

function renderQuestionCard(question) {
  const answer = getAnswer(question.id);
  const resultClass = answer
    ? answer.correct
      ? "is-correct"
      : "is-wrong"
    : "";
  const isBookmarked = getBookmarked(question.id);

  return `
    <article class="question-card ${resultClass}" id="question-${question.id}">
      <div class="question-head">
        <div class="question-meta">
          <span class="question-number">Q ${String(question.order).padStart(3, "0")}</span>
          <span class="meta-badge type-${question.type}">${question.typeLabel}</span>
          <span class="meta-badge">${escapeHtml(question.sourceShortLabel)}</span>
          ${question.points ? `<span class="meta-badge">${question.points} 分</span>` : ""}
        </div>
        <button class="bookmark-button ${isBookmarked ? "is-active" : ""}" type="button"
          data-action="bookmark" data-question-id="${question.id}"
          aria-label="${isBookmarked ? "取消收藏" : "收藏题目"}" aria-pressed="${isBookmarked}">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 4.8A1.8 1.8 0 0 1 7.8 3h8.4A1.8 1.8 0 0 1 18 4.8V21l-6-3.6L6 21Z"></path>
          </svg>
        </button>
      </div>
      <h3 class="question-title">${renderInline(question.title)}</h3>
      ${
        question.type === "single" || question.type === "judge"
          ? renderObjectiveCard(question)
          : renderSubjectiveCard(question)
      }
      <div class="question-foot">
        <span class="knowledge-tag">知识点：${renderInline(question.knowledge || "综合复习")}</span>
        <span class="question-source">${escapeHtml(question.course)} · ${escapeHtml(question.sourceLabel)}</span>
      </div>
    </article>`;
}

function paginationItems(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const items = new Set([1, total, current - 1, current, current + 1]);
  if (current <= 3) [2, 3, 4].forEach((page) => items.add(page));
  if (current >= total - 2) [total - 3, total - 2, total - 1].forEach((page) => items.add(page));
  const pages = [...items].filter((page) => page >= 1 && page <= total).sort((a, b) => a - b);
  const result = [];
  pages.forEach((page, index) => {
    if (index > 0 && page - pages[index - 1] > 1) result.push("ellipsis");
    result.push(page);
  });
  return result;
}

function renderPagination() {
  const pageCount = Math.ceil(state.filtered.length / PAGE_SIZE);
  if (pageCount <= 1) {
    elements.pagination.innerHTML = "";
    return;
  }

  const pages = paginationItems(state.page, pageCount)
    .map((page) =>
      page === "ellipsis"
        ? '<span class="page-ellipsis">…</span>'
        : `<button class="page-button ${page === state.page ? "is-active" : ""}" type="button"
            data-page="${page}" ${page === state.page ? 'aria-current="page"' : ""}>${page}</button>`,
    )
    .join("");

  elements.pagination.innerHTML = `
    <button class="page-button" type="button" data-page="${state.page - 1}"
      ${state.page === 1 ? "disabled" : ""} aria-label="上一页">←</button>
    ${pages}
    <button class="page-button" type="button" data-page="${state.page + 1}"
      ${state.page === pageCount ? "disabled" : ""} aria-label="下一页">→</button>`;
}

function renderQuestions() {
  filterQuestions();
  renderToolbar();
  renderStats();
  renderPagination();

  if (!state.filtered.length) {
    elements.list.innerHTML = "";
    elements.empty.hidden = false;
    elements.empty.querySelector("h3").textContent = getViewCopy().empty;
    elements.empty.querySelector("p").textContent =
      state.view === "wrong"
        ? "答错的客观题会自动出现在这里。"
        : state.view === "bookmarks"
          ? "点击题目右上角的书签图标即可收藏。"
          : "换一个筛选条件，或清空搜索关键词再试试。";
    return;
  }

  elements.empty.hidden = true;
  const start = (state.page - 1) * PAGE_SIZE;
  elements.list.innerHTML = state.filtered
    .slice(start, start + PAGE_SIZE)
    .map(renderQuestionCard)
    .join("");
}

function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  toastTimer = setTimeout(() => elements.toast.classList.remove("is-visible"), 2200);
}

function scrollToQuestions() {
  const top =
    document.querySelector(".question-toolbar").getBoundingClientRect().top +
    window.scrollY -
    90;
  window.scrollTo({ top, behavior: "smooth" });
}

function selectOption(questionId, optionKey) {
  const question = state.questions.find((item) => item.id === questionId);
  if (!question) return;
  progress.answers[questionId] = {
    selected: optionKey,
    correct: optionKey === question.answer,
    answeredAt: new Date().toISOString(),
  };
  progress.lastQuestion = questionId;
  saveProgress();
  renderQuestions();
}

function toggleBookmark(questionId) {
  const index = progress.bookmarks.indexOf(questionId);
  if (index >= 0) {
    progress.bookmarks.splice(index, 1);
    showToast("已取消收藏");
  } else {
    progress.bookmarks.push(questionId);
    showToast("已收藏，可在“收藏”中快速找到");
  }
  saveProgress();
  renderQuestions();
}

function markSubjective(questionId, mark) {
  const correct = mark === "correct";
  const existing = getAnswer(questionId);
  if (existing?.correct === correct) {
    delete progress.answers[questionId];
  } else {
    progress.answers[questionId] = {
      selected: "",
      correct,
      answeredAt: new Date().toISOString(),
    };
  }
  progress.lastQuestion = questionId;
  saveProgress();
  renderQuestions();
  showToast(correct ? "已标记为掌握" : "已加入错题本");
}

function setView(view) {
  state.view = view;
  state.randomIds = [];
  state.page = 1;
  renderNavigation();
  renderQuestions();
}

function resetFilters() {
  state.query = "";
  elements.search.value = "";
  state.sources = new Set(state.meta.sources.map((source) => source.code));
  state.types = new Set(Object.keys(typeLabels));
  state.status = "all";
  state.randomIds = [];
  state.page = 1;
  document.querySelectorAll("[data-status]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.status === "all");
  });
  renderSourceFilters();
  renderTypeFilters();
  renderNavigation();
  renderQuestions();
}

function randomSample(count = 10) {
  const pool = state.filtered.length
    ? [...state.filtered]
    : state.questions.filter(
        (question) => state.sources.has(question.sourceCode) && state.types.has(question.type),
      );
  if (!pool.length) {
    showToast("当前筛选条件下没有可抽取的题目");
    return;
  }
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
  }
  state.randomIds = pool.slice(0, count).map((question) => question.id);
  state.page = 1;
  state.view = "bank";
  renderNavigation();
  renderQuestions();
  scrollToQuestions();
  showToast(`随机抽取了 ${state.randomIds.length} 道题`);
}

function continuePractice() {
  state.view = "bank";
  state.randomIds = [];
  state.query = "";
  state.status = "all";
  elements.search.value = "";
  state.sources = new Set(state.meta.sources.map((source) => source.code));
  state.types = new Set(Object.keys(typeLabels));
  renderSourceFilters();
  renderTypeFilters();
  document.querySelectorAll("[data-status]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.status === "all");
  });

  const lastQuestion = state.questions.find(
    (question) => question.id === progress.lastQuestion,
  );
  const target =
    lastQuestion || state.questions.find((question) => !isAnswered(question)) || state.questions[0];
  const position = state.questions.findIndex((question) => question.id === target.id);
  state.page = Math.floor(position / PAGE_SIZE) + 1;
  renderNavigation();
  renderQuestions();
  scrollToQuestions();
}

function handleClick(event) {
  const pageButton = event.target.closest("[data-page]");
  if (pageButton && !pageButton.disabled) {
    state.page = Number(pageButton.dataset.page);
    renderQuestions();
    scrollToQuestions();
    return;
  }

  const sourceChip = event.target.closest("[data-source]");
  if (sourceChip) {
    const source = sourceChip.dataset.source;
    if (source === "all") {
      state.sources = new Set(state.meta.sources.map((item) => item.code));
    } else if (state.sources.has(source)) {
      state.sources.delete(source);
    } else {
      state.sources.add(source);
    }
    if (!state.sources.size) state.sources.add(source === "all" ? "c2" : source);
    state.page = 1;
    renderSourceFilters();
    renderQuestions();
    return;
  }

  const typeChip = event.target.closest("[data-type]");
  if (typeChip) {
    const type = typeChip.dataset.type;
    if (state.types.has(type)) state.types.delete(type);
    else state.types.add(type);
    if (!state.types.size) state.types.add(type);
    state.page = 1;
    renderTypeFilters();
    renderQuestions();
    return;
  }

  const statusChip = event.target.closest("[data-status]");
  if (statusChip) {
    state.status = statusChip.dataset.status;
    state.page = 1;
    document.querySelectorAll("[data-status]").forEach((button) => {
      button.classList.toggle("is-active", button === statusChip);
    });
    if (state.view !== "bank") {
      state.view = "bank";
      renderNavigation();
    }
    renderQuestions();
    return;
  }

  const viewButton = event.target.closest("[data-view]");
  if (viewButton) {
    setView(viewButton.dataset.view);
    return;
  }

  const actionButton = event.target.closest("[data-action]");
  if (actionButton) {
    const questionId = actionButton.dataset.questionId;
    if (actionButton.dataset.action === "select-option") {
      selectOption(questionId, actionButton.dataset.option);
    } else if (actionButton.dataset.action === "bookmark") {
      toggleBookmark(questionId);
    } else if (actionButton.dataset.action === "self-mark") {
      markSubjective(questionId, actionButton.dataset.mark);
    } else if (actionButton.dataset.action === "toggle-reference") {
      const content = actionButton.nextElementSibling;
      const isOpen = actionButton.getAttribute("aria-expanded") === "true";
      actionButton.setAttribute("aria-expanded", String(!isOpen));
      content.hidden = isOpen;
    }
  }
}

function handleInput(event) {
  if (event.target === elements.search) {
    state.query = event.target.value.trim();
    state.page = 1;
    renderQuestions();
    return;
  }

  if (event.target.matches('[data-action="save-note"]')) {
    const questionId = event.target.dataset.questionId;
    progress.notes[questionId] = event.target.value;
    progress.lastQuestion = questionId;
    saveProgress();
    const counter = event.target.nextElementSibling?.querySelector("span:last-child");
    if (counter) counter.textContent = `${event.target.value.length} 字`;
  }
}

function bindEvents() {
  document.addEventListener("click", handleClick);
  document.addEventListener("input", handleInput);

  document.querySelector("#start-practice").addEventListener("click", continuePractice);
  document.querySelector("#random-practice").addEventListener("click", () => randomSample(10));
  document.querySelector("#random-filtered").addEventListener("click", () => randomSample(10));
  document.querySelector("#reset-filters").addEventListener("click", resetFilters);
  document.querySelector("#clear-empty-filters").addEventListener("click", resetFilters);
  document.querySelector("#exit-random").addEventListener("click", () => {
    state.randomIds = [];
    state.page = 1;
    renderQuestions();
  });
  elements.expandAll.addEventListener("click", () => {
    state.expandedAll = !state.expandedAll;
    renderQuestions();
  });

  document.querySelector("#theme-button").addEventListener("click", () => {
    const dark = document.documentElement.classList.toggle("dark");
    localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
    document
      .querySelector('meta[name="theme-color"]')
      .setAttribute("content", dark ? "#101916" : "#0c3b32");
  });

  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      elements.search.focus();
    }
    if (event.key === "Escape" && document.activeElement === elements.search) {
      elements.search.value = "";
      state.query = "";
      elements.search.blur();
      renderQuestions();
    }
  });
}

function initializeTheme() {
  const savedTheme = localStorage.getItem(THEME_KEY);
  const preferredDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  if (savedTheme === "dark" || (!savedTheme && preferredDark)) {
    document.documentElement.classList.add("dark");
    document
      .querySelector('meta[name="theme-color"]')
      .setAttribute("content", "#101916");
  }
}

async function initialize() {
  initializeTheme();
  bindEvents();

  elements.list.innerHTML = `
    <div class="empty-state">
      <h3>正在载入题库…</h3>
      <p>正在整理综合题库。</p>
    </div>`;

  try {
    const response = await fetch("./data/questions.json");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    state.questions = payload.questions;
    state.meta = payload.meta;
    state.sources = new Set(payload.meta.sources.map((source) => source.code));

    document.querySelector("#stat-total").textContent = payload.meta.questionCount;
    document.querySelector("#stat-types").textContent = Object.keys(
      payload.meta.typeCounts,
    ).length;

    renderSourceFilters();
    renderTypeFilters();
    renderNavigation();
    renderQuestions();
  } catch (error) {
    elements.list.innerHTML = `
      <div class="empty-state">
        <h3>题库载入失败</h3>
        <p>请刷新页面重试。若仍无法载入，请确认 data/questions.json 文件存在。</p>
      </div>`;
    console.error("题库载入失败", error);
  }
}

initialize();
