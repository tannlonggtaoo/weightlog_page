import { repository, checkConnection, listRecords, listDayRecords, changeRecord, uploadPhoto, readPhoto } from "./github.js?v=4";
import { showTrend } from "./chart.js";
import { defaultBirthYear, defaultHeight, isValidKcal, summarizeDays } from "./energy.js";
import { compressPhoto, createPhotoGallery } from "./photos.js";
import { checkOpenRouterKey, estimateCalories } from "./openrouter.js?v=5";

const byId = id => document.getElementById(id);
const kindLabels = { weight: "体重", food: "饮食", exercise: "运动" };
const calorieLabels = { food: "摄入", exercise: "消耗" };
const storagePrefix = "weightlog:" + repository + ":";
const tokenKey = storagePrefix + "pat";
const openRouterStorageKey = storagePrefix + "openrouter";
const birthYearKey = storagePrefix + "birth-year";
const heightKey = storagePrefix + "height-cm";
const sexKey = storagePrefix + "sex";
const calorieInput = byId("calorie-input");
const estimateButton = byId("estimate-calories");
const estimateMessage = byId("estimate-message");
const dayFormat = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric", month: "long", day: "numeric", weekday: "long"
});
const kcalFormat = new Intl.NumberFormat("zh-CN");
let token = localStorage.getItem(tokenKey) || "";
let openRouterKey = localStorage.getItem(openRouterStorageKey) || "";
let currentView = "auth";
let returnView = "entry";
let kind = "weight";
let editing = null;
let editReturn = "entry";
let pending = null;
let draftPhoto = null;
let calorieDrafts = {};
let estimateController = null;
let lastSaved = null;
let records = [];
let overviewRequest = 0;
let todayController = null;
let todayDay = "";
let midnightTimer;
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
  if (record.type === "weight") return record.kg + " kg";
  if (record.type === "food" && !record.text) return "饮食照片";
  return record.text;
}

function calorieSummary(record) {
  const label = calorieLabels[record.type];
  return label && isValidKcal(record.kcal) ? label + " " + record.kcal + " kcal" : "";
}

