const maxEdge = 960;
const maxBytes = 150_000;

function dataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("读取照片失败，请重新选择。"));
    reader.readAsDataURL(blob);
  });
}

export async function compressPhoto(file) {
  const original = URL.createObjectURL(file);
  const image = new Image();
  try {
    image.src = original;
    try {
      await image.decode();
    } catch {
      throw new Error("浏览器无法打开这张图片，请改选 JPEG 或 PNG 照片。");
    }
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const longest = Math.max(image.naturalWidth, image.naturalHeight);
    let edge = Math.min(longest, maxEdge);
    while (edge >= 1) {
      canvas.width = Math.max(1, Math.round(image.naturalWidth * edge / longest));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * edge / longest));
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const jpeg = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.6));
      if (!jpeg || jpeg.type !== "image/jpeg") break;
      if (jpeg.size <= maxBytes) return dataUrl(jpeg);
      edge = Math.floor(edge * 0.75);
    }
    throw new Error("压缩照片失败，请重新选择。");
  } finally {
    URL.revokeObjectURL(original);
  }
}

export function createPhotoGallery(readPhoto) {
  const template = document.getElementById("photo-thumbnail");
  const viewer = document.getElementById("photo-viewer");
  const fullImage = viewer.querySelector("img");
  viewer.addEventListener("close", () => fullImage.removeAttribute("src"));

  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        observer.unobserve(entry.target);
        load(entry.target);
      }
    }
  }, { rootMargin: "80px 0px" });

  function display(button, src) {
    const image = button.querySelector("img");
    image.src = src;
    image.hidden = false;
    button.querySelector("span").hidden = true;
    button.setAttribute("aria-label", "放大饮食照片");
  }

  async function load(button) {
    if (!button.isConnected || button.disabled || !button.querySelector("img").hidden) return;
    button.disabled = true;
    const label = button.querySelector("span");
    label.textContent = "正在读取照片…";
    try {
      const src = await readPhoto(button.dataset.sha);
      if (button.isConnected) display(button, src);
    } catch (error) {
      label.textContent = error.status === 401 ? "请在连接设置中更换令牌" : "读取失败，点此重试";
      button.setAttribute("aria-label", label.textContent);
    } finally {
      button.disabled = false;
    }
  }

  function thumbnail(photo) {
    const button = template.content.firstElementChild.cloneNode(true);
    if (photo.preview) {
      display(button, photo.preview);
    } else {
      button.dataset.sha = photo.sha;
      observer.observe(button);
    }
    button.onclick = () => {
      const image = button.querySelector("img");
      if (image.hidden) return load(button);
      fullImage.src = image.src;
      viewer.showModal();
    };
    return button;
  }

  function clear(container) {
    if (viewer.open) viewer.close();
    for (const button of container.querySelectorAll(".photo-thumb")) observer.unobserve(button);
    container.replaceChildren();
  }

  return { thumbnail, clear };
}
