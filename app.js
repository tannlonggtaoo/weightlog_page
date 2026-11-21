import { repository, checkConnection, listRecords, changeRecord, uploadPhoto, readPhoto } from "./github.js";
import { showTrend } from "./chart.js";
import { compressPhoto, createPhotoGallery } from "./photos.js";

const byId = id => document.getElementById(id);
const tokenKey = "weightlog:" + repository + ":pat";
const dayFormat = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric", month: "long", day: "numeric", weekday: "long"
});
let token = localStorage.getItem(tokenKey) || "";
let currentView = "auth";
let returnView = "entry";
let kind = "weight";
let editing = null;
let editReturn = "entry";
let pending = null;
let draftPhoto = null;
let lastSaved = null;
let records = [];
let overviewRequest = 0;
const gallery = createPhotoGallery(sha => readPhoto(token, sha));

function stamp(date) {
  const offset = -date.getTimezoneOffset();
  const wallTime = new Date(date.getTime() + offset * 60000).toISOString().slice(0, 19);
  const pad = number => String(number).padStart(2, "0");
  return wallTime + (offset < 0 ? "-" : "+") + pad(Math.floor(Math.abs(offset) / 60)) + ":" + pad(Math.abs(offset) % 60);
}

function displayTime(record) {
  return record.at.slice(0, 16).replace("T", " ");
}

function recordValue(record) {
  return record.type === "weight" ? record.kg + " kg" : record.text || "饮食照片";
}