function show(view) {
  if (currentView === "overview" && view !== "overview") gallery.clear(byId("history"));
  if (currentView === "entry" && view !== "entry") {
    cancelEstimate();
    stopTodayEnergy();
  }
  currentView = view;
  for (const id of ["auth", "entry", "overview"]) byId(id).hidden = id !== view;
  byId("settings").hidden = byId("navigation").hidden = view === "auth";
  if (view === "auth") loadSettings();
  for (const button of byId("navigation").querySelectorAll("button")) {
    if (button.dataset.view === view) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  if (view === "entry") {
    if (editing) {
      stopTodayEnergy();
      byId("today-energy").hidden = true;
      byId("entry-date").textContent = dayFormat.format(new Date(editing.at.slice(0, 10) + "T12:00:00"));
    } else {
      loadTodayEnergy();
    }
  }
  if (view === "overview") loadOverview();
  window.scrollTo(0, 0);
}

function feedback(output, text, error = false) {
  output.classList.toggle("error", error);
  output.textContent = text;
}

function energyProfile() {
  return {
    birthYear: Number(localStorage.getItem(birthYearKey)),
    height: Number(localStorage.getItem(heightKey)),
    sex: localStorage.getItem(sexKey)
  };
}

function renderEnergyBalance(output, balance) {
  if (balance === 0) {
    output.dataset.balance = "even";
    output.textContent = "估算持平";
  } else {
    output.dataset.balance = balance > 0 ? "deficit" : "surplus";
    const label = balance > 0 ? "估算缺口" : "估算盈余";
    output.textContent = label + " " + kcalFormat.format(Math.abs(balance)) + " kcal";
  }
}

function createEnergyHelp(missingCount) {
  const help = byId("energy-help-template").content.firstElementChild.cloneNode(true);
  help.querySelector("p").textContent = missingCount + " 条记录未填热量，暂按 0 kcal 计算";
  return help;
}

function renderTodayEnergy(energy) {
  const result = byId("today-energy-result");
  const balance = byId("today-energy-balance");
  const meter = byId("today-energy-meter");
  result.querySelector(".energy-help")?.remove();
  if (energy.missingCount) result.append(createEnergyHelp(energy.missingCount));

  byId("today-energy-intake").textContent = kcalFormat.format(energy.intake);
  byId("today-energy-expenditure").textContent = kcalFormat.format(energy.expenditure);
  byId("today-energy-fill").style.width = energy.fraction * 100 + "%";
  meter.toggleAttribute("data-incomplete", energy.missingCount > 0);
  byId("today-energy-loading").hidden = true;
  byId("today-energy-content").hidden = result.hidden = false;
  renderEnergyBalance(balance, energy.balance);
  meter.dataset.balance = balance.dataset.balance;
}

function stopTodayEnergy() {
  todayController?.abort();
  todayController = null;
  clearTimeout(midnightTimer);
}

async function loadTodayEnergy() {
  stopTodayEnergy();
  const now = new Date();
  const day = stamp(now).slice(0, 10);
  todayDay = day;
  const tomorrow = new Date(now);
  tomorrow.setHours(24, 0, 0, 0);
  midnightTimer = setTimeout(loadTodayEnergy, tomorrow - now);

  const controller = new AbortController();
  todayController = controller;
  const output = byId("today-energy-message");
  const retry = byId("today-energy-retry");
  byId("entry-date").textContent = dayFormat.format(now);
  byId("today-energy").hidden = byId("today-energy-loading").hidden = false;
  byId("today-energy-content").hidden = byId("today-energy-result").hidden = retry.hidden = true;
  feedback(output, "正在读取今日热量…");
  try {
    const result = await listDayRecords(token, day, controller.signal);
    if (todayController !== controller) return;
    if (stamp(new Date()).slice(0, 10) !== day) {
      loadTodayEnergy();
      return;
    }
    const today = summarizeDays(result, energyProfile(), day).find(group => group.day === day);
    renderTodayEnergy(today.energy);
  } catch (error) {
    if (todayController !== controller) return;
    feedback(output, error.status === 401 ? error.message : "读取今日热量失败。", true);
    retry.hidden = false;
  } finally {
    if (todayController === controller) todayController = null;
  }
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

async function perform(output, progress, action, handleError = report) {
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
    handleError(error, output);
  } finally {
    main.inert = header.inert = false;
  }
}

function updateCredentialControls() {
  byId("auth-back").hidden = byId("forget").hidden = !token;
  byId("forget-openrouter").hidden = !openRouterKey;
  byId("token-input").placeholder = token ? "已保存，输入新令牌更换" : "粘贴 GitHub PAT";
  byId("openrouter-key-input").placeholder = openRouterKey ? "已保存，输入新 Key 更换" : "粘贴 OpenRouter API Key";
}

function loadSettings() {
  for (const id of ["token-input", "openrouter-key-input"]) byId(id).value = "";
  for (const id of ["auth-message", "openrouter-message", "profile-message"]) feedback(byId(id), "");
  byId("birth-year-input").max = new Date().getFullYear();
  byId("birth-year-input").placeholder = "默认 " + defaultBirthYear;
  byId("height-input").placeholder = "默认 " + defaultHeight;
  byId("birth-year-input").value = localStorage.getItem(birthYearKey) ?? "";
  byId("height-input").value = localStorage.getItem(heightKey) ?? "";
  byId("sex-input").value = localStorage.getItem(sexKey) ?? "";
  updateCredentialControls();
}

byId("repo-name").textContent = repository;
byId("auth-form").addEventListener("submit", event => {
  event.preventDefault();
  const input = byId("token-input");
  const output = byId("auth-message");
  const candidate = input.value.trim();
  if (!candidate) return feedback(output, "请填写令牌。", true);
  perform(output, "正在验证连接…", async () => {
    await checkConnection(candidate);
    const connecting = !token;
    localStorage.setItem(tokenKey, candidate);
    token = candidate;
    input.value = "";
    if (connecting) {
      show(returnView);
    } else {
      updateCredentialControls();
      feedback(output, "已保存 GitHub 令牌。");
    }
  });
});

byId("settings").onclick = () => {
  returnView = currentView;
  show("auth");
};
byId("auth-back").onclick = () => {
  byId("token-input").value = byId("openrouter-key-input").value = "";
  show(returnView);
};
byId("forget").onclick = () => {
  localStorage.removeItem(tokenKey);
  token = "";
  returnView = "entry";
  clearEntry();
  records = [];
  gallery.clear(byId("history"));
  byId("overview-content").hidden = true;
  show("auth");
  feedback(byId("auth-message"), "已清除此设备的令牌。");
};
byId("openrouter-form").addEventListener("submit", event => {
  event.preventDefault();
  const input = byId("openrouter-key-input");
  const output = byId("openrouter-message");
  const candidate = input.value.trim();
  if (!candidate) return feedback(output, "请填写 OpenRouter API Key。", true);
  perform(output, "正在验证 OpenRouter Key…", async () => {
    await checkOpenRouterKey(candidate);
    localStorage.setItem(openRouterStorageKey, candidate);
    openRouterKey = candidate;
    input.value = "";
    updateCredentialControls();
    feedback(output, "已保存 OpenRouter Key。");
  }, (error, message) => feedback(message, error.message, true));
});
byId("forget-openrouter").onclick = () => {
  localStorage.removeItem(openRouterStorageKey);
  openRouterKey = byId("openrouter-key-input").value = "";
  updateCredentialControls();
  feedback(byId("openrouter-message"), "已清除 OpenRouter Key。");
};
byId("profile-form").addEventListener("submit", event => {
  event.preventDefault();
  const height = byId("height-input");
  const output = byId("profile-message");
  if (height.value && !(height.valueAsNumber > 0)) {
    return feedback(output, "请输入大于零的身高。", true);
  }
  for (const [key, input] of [[birthYearKey, byId("birth-year-input")], [heightKey, height]]) {
    if (input.value) localStorage.setItem(key, String(input.valueAsNumber));
    else localStorage.removeItem(key);
  }
  const sex = byId("sex-input").value;
  if (sex) localStorage.setItem(sexKey, sex);
  else localStorage.removeItem(sexKey);
  feedback(output, "已保存个人资料。");
});
byId("navigation").onclick = event => {
  const view = event.target.closest("button")?.dataset.view;
  if (!view || view === currentView) return;
  if (editing) clearEntry();
  show(view);
};

function setKind(value) {
  if (kind !== value) {
    if (calorieLabels[kind]) calorieDrafts[kind] = calorieInput.value;
    kind = value;
    calorieInput.value = calorieDrafts[kind] ?? "";
    cancelEstimate();
  }
  pending = null;
  byId("entry-error").textContent = "";
  for (const button of document.querySelectorAll("[data-kind]")) {
    const buttonKind = button.dataset.kind;
    const selected = buttonKind === kind;
    button.setAttribute("aria-pressed", String(selected));
    byId(buttonKind + "-field").hidden = byId(buttonKind + "-input").disabled = !selected;
  }
  const calorieLabel = calorieLabels[kind];
  byId("calorie-field").hidden = calorieInput.disabled = !calorieLabel;
  if (calorieLabel) byId("calorie-label").textContent = "热量" + calorieLabel + "（选填）";
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
  cancelEstimate();
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
  calorieDrafts = {};
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
  byId(record.type + "-input").value = record.type === "weight" ? record.kg : record.text ?? "";
  calorieInput.value = record.kcal ?? "";
  if (record.type === "food" && record.photoSha) setDraftPhoto({ sha: record.photoSha });
  setTime(record.at.slice(0, 16));
  byId("entry-title").textContent = "修改记录";
  byId("save").textContent = "保存修改";
  byId("cancel-edit").hidden = false;
  show("entry");
}

function cancelEstimate() {
  estimateController?.abort();
  estimateController = null;
  estimateButton.disabled = false;
  feedback(estimateMessage, "");
}

estimateButton.onclick = async () => {
  if (estimateController || !calorieLabels[kind]) return;
  const entryKind = kind;
  const description = byId(entryKind + "-input").value;
  const photo = entryKind === "food" ? draftPhoto : null;
  if (!description.trim() && !photo) {
    const message = entryKind === "food" ? "请写下饮食内容或选一张照片。" : "请写下运动内容。";
    return feedback(estimateMessage, message, true);
  }
  const key = openRouterKey;
  if (!key) return feedback(estimateMessage, "请先在设置中保存 OpenRouter API Key。", true);

  const controller = new AbortController();
  const { signal } = controller;
  estimateController = controller;
  estimateButton.disabled = true;
  feedback(estimateMessage, "正在估算…");
  const timeout = setTimeout(() => {
    if (estimateController !== controller) return;
    cancelEstimate();
    feedback(estimateMessage, "估算超时，可以手填或直接保存。", true);
  }, 25_000);

  try {
    let image = photo?.preview;
    if (photo?.sha && !image) {
      image = await readPhoto(token, photo.sha, signal).catch(() => {
        throw new Error("读取 GitHub 照片失败，请检查连接后重试。");
      });
    }
    if (estimateController !== controller) return;
    const kcal = await estimateCalories(key, { kind: entryKind, text: description, photo: image }, signal);
    if (estimateController !== controller) return;
    calorieInput.value = kcal;
    pending = null;
    feedback(estimateMessage, "已填入热量。");
  } catch (error) {
    if (estimateController === controller) feedback(estimateMessage, error.message, true);
  } finally {
    clearTimeout(timeout);
    if (estimateController === controller) {
      estimateController = null;
      estimateButton.disabled = false;
    }
  }
};

for (const button of document.querySelectorAll("[data-kind]")) {
  button.onclick = () => setKind(button.dataset.kind);
}
for (const input of [byId("camera-input"), byId("album-input")]) {
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    cancelEstimate();
    await perform(byId("entry-error"), "正在压缩照片…", async () => {
      setDraftPhoto({ preview: await compressPhoto(file) });
    });
    input.value = "";
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
  cancelEstimate();
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
  const input = byId(kind + "-input");
  const value = kind === "weight" ? { kg: input.valueAsNumber } : { text: input.value.trim() };
  if (kind === "weight" && !(value.kg > 0)) return feedback(output, "请输入大于零的体重。", true);
  if (kind === "food" && !value.text && !draftPhoto) return feedback(output, "请写下饮食内容或选一张照片。", true);
  if (kind === "exercise" && !value.text) return feedback(output, "请写下运动内容。", true);
  if (kind !== "weight" && calorieInput.value !== "") {
    const kcal = calorieInput.valueAsNumber;
    if (!isValidKcal(kcal)) return feedback(output, "请输入非负的热量数值。", true);
    value.kcal = kcal;
  }
  cancelEstimate();
  pending ??= {
    id: editing?.id || crypto.randomUUID(), type: kind, at: entryTime(), ...value
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
      const details = [recordValue(record), calorieSummary(record), displayTime(record)];
      byId("receipt-text").textContent = "已保存 " + details.filter(Boolean).join(" · ");
      byId("receipt").hidden = false;
      loadTodayEnergy();
    }
  });
});

