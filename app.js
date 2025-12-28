const LS_KEY = "spatiCrawlCompleted_v1";
const LS_CURRENT_KEY = "spatiCrawlCurrentStop_v1";
let currentStopId = localStorage.getItem(LS_CURRENT_KEY) || null;

let currentStopForFeedId = null;

const SUPABASE_URL = "https://exvhwgkhgogeiqhwlvxz.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV4dmh3Z2toZ29nZWlxaHdsdnh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY4MjE2MjgsImV4cCI6MjA4MjM5NzYyOH0.v9vDjrKQQRVX1d0rvku1G9O-xBeU4Veq_r72FyXaUPg";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
console.log("Supabase connected:", sb);

let stops = [];
let completed = new Set(JSON.parse(localStorage.getItem(LS_KEY) || "[]"));

let map;
let markers = new Map();
let routeLine;

function save() {
  localStorage.setItem(LS_KEY, JSON.stringify([...completed]));
  renderProgress();
  renderList();
  renderMarkerStyles();
}

function setTab(name){
  document.querySelectorAll(".tabPane").forEach(p => p.classList.remove("active"));
  const pane = document.getElementById("tab" + name);
  if (pane) pane.classList.add("active");

  document.querySelectorAll(".bottomNav button").forEach(b => b.classList.remove("active"));
  const btn = document.querySelector(`.bottomNav button[data-tab="${name}"]`);
  if (btn) btn.classList.add("active");

  // Leaflet map needs this after being hidden/shown
  if (name === "Map" && typeof map !== "undefined" && map) {
    setTimeout(() => map.invalidateSize(), 50);
  }
}

async function setFeedStop(stop){
  currentStopForFeedId = stop?.id || null;

  const title = document.getElementById("feedTitle");
  const sub = document.getElementById("feedSubtitle");

  if (!currentStopForFeedId){
    title.textContent = "Feed";
    sub.textContent = "Start the crawl to pick a stop.";
    document.getElementById("posts").innerHTML = "";
    document.getElementById("mediaGrid").innerHTML = "";
    return;
  }

  title.textContent = `Feed · ${stop.name}`;
  sub.textContent = stop.address;

  await loadPostsForStop(currentStopForFeedId);
  await loadMediaForStop(currentStopForFeedId);

  // Ensure buttons post/upload to the current stop
  document.getElementById("postBtn").onclick = () => createPost(currentStopForFeedId);
  document.getElementById("uploadBtn").onclick = () => uploadMedia(currentStopForFeedId);
}

async function uploadMedia(stopId){
  const fileInput = document.getElementById("mediaFile");
  const file = fileInput.files?.[0];
  if (!file) return;

  const username = (document.getElementById("username")?.value || "").trim();
  const caption = (document.getElementById("mediaCaption")?.value || "").trim();

  const isVideo = file.type.startsWith("video/");
  const mediaType = isVideo ? "video" : "image";

  const ext = file.name.split(".").pop() || (isVideo ? "mp4" : "jpg");
  const path = `${stopId}/${crypto.randomUUID()}.${ext}`;

  // Upload to Storage
  const { error: upErr } = await sb.storage.from("media").upload(path, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type
  });
  if (upErr) { console.error(upErr); alert("Upload failed"); return; }

  // Get a public URL
  const { data } = sb.storage.from("media").getPublicUrl(path);
  const mediaUrl = data.publicUrl;

  // Save metadata to DB
  const { error: insErr } = await sb.from("media_posts").insert({
    stop_id: stopId,
    username,
    caption,
    media_url: mediaUrl,
    media_type: mediaType
  });
  if (insErr) { console.error(insErr); alert("Save failed"); return; }

  fileInput.value = "";
  document.getElementById("mediaCaption").value = "";
  await loadMediaForStop(stopId);
}

async function loadMediaForStop(stopId){
  const { data, error } = await sb
    .from("media_posts")
    .select("*")
    .eq("stop_id", stopId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) { console.error(error); return; }

  const grid = document.getElementById("mediaGrid");
  grid.innerHTML = "";
  data.forEach(item => {
    const wrap = document.createElement("div");
    if (item.media_type === "video") {
      wrap.innerHTML = `<video controls playsinline src="${item.media_url}"></video>`;
    } else {
      wrap.innerHTML = `<img loading="lazy" src="${item.media_url}" alt="">`;
    }
    grid.appendChild(wrap);
  });
}

async function loadPostsForStop(stopId){
  const { data, error } = await sb
    .from("posts")
    .select("*")
    .eq("stop_id", stopId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) { console.error(error); return; }

  const wrap = document.getElementById("posts");
  wrap.innerHTML = "";
  data.forEach(p => {
    const div = document.createElement("div");
    div.className = "post";
    const who = p.username?.trim() ? p.username.trim() : "anonymous";
    const when = new Date(p.created_at).toLocaleString();
    div.innerHTML = `
      <div class="postMeta">${who} · ${when}</div>
      <div>${escapeHtml(p.message)}</div>
    `;
    wrap.appendChild(div);
  });
}

async function createPost(stopId){
  const username = document.getElementById("username").value || "";
  const message = document.getElementById("postMessage").value || "";
  if (!message.trim()) return;

  const { error } = await sb.from("posts").insert({
    stop_id: stopId,
    username,
    message: message.trim()
  });

  if (error) { console.error(error); return; }

  document.getElementById("postMessage").value = "";
  await loadPostsForStop(stopId);
}

