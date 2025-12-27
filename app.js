const LS_KEY = "spatiCrawlCompleted_v1";
const LS_CURRENT_KEY = "spatiCrawlCurrentStop_v1";
let currentStopId = localStorage.getItem(LS_CURRENT_KEY) || null;

const SUPABASE_URL = "https://YOURPROJECT.supabase.co";
const SUPABASE_ANON_KEY = "YOUR_ANON_KEY";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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

function openDetail(stop){
  setCurrentStop(stop);
  const detail = document.getElementById("detail");
  detail.classList.remove("hidden");

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
  const res = await fetch("/spatis.json");
  stops = await res.json();

  map = L.map("map");
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);

  stops.forEach((s, idx) => {
    const marker = L.marker([s.lat, s.lon], { title: s.name })
      .addTo(map)
      .bindPopup(`${completed.has(s.id) ? "✅" : "🎯"} ${s.name}`);
    marker.on("click", () => openDetail(s));
    markers.set(s.id, marker);
  });

  fitRoute();
  renderProgress();
  renderList();

document.getElementById("startBtn").onclick = () => {
  const s = firstIncompleteStop();
  setCurrentStop(s);
  openDetail(s);
};

  // auto-save render
  save();
}

init();