function show(view) {
  if (currentView === "overview" && view !== "overview") gallery.clear(byId("history"));
  currentView = view;
  for (const id of ["auth", "entry", "overview"]) byId(id).hidden = id !== view;
  byId("settings").hidden = byId("navigation").hidden = view === "auth";
  byId("account-actions").hidden = !token;
  for (const button of byId("navigation").querySelectorAll("button")) {
    if (button.dataset.view === view) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  if (view === "entry") {
    const date = editing ? new Date(editing.at.slice(0, 10) + "T12:00:00") : new Date();
    byId("entry-date").textContent = dayFormat.format(date);
  }
  if (view === "overview") loadOverview();
  window.scrollTo(0, 0);
}

function feedback(output, text, error = false) {
  output.classList.toggle("error", error);
  output.textContent = text;
}

function report(error, output) {
  if (error.status === 401 && currentView !== "auth") {
    returnView = currentView;
    token = "";
    localStorage.removeItem(tokenKey);
    show("auth");
    output = byId("auth-message");
  }
  const message = error instanceof TypeError ? "连接 GitHub 失败，请检查网络后再试。" : error.message;
  feedback(output, message, true);
}

async function perform(output, progress, action) {
  const main = document.querySelector("main");
  const header = document.querySelector("header");
  if (main.inert) return;
  main.inert = header.inert = true;
  feedback(output, progress);
  try {
    await action();
    if (output.textContent === progress) output.textContent = "";
  } catch (error) {
    if (output.textContent === progress) output.textContent = "";
    report(error, output);
  } finally {
    main.inert = header.inert = false;
  }
}

byId("repo-name").textContent = repository;
byId("auth-form").addEventListener("submit", event => {
  event.preventDefault();
  const input = byId("token-input");
  const candidate = input.value.trim();
  if (!candidate) return feedback(byId("auth-message"), "请填写令牌。", true);
  perform(byId("auth-message"), "正在验证连接…", async () => {
    await checkConnection(candidate);
    localStorage.setItem(tokenKey, candidate);
    token = candidate;
    input.value = "";
    show(returnView);
  });
});

byId("settings").onclick = () => {
  returnView = currentView;
  byId("token-input").value = "";
  byId("auth-message").textContent = "";
  show("auth");
};
byId("auth-back").onclick = () => {
  byId("token-input").value = "";
  show(returnView);
};
byId("forget").onclick = () => {
  localStorage.removeItem(tokenKey);
  token = "";
  returnView = "entry";
  byId("token-input").value = "";
  clearEntry();
  records = [];
  gallery.clear(byId("history"));
  byId("overview-content").hidden = true;
  show("auth");
  feedback(byId("auth-message"), "已清除此设备的令牌。");
};
byId("navigation").onclick = event => {
  const view = event.target.closest("button")?.dataset.view;
  if (!view || view === currentView) return;
  if (editing) clearEntry();
  show(view);
};

function setKind(value) {
  kind = value;
  pending = null;
  const weight = value === "weight";
  byId("weight-field").hidden = byId("weight-input").disabled = !weight;
  byId("food-field").hidden = byId("food-input").disabled = weight;
  for (const button of document.querySelectorAll("[data-kind]")) {
    button.setAttribute("aria-pressed", String(button.dataset.kind === kind));
  }
}

function setTime(value = "") {
  const input = byId("time-input");
  input.value = value;
  input.hidden = input.disabled = !value;
  byId("auto-time").hidden = Boolean(value);
  byId("toggle-time").textContent = value ? "使用当前时间" : "修改时间";
  byId("toggle-time").setAttribute("aria-expanded", String(Boolean(value)));
  pending = null;
}

function setDraftPhoto(photo) {
  draftPhoto = photo;
  pending = null;
  const preview = byId("photo-preview");
  gallery.clear(preview);
  if (photo) preview.append(gallery.thumbnail(photo));
  byId("remove-photo").hidden = !photo;
  byId("entry-error").textContent = "";
}

function clearEntry() {
  editing = pending = lastSaved = null;
  byId("entry-form").reset();
  setTime();
  setKind(kind);
  setDraftPhoto(null);
  byId("entry-title").textContent = "记一笔";
  byId("entry-date").textContent = dayFormat.format(new Date());
  byId("save").textContent = "保存记录";
  byId("entry-error").textContent = "";
  byId("cancel-edit").hidden = byId("receipt").hidden = true;
}

function edit(record) {
  editReturn = currentView;
  clearEntry();
  editing = record;
  setKind(record.type);
  byId("weight-input").value = record.kg ?? "";
  byId("food-input").value = record.text ?? "";
  if (record.photoSha) setDraftPhoto({ sha: record.photoSha });
  setTime(record.at.slice(0, 16));
  byId("entry-title").textContent = "修改记录";
  byId("save").textContent = "保存修改";
  byId("cancel-edit").hidden = false;
  show("entry");
}

for (const button of document.querySelectorAll("[data-kind]")) {
  button.onclick = () => setKind(button.dataset.kind);
}
for (const button of document.querySelectorAll("[data-pick]")) {
  const input = byId(button.dataset.pick);
  button.onclick = () => input.click();
  input.onchange = () => {
    const file = input.files[0];
    input.value = "";
    if (!file) return;
    perform(byId("entry-error"), "正在压缩照片…", async () => {
      setDraftPhoto({ preview: await compressPhoto(file) });
    });
  };
}
byId("remove-photo").onclick = () => setDraftPhoto(null);
byId("toggle-time").onclick = () => {
  const input = byId("time-input");
  setTime(input.hidden ? stamp(new Date()).slice(0, 16) : "");
  if (!input.hidden) input.focus();
};
byId("edit-last").onclick = () => edit(lastSaved);
byId("cancel-edit").onclick = () => {
  clearEntry();
  show(editReturn);
};
byId("entry-form").addEventListener("input", () => {
  pending = null;
  byId("entry-error").textContent = "";
});

function entryTime() {
  const input = byId("time-input");
  if (input.disabled) return stamp(new Date());
  if (editing && input.value === editing.at.slice(0, 16)) return editing.at;
  return stamp(new Date(input.value));
}

byId("entry-form").addEventListener("submit", event => {
  event.preventDefault();
  const output = byId("entry-error");
  const kg = byId("weight-input").valueAsNumber;
  const text = byId("food-input").value.trim();
  if (kind === "weight" && !(kg > 0)) return feedback(output, "请输入大于零的体重。", true);
  if (kind === "food" && !text && !draftPhoto) return feedback(output, "请写下饮食内容或选一张照片。", true);
  pending ??= {
    id: editing?.id || crypto.randomUUID(), type: kind, at: entryTime(),
    ...(kind === "weight" ? { kg } : { text })
  };
  const record = pending;
  perform(output, "正在保存…", async () => {
    if (record.type === "food" && draftPhoto) {
      draftPhoto.sha ??= await uploadPhoto(token, draftPhoto.preview);
      record.photoSha = draftPhoto.sha;
    }
    await changeRecord(token, editing, record);
    const backToOverview = editing && editReturn === "overview";
    clearEntry();
    if (backToOverview) {
      show("overview");
    } else {
      lastSaved = record;
      byId("receipt-text").textContent = "已保存 " + recordValue(record) + " · " + displayTime(record);
      byId("receipt").hidden = false;
    }
  });
});

function renderOverview() {
  const latest = records.find(record => record.type === "weight");
  byId("latest-kg").textContent = latest?.kg ?? "—";
  document.querySelector(".reading span").hidden = !latest;
  byId("latest-at").textContent = latest ? displayTime(latest) : "还没有体重记录";
  byId("entry-count").textContent = records.length + " 条";
  const history = byId("history");
  gallery.clear(history);
  const days = new Map();
  for (const record of records) {
    const day = record.at.slice(0, 10);
    if (!days.has(day)) {
      const title = document.createElement("h3");
      title.className = "day-title";
      title.textContent = dayFormat.format(new Date(day + "T12:00:00"));
      const list = document.createElement("ul");
      list.className = "card day-list";
      history.append(title, list);
      days.set(day, list);
    }
    const row = byId("record-row").content.firstElementChild.cloneNode(true);
    row.dataset.id = record.id;
    const time = row.querySelector("time");
    time.dateTime = record.at;
    time.textContent = record.at.slice(11, 16);
    row.querySelector(".kind-label").textContent = record.type === "weight" ? "体重" : "饮食";
    const value = row.querySelector(".row-value");
    value.textContent = recordValue(record);
    if (record.type === "food" && record.photoSha) {
      value.hidden = !record.text;
      row.querySelector(".row-content").append(gallery.thumbnail({ sha: record.photoSha }));
    }
    days.get(day).append(row);
  }
  if (!records.length) history.textContent = "还没有记录。点「记一笔」开始。";
  byId("overview-content").hidden = false;
  showTrend(records);
}

async function loadOverview() {
  const request = ++overviewRequest;
  const output = byId("overview-message");
  byId("overview-content").hidden = byId("retry").hidden = true;
  feedback(output, "正在读取记录…");
  try {
    const result = await listRecords(token);
    if (request !== overviewRequest || currentView !== "overview") return;
    records = result;
    feedback(output, "");
    renderOverview();
  } catch (error) {
    if (request !== overviewRequest || currentView !== "overview") return;
    byId("retry").hidden = false;
    report(error, output);
  }
}

byId("retry").onclick = loadOverview;
byId("history").onclick = event => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const record = records.find(item => item.id === button.closest("li").dataset.id);
  if (button.dataset.action === "edit") return edit(record);
  if (!window.confirm("删除这条记录？\n" + displayTime(record) + " · " + recordValue(record))) return;
  const output = byId("overview-message");
  perform(output, "正在删除…", async () => {
    await changeRecord(token, record, null);
    records = records.filter(item => item.id !== record.id);
    if (lastSaved?.id === record.id) {
      lastSaved = null;
      byId("receipt").hidden = true;
    }
    renderOverview();
    feedback(output, "记录已删除。");
  });
};

show(token ? "entry" : "auth");