function escapeHtml(s){
  return s
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}
function setCurrentStop(stop){
  currentStopId = stop?.id || null;
  if (currentStopId) localStorage.setItem(LS_CURRENT_KEY, currentStopId);
  else localStorage.removeItem(LS_CURRENT_KEY);
  renderCurrentStop();
}

function renderCurrentStop(){
  const el = document.getElementById("currentStop");
  if (!stops.length) { el.textContent = "Loading…"; return; }

  const stop = currentStopId ? stops.find(s => s.id === currentStopId) : null;
  if (!stop) {
    el.innerHTML = `Not started yet`;
    return;
  }

  el.innerHTML = `Now at: <strong>${stop.name}</strong> · ${stop.address}`;
}
function renderProgress(){
  const el = document.getElementById("progress");
  el.textContent = `${completed.size} / ${stops.length} completed`;
}

function firstIncompleteStop(){
  return stops.find(s => !completed.has(s.id)) || stops[0];
}

async function openDetail(stop){
  setCurrentStop(stop);
  await loadPostsForStop(stop.id);
  document.getElementById("postBtn").onclick = () => createPost(stop.id);
  setTab("Map");
  await setFeedStop(stop);

  const img = document.getElementById("dPhoto");
  if (stop.imageName) {
  img.src = `./photos/${stop.imageName}.jpg`; // change to .png if needed
  img.classList.remove("hidden");
} else {
  img.classList.add("hidden");
}
  
  const detail = document.getElementById("detail");
  detail.classList.remove("hidden");
  await loadMediaForStop(stop.id);

const uploadBtn = document.getElementById("uploadBtn");
if (uploadBtn) {
  uploadBtn.onclick = () => uploadMedia(stop.id);
  document.getElementById("detail")
  .scrollIntoView({ behavior: "smooth", block: "start" });
}

  document.getElementById("dName").textContent = stop.name;
  document.getElementById("dAddr").textContent = stop.address;
  document.getElementById("dInstructions").textContent = stop.instructions;

  const challengeBox = document.getElementById("challengeBox");
  const dChallenge = document.getElementById("dChallenge");
  if (stop.challenge && stop.challenge.trim().length > 0){
    challengeBox.style.display = "block";
    dChallenge.textContent = stop.challenge;
  } else {
    challengeBox.style.display = "none";
  }

  const btn = document.getElementById("completeBtn");
  const isDone = completed.has(stop.id);
  btn.textContent = isDone ? "Mark incomplete" : "Mark complete";
  btn.onclick = () => {
    if (completed.has(stop.id)) completed.delete(stop.id);
    else completed.add(stop.id);
    save();
    openDetail(stop);
  };

  const mapsLink = document.getElementById("mapsLink");
  const q = encodeURIComponent(`${stop.lat},${stop.lon}`);
  mapsLink.href = `https://maps.apple.com/?ll=${q}&q=${encodeURIComponent(stop.name)}`;

  // center map on it
  map.setView([stop.lat, stop.lon], 16, { animate:true });
  markers.get(stop.id)?.openPopup();
}

function renderList(){
  const list = document.getElementById("list");
  list.innerHTML = "";
  stops.forEach((s, idx) => {
    const div = document.createElement("div");
    div.className = "item";
    div.onclick = () => openDetail(s);

    div.innerHTML = `
      <div class="itemHead">
        <div class="itemName">${idx+1}. ${s.name}</div>
        <div class="badge">${completed.has(s.id) ? "✅" : "⬜️"}</div>
      </div>
      <div class="muted">${s.address}</div>
    `;
    list.appendChild(div);
  });
}

function renderMarkerStyles(){
  markers.forEach((m, id) => {
    const done = completed.has(id);
    // Leaflet default marker is fine; popup text shows status
    m.setPopupContent(`${done ? "✅" : "🎯"} ${m.options.title}`);
  });
}

function fitRoute(){
  const latlngs = stops.map(s => [s.lat, s.lon]);
  routeLine?.remove();
  routeLine = L.polyline(latlngs, { weight: 5 }).addTo(map);
  map.fitBounds(routeLine.getBounds(), { padding: [30,30] });
}

async function init(){
  renderCurrentStop();

  const res = await fetch("./spatis.json");
  stops = await res.json();

  map = L.map("map");
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);

  stops.forEach((s) => {
    const marker = L.marker([s.lat, s.lon], { title: s.name })
      .addTo(map)
      .bindPopup(`${completed.has(s.id) ? "✅" : "🎯"} ${s.name}`);

    marker.on("click", () => openDetail(s));
    markers.set(s.id, marker);
  });

  // ✅ TAB WIRING GOES HERE (once)
  document.querySelectorAll(".bottomNav button").forEach(btn => {
    btn.onclick = () => setTab(btn.dataset.tab);
  });

  // Optional: start on Map
  setTab("Map");
  fitRoute();
  renderProgress();
  renderList();

  document.getElementById("startBtn").onclick = () => {
    const s = firstIncompleteStop();
    setCurrentStop(s);
    openDetail(s);
    setTab("Map");
  };

  // auto-save render
  save();
}

init();
