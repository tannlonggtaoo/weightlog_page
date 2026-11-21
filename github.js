export const repository = "tannlonggtaoo/weightlog";
const baseUrl = "https://api.github.com/repos/" + repository;

async function request(token, path, method = "GET", body, signal) {
  const headers = { Accept: "application/vnd.github+json", Authorization: "Bearer " + token };
  if (body) headers["Content-Type"] = "application/json";
  const response = await fetch(baseUrl + path, {
    method, headers, cache: "no-store", body: body && JSON.stringify(body), signal
  });
  if (!response.ok) {
    const messages = {
      401: "令牌已失效，请重新连接。",
      403: "GitHub 拒绝了请求，请检查仓库权限或稍后重试。",
      404: "无法访问数据仓库，请检查令牌权限。",
      409: "数据版本已变化，请重试。",
      422: "GitHub 未接受这次提交，请刷新总览后重试。"
    };
    const error = new Error(messages[response.status] || "GitHub 请求失败（" + response.status + "）。");
    error.status = response.status;
    throw error;
  }
  return response.json();
}

export function checkConnection(token) {
  return request(token, "");
}

export async function uploadPhoto(token, jpegDataUrl) {
  const content = jpegDataUrl.slice(jpegDataUrl.indexOf(",") + 1);
  const blob = await request(token, "/git/blobs", "POST", { encoding: "base64", content });
  return blob.sha;
}

export async function readPhoto(token, sha, signal) {
  const blob = await request(token, "/git/blobs/" + encodeURIComponent(sha), "GET", undefined, signal);
  return "data:image/jpeg;base64," + blob.content.replace(/\s/g, "");
}

async function optionalFile(token, path) {
  try {
    return await request(token, path);
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

async function readMonth(token, month, ref) {
  const path = "records/" + month + ".json";
  const file = await optionalFile(token, "/contents/" + path + (ref ? "?ref=" + ref : ""));
  if (!file) return { path, records: [] };
  return { path, sha: file.sha, records: decodeRecords(file) };
}

function decodeRecords(file) {
  const bytes = Uint8Array.from(atob(file.content), char => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function listRecords(token) {
  const files = await optionalFile(token, "/contents/records");
  if (!files) {
    await checkConnection(token);
    return [];
  }
  const months = files.filter(file => /^\d{4}-\d{2}\.json$/.test(file.name));
  const data = await Promise.all(months.map(async file => decodeRecords(await request(token, "/git/blobs/" + file.sha))));
  return data.flat().sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

function fileText(file) {
  return JSON.stringify(file.records, null, 2) + "\n";
}

function writeMonth(token, file, message) {
  const bytes = new TextEncoder().encode(fileText(file));
  const content = btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(""));
  return request(token, "/contents/" + file.path, "PUT", { message, content, sha: file.sha });
}

// Publish all changed months and the photo together against the same branch head.
async function commitFiles(token, head, entries, branch, message) {
  const tree = await request(token, "/git/trees", "POST", { base_tree: head.commit.tree.sha, tree: entries });
  const commit = await request(token, "/git/commits", "POST", {
    message, tree: tree.sha, parents: [head.sha]
  });
  await request(token, "/git/refs/heads/" + branch, "PATCH", { sha: commit.sha, force: false });
}

function sameRecord(a, b) {
  return a && b && a.id === b.id && a.at === b.at && a.type === b.type &&
    a.kg === b.kg && a.text === b.text && (a.kcal ?? null) === (b.kcal ?? null) &&
    (a.photoSha ?? null) === (b.photoSha ?? null);
}

// before is null for an addition, after is null for a deletion.
export async function changeRecord(token, before, after) {
  const source = before?.at.slice(0, 7);
  const target = after?.at.slice(0, 7);
  const months = [...new Set([source, target].filter(Boolean))];
  const id = (before || after).id;
  const message = !before ? "Add record" : after ? "Edit record" : "Delete record";
  const nextPhotoSha = after?.photoSha ?? null;
  const photoChanged = (before?.photoSha ?? null) !== nextPhotoSha;
  const branch = months.length === 2 || photoChanged ? (await checkConnection(token)).default_branch : null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const head = branch ? await request(token, "/commits/" + encodeURIComponent(branch)) : null;
    const files = await Promise.all(months.map(month => readMonth(token, month, head?.sha)));
    const from = files[months.indexOf(source)];
    const to = files[months.indexOf(target)];
    const current = from?.records.find(record => record.id === id);
    const saved = to?.records.find(record => record.id === id);
    if (sameRecord(saved, after) || (!after && !current)) return;
    if ((before && !sameRecord(current, before)) || (!before && saved)) {
      throw new Error("这条记录已经变更，请从总览重新打开。");
    }
    if (from) from.records = from.records.filter(record => record.id !== id);
    if (to) to.records.push(after);

    try {
      if (head) {
        const entries = files.map(file => ({
          path: file.path, mode: "100644", type: "blob", content: fileText(file)
        }));
        if (photoChanged) {
          entries.push({ path: "photos/" + id + ".jpg", mode: "100644", type: "blob", sha: nextPhotoSha });
        }
        await commitFiles(token, head, entries, branch, message);
      } else {
        await writeMonth(token, files[0], message);
      }
      return;
    } catch (error) {
      if (attempt > 0 || ![409, 422].includes(error.status)) throw error;
    }
  }
}
