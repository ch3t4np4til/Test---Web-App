const STORAGE_KEY = "maintenance-task-tracker.tasks";
const PRIORITIES = new Set(["Low", "Medium", "High", "Urgent"]);

const taskForm = document.querySelector("#taskForm");
const taskNameInput = document.querySelector("#taskName");
const assigneeInput = document.querySelector("#assignee");
const priorityInput = document.querySelector("#priority");
const taskList = document.querySelector("#taskList");
const emptyState = document.querySelector("#emptyState");
const filterButtons = document.querySelectorAll(".filter-button");
const openCount = document.querySelector("#openCount");
const doneCount = document.querySelector("#doneCount");

let tasks = loadTasks();
let activeFilter = "all";

taskForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const title = taskNameInput.value.trim();
  const assignee = assigneeInput.value.trim();

  if (!title || !assignee) {
    return;
  }

  tasks.unshift({
    id: createId(),
    title,
    assignee,
    priority: priorityInput.value,
    complete: false,
    createdAt: new Date().toISOString(),
  });

  saveTasks();
  taskForm.reset();
  priorityInput.value = "Medium";
  taskNameInput.focus();
  render();
});

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;

    filterButtons.forEach((item) => {
      const selected = item === button;
      item.classList.toggle("is-active", selected);
      item.setAttribute("aria-selected", String(selected));
    });

    render();
  });
});

taskList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");

  if (!button) {
    return;
  }

  const id = button.closest(".task-row").dataset.id;
  const action = button.dataset.action;

  if (action === "toggle") {
    tasks = tasks.map((task) =>
      task.id === id ? { ...task, complete: !task.complete } : task,
    );
  }

  if (action === "delete") {
    tasks = tasks.filter((task) => task.id !== id);
  }

  saveTasks();
  render();
});

function loadTasks() {
  try {
    const storedTasks = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(storedTasks)
      ? storedTasks.map(normalizeTask).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function saveTasks() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

function render() {
  const visibleTasks = tasks.filter((task) => {
    if (activeFilter === "open") {
      return !task.complete;
    }

    if (activeFilter === "complete") {
      return task.complete;
    }

    return true;
  });

  taskList.innerHTML = visibleTasks.map(createTaskRow).join("");
  emptyState.hidden = visibleTasks.length > 0;

  openCount.textContent = tasks.filter((task) => !task.complete).length;
  doneCount.textContent = tasks.filter((task) => task.complete).length;
}

function createTaskRow(task) {
  const status = task.complete ? "Complete" : "Open";
  const priority = PRIORITIES.has(task.priority) ? task.priority : "Medium";
  const priorityClass = `priority-${priority.toLowerCase()}`;
  const toggleLabel = task.complete ? "Reopen task" : "Mark complete";
  const toggleIcon = task.complete ? "icon-undo" : "icon-check";

  return `
    <article class="task-row ${task.complete ? "is-complete" : ""}" data-id="${escapeAttribute(task.id)}">
      <div class="task-main">
        <p class="task-title">${escapeHtml(task.title)}</p>
        <span class="task-meta">Assigned to ${escapeHtml(task.assignee)}</span>
      </div>
      <span class="priority-pill ${priorityClass}">${escapeHtml(priority)}</span>
      <span class="status-pill ${task.complete ? "is-complete" : ""}">${status}</span>
      <span class="task-meta">${formatDate(task.createdAt)}</span>
      <div class="row-actions">
        <button class="icon-button complete-button" type="button" data-action="toggle" aria-label="${toggleLabel}">
          <svg aria-hidden="true"><use href="#${toggleIcon}"></use></svg>
        </button>
        <button class="icon-button delete-button" type="button" data-action="delete" aria-label="Delete task">
          <svg aria-hidden="true"><use href="#icon-trash"></use></svg>
        </button>
      </div>
    </article>
  `;
}

function formatDate(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Today";
  }

  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "short",
  }).format(date);
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[character],
  );
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function createId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function normalizeTask(task) {
  if (!task || typeof task !== "object") {
    return null;
  }

  const title = String(task.title ?? "").trim();
  const assignee = String(task.assignee ?? "").trim();

  if (!title || !assignee) {
    return null;
  }

  return {
    id: String(task.id ?? createId()),
    title,
    assignee,
    priority: PRIORITIES.has(task.priority) ? task.priority : "Medium",
    complete: Boolean(task.complete),
    createdAt: task.createdAt ?? new Date().toISOString(),
  };
}

render();
