const LS_KEY = "spatiCrawlCompleted_v1";
const LS_CURRENT_KEY = "spatiCrawlCurrentStop_v1";
// Requires a Supabase table: live_locations (id uuid, username text, avatar_url text, lat float, lon float, accuracy float, seen_at timestamptz).
const LIVE_TABLE = "live_locations";
const LIVE_ID_KEY = "liveLocationId_v1";
const LIVE_NAME_KEY = "liveLocationName_v1";
const LIVE_AVATAR_KEY = "liveLocationAvatar_v1";
const INSTALL_PROMPT_KEY = "installPromptDismissed_v1";
const LIVE_MAX_AGE_MS = 2 * 60 * 60 * 1000;
let currentStopId = localStorage.getItem(LS_CURRENT_KEY) || null;

let currentStopForFeedId = null;

const SUPABASE_URL = "https://exvhwgkhgogeiqhwlvxz.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV4dmh3Z2toZ29nZWlxaHdsdnh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY4MjE2MjgsImV4cCI6MjA4MjM5NzYyOH0.v9vDjrKQQRVX1d0rvku1G9O-xBeU4Veq_r72FyXaUPg";
const COMMIT_REF = "f87fdd8";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
console.log("Supabase connected:", sb);

let stops = [];
let completed = new Set(JSON.parse(localStorage.getItem(LS_KEY) || "[]"));

