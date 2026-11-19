const canvas = document.querySelector("#trend");
const caption = document.querySelector("#chart-caption");
let weights = [];
let points = [];
let selected = null;

export function showTrend(records) {
  weights = records.filter(record => record.type === "weight").reverse();
  selected = null;
  draw();
}

function draw() {
  const end = new Date();
  end.setHours(24, 0, 0, 0);
  const start = new Date(end);
  start.setDate(start.getDate() - 30);
  const recent = weights.filter(record => Date.parse(record.at) >= start && Date.parse(record.at) < end);
  canvas.hidden = !recent.length;
  if (!recent.length) {
    caption.textContent = "近 30 天还没有体重记录。";
    return;
  }
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return;
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  const style = getComputedStyle(canvas);
  const color = name => style.getPropertyValue(name).trim();
  const accent = color("--accent");

  const values = recent.map(record => record.kg);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const padding = Math.max((high - low) * .15, .1);
  const bottom = height - 25;
  const top = 12;
  const left = 49;
  const right = width - 8;
  const y = value => bottom - (value - low + padding) / (high - low + 2 * padding) * (bottom - top);
  const x = time => left + (time - start) / (end - start) * (right - left);
  ctx.font = '13px system-ui, sans-serif';
  ctx.textBaseline = "middle";
  ctx.fillStyle = color("--muted");
  ctx.strokeStyle = color("--line");
  for (const value of [high + padding, (low + high) / 2, low - padding]) {
    const pos = y(value);
    ctx.fillText(value.toFixed(1), 0, pos);
    ctx.beginPath();
    ctx.moveTo(left, pos);
    ctx.lineTo(right, pos);
    ctx.stroke();
  }
  ctx.fillText((start.getMonth() + 1) + "/" + start.getDate(), left, height - 8);
  ctx.textAlign = "right";
  ctx.fillText("今天", right, height - 8);

  points = recent.map(record => ({ record, x: x(Date.parse(record.at)), y: y(record.kg) }));
  ctx.beginPath();
  points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = accent;
  ctx.strokeStyle = color("--surface");
  ctx.lineWidth = 1.2;
  for (const point of points) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, selected === point.record ? 5.5 : 3.2, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
  }
  caption.textContent = selected
    ? selected.at.slice(0, 16).replace("T", " ") + " · " + selected.kg + " kg"
    : "共 " + recent.length + " 次测量，轻点图上的点可查看。";
}

canvas.addEventListener("click", event => {
  const rect = canvas.getBoundingClientRect();
  const distance = p => Math.hypot(p.x - (event.clientX - rect.left), p.y - (event.clientY - rect.top));
  selected = points.reduce((nearest, p) => distance(p) < distance(nearest) ? p : nearest).record;
  draw();
});

new ResizeObserver(() => {
  if (canvas.clientWidth) draw();
}).observe(canvas);

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", draw);