function createDayHeading(day, energy) {
  const heading = document.createElement("div");
  heading.className = "day-heading";
  const title = document.createElement("h3");
  title.className = "day-title";
  title.textContent = dayFormat.format(new Date(day + "T12:00:00"));
  heading.append(title);
  if (energy.missingCount) {
    heading.append(createEnergyHelp(energy.missingCount));
  } else if (energy.entryCount) {
    const balance = document.createElement("span");
    balance.className = "energy-balance";
    renderEnergyBalance(balance, energy.balance);
    heading.append(balance);
  }
  return heading;
}

function createRecordRow(record) {
  const row = byId("record-row").content.firstElementChild.cloneNode(true);
  row.dataset.id = record.id;
  const time = row.querySelector("time");
  time.dateTime = record.at;
  time.textContent = record.at.slice(11, 16);
  row.querySelector(".kind-label").textContent = kindLabels[record.type];
  const value = row.querySelector(".row-value");
  value.textContent = recordValue(record);
  const calories = row.querySelector(".row-calories");
  calories.textContent = calorieSummary(record);
  calories.hidden = !calories.textContent;
  if (record.type === "food" && record.photoSha) {
    value.hidden = !record.text;
    row.querySelector(".row-content").append(gallery.thumbnail({ sha: record.photoSha }));
  }
  return row;
}

function renderOverview() {
  const latest = records.find(record => record.type === "weight");
  byId("latest-kg").textContent = latest?.kg ?? "—";
  document.querySelector(".reading span").hidden = !latest;
  byId("latest-at").textContent = latest ? displayTime(latest) : "还没有体重记录";
  byId("entry-count").textContent = records.length + " 条";
  const history = byId("history");
  gallery.clear(history);
  for (const { day, records: dayRecords, energy } of summarizeDays(records, energyProfile()).reverse()) {
    const list = document.createElement("ul");
    list.className = "card day-list";
    for (const record of dayRecords) list.append(createRecordRow(record));
    history.append(createDayHeading(day, energy), list);
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
byId("today-energy-retry").onclick = loadTodayEnergy;
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && currentView === "entry" && !editing && stamp(new Date()).slice(0, 10) !== todayDay) {
    loadTodayEnergy();
  }
});
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
