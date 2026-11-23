const canvas = document.querySelector("#trend");
const caption = document.querySelector("#chart-caption");
const legend = document.querySelector("#chart-legend");
const range = document.querySelector("#trend-range");
const dayMs = 86_400_000;
let weights = [];
let averages = [];
let points = [];
let selected = null;

export function showTrend(records) {
  weights = records
    .filter(record => record.type === "weight" && Number.isFinite(record.kg) && record.kg > 0)
    .map(record => ({ record, time: Date.parse(record.at) }))
    .filter(({ time }) => Number.isFinite(time))
    .sort((a, b) => a.time - b.time);
  averages = movingAverages(weights);
  selected = null;
  draw();
}

function movingAverages(readings) {
  const days = new Map();
  for (const { record, time } of readings) {
    const date = new Date(time);
    // Use the local calendar date even when a clock change makes a day shorter or longer.
    const key = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    if (!days.has(key)) days.set(key, { sum: 0, count: 0, time });
    const day = days.get(key);
    day.sum += record.kg;
    day.count++;
    day.time = time;
  }

  return Array.from(days, ([date, day]) => {
    let sum = 0;
    let count = 0;
    for (let offset = 0; offset < 7; offset++) {
      const sample = days.get(date - offset * dayMs);
      if (!sample) continue;
      sum += sample.sum / sample.count;
      count++;
    }
    return { time: day.time, kg: sum / count };
  });
}

function dateLabel(date, includeYear) {
  const monthDay = `${date.getMonth() + 1}/${date.getDate()}`;
  return includeYear ? `${date.getFullYear()}/${monthDay}` : monthDay;
}

function draw() {
  const all = range.value === "all";
  const end = all && weights.length ? new Date(weights.at(-1).time) : new Date();
  const endLabel = all ? dateLabel(end, true) : "今天";
  end.setHours(24, 0, 0, 0);
  const start = all && weights.length ? new Date(weights[0].time) : new Date(end);
  if (all) start.setHours(0, 0, 0, 0);
  else start.setDate(start.getDate() - Number(range.value));

  const inRange = ({ time }) => time >= start && time < end;
  const recent = weights.filter(inRange);
  canvas.hidden = legend.hidden = !recent.length;
  if (!recent.length) {
    points = [];
    caption.textContent = all ? "还没有体重记录。" : `近 ${range.value} 天还没有体重记录。`;
    return;
  }
  const recentAverages = averages.filter(inRange);

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

  const values = [...recent.map(({ record }) => record.kg), ...recentAverages.map(({ kg }) => kg)];
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
  ctx.fillText(dateLabel(start, all), left, height - 8);
  ctx.textAlign = "right";
  ctx.fillText(endLabel, right, height - 8);

  points = recent.map(({ record, time }) => ({ record, x: x(time), y: y(record.kg) }));
  ctx.beginPath();
  points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.beginPath();
  recentAverages.forEach(({ time, kg }, i) => i ? ctx.lineTo(x(time), y(kg)) : ctx.moveTo(x(time), y(kg)));
  ctx.strokeStyle = color("--muted");
  ctx.setLineDash([5, 4]);
  ctx.stroke();
  ctx.setLineDash([]);

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

range.addEventListener("change", () => {
  selected = null;
  draw();
});

canvas.addEventListener("click", event => {
  if (!points.length) return;
  const rect = canvas.getBoundingClientRect();
  const distance = p => Math.hypot(p.x - (event.clientX - rect.left), p.y - (event.clientY - rect.top));
  selected = points.reduce((nearest, p) => distance(p) < distance(nearest) ? p : nearest).record;
  draw();
});

new ResizeObserver(() => {
  if (canvas.clientWidth) draw();
}).observe(canvas);

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", draw);