let map;
let markers = new Map();
let routeLine;
let liveMap;
let liveMarkers = new Map();
let liveEntries = new Map();
let liveWatchId = null;
let liveLastSentAt = 0;
let liveLastSentPos = null;
let liveChannel;

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
  if (name === "Live" && typeof liveMap !== "undefined" && liveMap) {
    setTimeout(() => liveMap.invalidateSize(), 50);
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

function closeDetail(){
  const detail = document.getElementById("detail");
  if (detail) detail.classList.add("hidden");
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

function getLiveId(){
  let id = localStorage.getItem(LIVE_ID_KEY);
  if (!id){
    id = crypto.randomUUID();
    localStorage.setItem(LIVE_ID_KEY, id);
  }
  return id;
}

function setLiveStatus(message){
  const el = document.getElementById("liveStatus");
  if (el) el.textContent = message;
}

function getLiveAvatarUrl(){
  const input = document.getElementById("liveAvatarUrl");
  const value = (input?.value || "").trim();
  if (value) localStorage.setItem(LIVE_AVATAR_KEY, value);
  return value;
}

function distanceMeters(a, b){
  if (!a || !b) return Infinity;
  const R = 6371000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function shouldSendLiveUpdate(lat, lon){
  const now = Date.now();
  if (!liveLastSentPos) return true;
  const dist = distanceMeters(liveLastSentPos, { lat, lon });
  return (now - liveLastSentAt) >= 5000 || dist >= 20;
}

async function sendLiveUpdate(lat, lon, accuracy){
  const username = (document.getElementById("liveName")?.value || "").trim();
  if (username) localStorage.setItem(LIVE_NAME_KEY, username);
  const avatarUrl = getLiveAvatarUrl();
  const payload = {
    id: getLiveId(),
    username: username || "Anonymous",
    avatar_url: avatarUrl || null,
    lat,
    lon,
    accuracy,
    seen_at: new Date().toISOString()
  };
  const { error } = await sb.from(LIVE_TABLE).upsert(payload);
  if (error) console.error(error);
  return payload;
}

function formatAgo(iso){
  if (!iso) return "just now";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return "just now";
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

function upsertLiveEntry(entry){
  if (!entry?.id) return;
  const seenAt = entry.seen_at ? new Date(entry.seen_at).getTime() : 0;
  if (seenAt && Date.now() - seenAt > LIVE_MAX_AGE_MS) return;
  liveEntries.set(entry.id, entry);
  renderLiveMarkers();
  renderLiveList();
}

function removeLiveEntry(id){
  if (!id) return;
  liveEntries.delete(id);
  const marker = liveMarkers.get(id);
  if (marker){
    marker.remove();
    liveMarkers.delete(id);
  }
  renderLiveList();
}

function buildLiveIcon(entry){
  if (entry?.avatar_url){
    return L.divIcon({
      className: "liveMarker",
      iconSize: [44, 44],
      iconAnchor: [22, 44],
      popupAnchor: [0, -36],
      html: `<img class="liveMarkerImg" src="${entry.avatar_url}" alt="">`
    });
  }
  return new L.Icon.Default();
}

function renderLiveMarkers(){
  liveEntries.forEach((entry, id) => {
    if (!entry.lat || !entry.lon) return;
    const label = entry.id === getLiveId()
      ? `${entry.username || "You"} (you)`
      : (entry.username || "Anonymous");
    let marker = liveMarkers.get(id);
    if (!marker){
      marker = L.marker([entry.lat, entry.lon], { title: label, icon: buildLiveIcon(entry) })
        .addTo(liveMap)
        .bindPopup(label);
      liveMarkers.set(id, marker);
    } else {
      marker.setLatLng([entry.lat, entry.lon]);
      marker.setIcon(buildLiveIcon(entry));
      marker.setPopupContent(label);
    }
  });
}

function renderLiveList(){
  const list = document.getElementById("liveList");
  if (!list) return;
  const items = Array.from(liveEntries.values())
    .sort((a, b) => new Date(b.seen_at || 0) - new Date(a.seen_at || 0));
  if (items.length === 0){
    list.innerHTML = "<div class=\"muted\">No one is sharing yet.</div>";
    return;
  }
  list.innerHTML = "";
  items.forEach(entry => {
    const div = document.createElement("div");
    div.className = "item";
    const label = entry.id === getLiveId()
      ? `${entry.username || "You"} (you)`
      : (entry.username || "Anonymous");
    const initials = (entry.username || "A").trim().slice(0, 1).toUpperCase();
    div.innerHTML = `
      <div class="liveRow">
        ${entry.avatar_url ? `<img class="liveAvatar" src="${entry.avatar_url}" alt="">`
          : `<div class="liveAvatarPlaceholder">${initials}</div>`}
        <div class="liveInfo">
          <div class="itemHead">
            <div class="itemName">${label}</div>
            <div class="badge">${formatAgo(entry.seen_at)}</div>
          </div>
          <div class="muted">±${Math.round(entry.accuracy || 0)}m</div>
        </div>
      </div>
    `;
    div.onclick = () => {
      const marker = liveMarkers.get(entry.id);
      if (marker){
        liveMap.setView(marker.getLatLng(), 16, { animate:true });
        marker.openPopup();
      }
    };
    list.appendChild(div);
  });
}

async function loadLiveLocations(){
  const cutoff = new Date(Date.now() - LIVE_MAX_AGE_MS).toISOString();
  const { data, error } = await sb
    .from(LIVE_TABLE)
    .select("id,username,avatar_url,lat,lon,accuracy,seen_at")
    .gte("seen_at", cutoff)
    .order("seen_at", { ascending: false })
    .limit(200);
  if (error) { console.error(error); return; }
  liveEntries.clear();
  liveMarkers.forEach(marker => marker.remove());
  liveMarkers.clear();
  data.forEach(entry => upsertLiveEntry(entry));
}

function startLiveSharing(){
  if (!navigator.geolocation){
    setLiveStatus("Geolocation not supported on this device.");
    return;
  }
  const shareBtn = document.getElementById("liveShareBtn");
  const stopBtn = document.getElementById("liveStopBtn");
  if (shareBtn) shareBtn.disabled = true;
  if (stopBtn) stopBtn.disabled = false;
  setLiveStatus("Requesting location permission...");
  liveWatchId = navigator.geolocation.watchPosition(
    async (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      const accuracy = pos.coords.accuracy;
      if (!shouldSendLiveUpdate(lat, lon)) return;
      liveLastSentAt = Date.now();
      liveLastSentPos = { lat, lon };
      setLiveStatus(`Sharing live · ±${Math.round(accuracy)}m`);
      const payload = await sendLiveUpdate(lat, lon, accuracy);
      if (payload) upsertLiveEntry(payload);
    },
    (err) => {
      console.error(err);
      setLiveStatus("Location error. Check permissions.");
      if (shareBtn) shareBtn.disabled = false;
      if (stopBtn) stopBtn.disabled = true;
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );
}

async function stopLiveSharing(){
  const shareBtn = document.getElementById("liveShareBtn");
  const stopBtn = document.getElementById("liveStopBtn");
  if (liveWatchId !== null){
    navigator.geolocation.clearWatch(liveWatchId);
    liveWatchId = null;
  }
  if (shareBtn) shareBtn.disabled = false;
  if (stopBtn) stopBtn.disabled = true;
  setLiveStatus("Sharing paused.");
  const { error } = await sb.from(LIVE_TABLE).delete().eq("id", getLiveId());
  if (error) console.error(error);
}

function initLive(){
  const nameInput = document.getElementById("liveName");
  if (nameInput){
    nameInput.value = localStorage.getItem(LIVE_NAME_KEY) || "";
    nameInput.oninput = () => {
      localStorage.setItem(LIVE_NAME_KEY, nameInput.value.trim());
    };
  }
  const avatarInput = document.getElementById("liveAvatarUrl");
  if (avatarInput){
    avatarInput.value = localStorage.getItem(LIVE_AVATAR_KEY) || "";
    avatarInput.oninput = () => {
      localStorage.setItem(LIVE_AVATAR_KEY, avatarInput.value.trim());
    };
  }
  const shareBtn = document.getElementById("liveShareBtn");
  const stopBtn = document.getElementById("liveStopBtn");
  if (shareBtn) shareBtn.onclick = startLiveSharing;
  if (stopBtn) stopBtn.onclick = stopLiveSharing;

  liveMap = L.map("liveMap");
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  }).addTo(liveMap);
  const center = stops[0] ? [stops[0].lat, stops[0].lon] : [52.52, 13.405];
  liveMap.setView(center, 13);

  loadLiveLocations();
  setInterval(loadLiveLocations, 30000);

  if (liveChannel) liveChannel.unsubscribe();
  liveChannel = sb.channel("live-locations")
    .on("postgres_changes", { event: "*", schema: "public", table: LIVE_TABLE }, payload => {
      if (payload.eventType === "DELETE") removeLiveEntry(payload.old?.id);
      else upsertLiveEntry(payload.new);
    })
    .subscribe();
}

function setupInstallPrompt(){
  const modal = document.getElementById("installPrompt");
  if (!modal) return;
  if (localStorage.getItem(INSTALL_PROMPT_KEY) === "true") return;
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
  if (isStandalone) return;

  const installBtn = document.getElementById("installBtn");
  const dismissBtn = document.getElementById("installDismiss");
  const iosBox = document.getElementById("installIos");
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  let deferredPrompt;

  const showModal = () => {
    modal.classList.remove("hidden");
    document.body.classList.add("modalOpen");
  };
  const hideModal = () => {
    modal.classList.add("hidden");
    document.body.classList.remove("modalOpen");
    localStorage.setItem(INSTALL_PROMPT_KEY, "true");
  };

  if (dismissBtn) dismissBtn.onclick = hideModal;

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (!isIOS && installBtn){
      installBtn.classList.remove("hidden");
      showModal();
    }
  });

  if (installBtn){
    installBtn.onclick = async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      hideModal();
    };
  }

  if (isIOS && iosBox){
    iosBox.classList.remove("hidden");
    setTimeout(showModal, 800);
  }
}

function setCommitRef(){
  const el = document.getElementById("commitRef");
  if (el) el.textContent = `Commit: ${COMMIT_REF}`;
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

  initLive();
  setupInstallPrompt();
  setCommitRef();

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
  document.getElementById("closeDetail").onclick = closeDetail;

  // auto-save render
  save();
}

init();
