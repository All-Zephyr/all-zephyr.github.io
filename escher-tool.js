const fileInput = document.getElementById("fileInput");
const renderBtn = document.getElementById("renderBtn");
const downloadBtn = document.getElementById("downloadBtn");
const centerXInput = document.getElementById("centerX");
const centerYInput = document.getElementById("centerY");
const branchDirInput = document.getElementById("branchDir");
const zoomInput = document.getElementById("zoom");
const qValueInput = document.getElementById("qValue");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });
const statusMsg = document.getElementById("statusMsg");

let sourceImageData = null;
let sourceWidth = canvas.width;
let sourceHeight = canvas.height;

function clamp(v, min, max){
  return Math.max(min, Math.min(max, v));
}

function sampleBilinear(data, w, h, x, y){
  const fx = clamp(x, 0, w - 1);
  const fy = clamp(y, 0, h - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, w - 1);
  const y1 = Math.min(y0 + 1, h - 1);
  const dx = fx - x0;
  const dy = fy - y0;

  const i00 = (y0 * w + x0) * 4;
  const i10 = (y0 * w + x1) * 4;
  const i01 = (y1 * w + x0) * 4;
  const i11 = (y1 * w + x1) * 4;

  const out = [0, 0, 0, 255];
  for (let c = 0; c < 3; c++){
    const v =
      data[i00 + c] * (1 - dx) * (1 - dy) +
      data[i10 + c] * dx * (1 - dy) +
      data[i01 + c] * (1 - dx) * dy +
      data[i11 + c] * dx * dy;
    out[c] = Math.round(v);
  }
  return out;
}

function render(){
  if (!sourceImageData){
    alert("Please upload an image first.");
    return;
  }
  statusMsg.textContent = "Rendering… this can take 5-20 seconds.";

  const w = sourceWidth;
  const h = sourceHeight;
  const cx = parseFloat(centerXInput.value || `${Math.floor(w / 2)}`);
  const cy = parseFloat(centerYInput.value || `${Math.floor(h / 2)}`);
  const q = parseFloat(qValueInput.value || "22.5836845286");
  const zoom = parseFloat(zoomInput.value || "0.95");
  const branch = (parseFloat(branchDirInput.value || "160") * Math.PI) / 180;
  const eps = 1e-12;

  const beta = Math.log(q) / (2 * Math.PI);
  const denom = 1 + beta * beta;
  const aInv = 1 / denom;
  const bInv = beta / denom;

  const uc = -1 + (2 * cx) / (w - 1);
  const vc = 1 - (2 * cy) / (h - 1);

  const out = ctx.createImageData(w, h);
  const src = sourceImageData.data;
  const dst = out.data;

  const cosB = Math.cos(branch);
  const sinB = Math.sin(branch);

  for (let y = 0; y < h; y++){
    const v = 1 - (2 * y) / (h - 1);
    for (let x = 0; x < w; x++){
      const u = -1 + (2 * x) / (w - 1);

      let xr = u - uc;
      let yi = v - vc;

      const rx = xr * cosB + yi * sinB;
      const ry = -xr * sinB + yi * cosB;
      xr = rx;
      yi = ry;

      const r = Math.hypot(xr, yi);
      const safeR = Math.max(r, eps);
      const theta = Math.atan2(yi, xr);

      const lnR = Math.log(safeR);
      const tr = aInv * lnR - bInv * theta;
      const ti = bInv * lnR + aInv * theta;

      const expTr = Math.exp(tr);
      let mx = expTr * Math.cos(ti);
      let my = expTr * Math.sin(ti);

      mx *= zoom;
      my *= zoom;

      const bx = mx * cosB - my * sinB;
      const by = mx * sinB + my * cosB;

      const zx = uc + bx;
      const zy = vc + by;

      const sx = ((zx + 1) * 0.5) * (w - 1);
      const sy = ((1 - zy) * 0.5) * (h - 1);

      const c = sampleBilinear(src, w, h, sx, sy);
      const di = (y * w + x) * 4;
      dst[di] = c[0];
      dst[di + 1] = c[1];
      dst[di + 2] = c[2];
      dst[di + 3] = 255;
    }
  }

  ctx.putImageData(out, 0, 0);
  statusMsg.textContent = "Done. Adjust values and click Render again if needed.";
}

function fitCanvasToImage(img){
  const maxSide = 1200;
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  sourceWidth = Math.max(1, Math.round(img.width * scale));
  sourceHeight = Math.max(1, Math.round(img.height * scale));
  canvas.width = sourceWidth;
  canvas.height = sourceHeight;
  ctx.drawImage(img, 0, 0, sourceWidth, sourceHeight);
  sourceImageData = ctx.getImageData(0, 0, sourceWidth, sourceHeight);
  centerXInput.value = Math.floor(sourceWidth * 0.62);
  centerYInput.value = Math.floor(sourceHeight * 0.67);
  statusMsg.textContent = "Image loaded. Rendering a first pass…";
  setTimeout(() => render(), 20);
}

fileInput.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const img = new Image();
  img.onload = () => fitCanvasToImage(img);
  img.src = URL.createObjectURL(file);
});

canvas.addEventListener("click", (event) => {
  const rect = canvas.getBoundingClientRect();
  const x = Math.round(((event.clientX - rect.left) / rect.width) * canvas.width);
  const y = Math.round(((event.clientY - rect.top) / rect.height) * canvas.height);
  centerXInput.value = x;
  centerYInput.value = y;
});

renderBtn.addEventListener("click", () => {
  renderBtn.disabled = true;
  renderBtn.textContent = "Rendering...";
  setTimeout(() => {
    render();
    renderBtn.disabled = false;
    renderBtn.textContent = "Render";
  }, 20);
});

downloadBtn.addEventListener("click", () => {
  const url = canvas.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = url;
  a.download = "escher-output.png";
  a.click();
});
