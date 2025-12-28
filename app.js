const LS_KEY = "spatiCrawlCompleted_v1";
const LS_CURRENT_KEY = "spatiCrawlCurrentStop_v1";
// Requires a Supabase table: live_locations (id uuid, username text, avatar_url text, lat float, lon float, accuracy float, seen_at timestamptz).
const LIVE_TABLE = "live_locations";
const LIVE_ID_KEY = "liveLocationId_v1";
const LIVE_NAME_KEY = "liveLocationName_v1";
const LIVE_AVATAR_KEY = "liveLocationAvatar_v1";
const LIVE_ONBOARD_KEY = "liveOnboardComplete_v1";
const LIVE_MAX_AGE_MS = 2 * 60 * 60 * 1000;
// Requires table: client_logs (level text, message text, extra jsonb, url text, user_agent text, username text, stop_id text, created_at timestamptz).
const LOG_TABLE = "client_logs";
let currentStopId = localStorage.getItem(LS_CURRENT_KEY) || null;

let currentStopForFeedId = null;

const SUPABASE_URL = "https://exvhwgkhgogeiqhwlvxz.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV4dmh3Z2toZ29nZWlxaHdsdnh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY4MjE2MjgsImV4cCI6MjA4MjM5NzYyOH0.v9vDjrKQQRVX1d0rvku1G9O-xBeU4Veq_r72FyXaUPg";
const COMMIT_REF = "d31e918";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
console.log("Supabase connected:", sb);

let stops = [];
let completed = new Set(JSON.parse(localStorage.getItem(LS_KEY) || "[]"));

let map;
let markers = new Map();
let routeLine;
let postPins = L.layerGroup();
let liveMap;
let liveMarkers = new Map();
let liveEntries = new Map();
let liveWatchId = null;
let liveLastSentAt = 0;
let liveLastSentPos = null;
let liveChannel;
let feedChannel;
let mediaChannel;
let commentsChannel;
let feedCache = [];
let isPosting = false;
let commentsByKey = new Map();
let logQueue = [];
let logFlushTimer = null;
let isFlushingLogs = false;

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

  title.textContent = "Feed";
  sub.textContent = "Everyone's latest posts across all stops.";

  // Ensure buttons post/upload to the current stop
  document.getElementById("postBtn").onclick = () => createPost(currentStopForFeedId);
  const postInput = document.getElementById("postMessage");
  if (postInput){
    postInput.onkeydown = (e) => {
      if (e.key === "Enter"){
        e.preventDefault();
        createPost(currentStopForFeedId);
      }
    };
  }
  const togglePins = document.getElementById("togglePostPins");
  if (togglePins){
    togglePins.onchange = () => loadFeedAll();
  }
  const mediaClose = document.getElementById("mediaClose");
  if (mediaClose) mediaClose.onclick = closeMediaModal;
}

async function uploadMedia(stopId, message){
  const fileInput = document.getElementById("postMedia");
  const file = fileInput?.files?.[0];
  if (!file) return null;

  const username = (document.getElementById("username")?.value || "").trim() || getLiveName();
  const caption = (message || "").trim();

  const isVideo = file.type.startsWith("video/");
  const mediaType = isVideo ? "video" : "image";

  const ext = file.name.split(".").pop() || (isVideo ? "mp4" : "jpg");
  const path = `${stopId}/${crypto.randomUUID()}.${ext}`;

  const { error: upErr } = await sb.storage.from("media").upload(path, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type
  });
  if (upErr) { console.error(upErr); alert("Upload failed"); return null; }

  const { data } = sb.storage.from("media").getPublicUrl(path);
  const mediaUrl = data.publicUrl;

  const { error: insErr } = await sb.from("media_posts").insert({
    stop_id: stopId,
    username,
    caption,
    media_url: mediaUrl,
    media_type: mediaType
  });
  if (insErr) { console.error(insErr); alert("Save failed"); return null; }

  fileInput.value = "";
  return mediaUrl;
}

function subscribeToFeed(){
  if (feedChannel) feedChannel.unsubscribe();
  if (mediaChannel) mediaChannel.unsubscribe();
  if (commentsChannel) commentsChannel.unsubscribe();

  feedChannel = sb
    .channel("posts-all")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "posts" },
      () => loadFeedAll()
    )
    .subscribe();

  mediaChannel = sb
    .channel("media-all")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "media_posts" },
      () => loadFeedAll()
    )
    .subscribe();

  commentsChannel = sb
    .channel("comments-all")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "comments" },
      () => loadFeedAll()
    )
    .subscribe();
}

async function loadFeedAll(){
  const [postsRes, mediaRes] = await Promise.all([
    sb
      .from("posts")
      .select("id,stop_id,username,message,created_at,lat,lon")
      .order("created_at", { ascending: false })
      .limit(50),
    sb
      .from("media_posts")
      .select("id,stop_id,username,caption,media_url,media_type,created_at")
      .order("created_at", { ascending: false })
      .limit(50)
  ]);

  if (postsRes.error) { console.error(postsRes.error); return; }
  if (mediaRes.error) { console.error(mediaRes.error); return; }

  const posts = postsRes.data.map(item => ({ ...item, kind: "post" }));
  const media = mediaRes.data.map(item => ({ ...item, kind: "media" }));
  feedCache = [...posts, ...media].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  await loadCommentsForItems(feedCache);
  renderFeedStream(feedCache);
  renderPostPins(posts);
}

async function loadCommentsForItems(items){
  commentsByKey.clear();
  if (!items.length) return;
  const postIds = items.filter(i => i.kind === "post").map(i => i.id);
  const mediaIds = items.filter(i => i.kind === "media").map(i => i.id);

  const requests = [];
  if (postIds.length){
    requests.push(
      sb
        .from("comments")
        .select("id,target_type,target_id,username,message,created_at")
        .eq("target_type", "post")
        .in("target_id", postIds)
        .order("created_at", { ascending: true })
    );
  }
  if (mediaIds.length){
    requests.push(
      sb
        .from("comments")
        .select("id,target_type,target_id,username,message,created_at")
        .eq("target_type", "media")
        .in("target_id", mediaIds)
        .order("created_at", { ascending: true })
    );
  }

  const results = await Promise.all(requests);
  for (const res of results){
    if (res.error){ console.error(res.error); continue; }
    res.data.forEach(c => {
      const key = `${c.target_type}:${c.target_id}`;
      if (!commentsByKey.has(key)) commentsByKey.set(key, []);
      commentsByKey.get(key).push(c);
    });
  }
}

async function createComment(stopId, targetType, targetId, input){
  const message = (input?.value || "").trim();
  if (!message) return;
  const username = getLiveName() || "anonymous";
  const { error } = await sb.from("comments").insert({
    stop_id: stopId,
    target_type: targetType,
    target_id: targetId,
    username,
    message
  });
  if (error){ console.error(error); return; }
  input.value = "";
  await loadCommentsForItems(feedCache);
  renderFeedStream(feedCache);
}

function renderFeedStream(items){
  const wrap = document.getElementById("feedStream");
  if (!wrap) return;
  if (!items.length){
    wrap.innerHTML = "<div class=\"muted\">No posts yet.</div>";
    return;
  }
  wrap.innerHTML = "";
  items.forEach(item => {
    const div = document.createElement("div");
    div.className = "feedItem";
    const who = item.username?.trim() ? item.username.trim() : "anonymous";
    const when = new Date(item.created_at).toLocaleString();
    const message = item.kind === "post" ? item.message : item.caption;
    div.innerHTML = `
      <div class="feedMeta">${who} · ${when}</div>
      ${message ? `<div>${escapeHtml(message)}</div>` : ""}
    `;
    if (item.kind === "media" && item.media_url){
      const isVideo = item.media_type === "video";
      const wrap = document.createElement("div");
      wrap.className = "feedMediaWrap";
      const mediaEl = document.createElement(isVideo ? "video" : "img");
      mediaEl.className = "feedMedia";
      if (isVideo){
        mediaEl.src = item.media_url;
        mediaEl.controls = false;
        mediaEl.playsInline = true;
        mediaEl.muted = true;
        mediaEl.preload = "metadata";
        mediaEl.addEventListener("loadedmetadata", () => {
          if (mediaEl.duration && mediaEl.duration > 0.2) {
            mediaEl.currentTime = 0.1;
          }
        });
        mediaEl.addEventListener("seeked", () => {
          mediaEl.pause();
        });
      } else {
        mediaEl.src = item.media_url;
        mediaEl.loading = "lazy";
      }
      const openFull = (e) => {
        if (e) e.preventDefault();
        if (isVideo) mediaEl.pause();
        openMediaModal(item.media_url, item.media_type);
      };
      wrap.onclick = openFull;
      if (isVideo){
        mediaEl.onplay = openFull;
      }
      wrap.appendChild(mediaEl);
      if (isVideo){
        const playBadge = document.createElement("div");
        playBadge.className = "feedPlay";
        playBadge.textContent = "▶";
        wrap.appendChild(playBadge);
      }
      div.appendChild(wrap);
    }

    const commentKey = `${item.kind}:${item.id}`;
    const comments = commentsByKey.get(commentKey) || [];
    const commentWrap = document.createElement("div");
    commentWrap.className = "commentWrap";
    comments.forEach(c => {
      const row = document.createElement("div");
      row.className = "commentRow";
      const cWho = c.username?.trim() ? c.username.trim() : "anonymous";
      const cWhen = new Date(c.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      row.innerHTML = `
        <div class="commentMeta">${cWho} · ${cWhen}</div>
        <div>${escapeHtml(c.message)}</div>
      `;
      commentWrap.appendChild(row);
    });

    const form = document.createElement("div");
    form.className = "commentComposer";
    const input = document.createElement("input");
    input.placeholder = "Write a comment…";
    const btn = document.createElement("button");
    btn.className = "ghost small";
    btn.textContent = "Send";
    btn.onclick = () => createComment(item.stop_id, item.kind, item.id, input);
    input.onkeydown = (e) => {
      if (e.key === "Enter"){
        e.preventDefault();
        createComment(item.stop_id, item.kind, item.id, input);
      }
    };
    form.appendChild(input);
    form.appendChild(btn);

    div.appendChild(commentWrap);
    div.appendChild(form);
    wrap.appendChild(div);
  });
}

function openMediaModal(url, type){
  const modal = document.getElementById("mediaModal");
  const body = document.getElementById("mediaModalBody");
  if (!modal || !body) return;
  body.innerHTML = "";
  if (type === "video"){
    const video = document.createElement("video");
    video.src = url;
    video.controls = true;
    video.playsInline = true;
    video.autoplay = true;
    body.appendChild(video);
  } else {
    const img = document.createElement("img");
    img.src = url;
    body.appendChild(img);
  }
  modal.classList.remove("hidden");
  document.body.classList.add("modalOpen");
  modal.onclick = (e) => {
    if (e.target === modal) closeMediaModal();
  };
}

function closeMediaModal(){
  const modal = document.getElementById("mediaModal");
  const body = document.getElementById("mediaModalBody");
  if (!modal || !body) return;
  body.innerHTML = "";
  modal.classList.add("hidden");
  document.body.classList.remove("modalOpen");
}

async function createPost(stopId){
  if (isPosting) return;
  const username = document.getElementById("username").value || getLiveName() || "";
  const input = document.getElementById("postMessage");
  const message = input?.value || "";
  const fileInput = document.getElementById("postMedia");
  const hasFile = !!fileInput?.files?.[0];
  if (!message.trim() && !hasFile) return;

  const stopToUse = stopId || currentStopId || stops[0]?.id || null;
  if (!stopToUse){
    console.error("No stop selected for posting.");
    return;
  }

  isPosting = true;
  try {
    if (hasFile){
      await uploadMedia(stopToUse, message);
    } else if (message.trim()){
      const loc = await getPostLocation();
      const { error } = await sb.from("posts").insert({
        stop_id: stopToUse,
        username,
        message: message.trim(),
        lat: loc?.lat || null,
        lon: loc?.lon || null
      });
      if (error) { console.error(error); }
    }
    await loadFeedAll();
  } finally {
    if (input) input.value = "";
    isPosting = false;
  }
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

function shouldShowPostPins(){
  return document.getElementById("togglePostPins")?.checked;
}

function clearPostPins(){
  postPins.clearLayers();
}

function renderPostPins(posts){
  if (!shouldShowPostPins()){
    clearPostPins();
    return;
  }
  clearPostPins();
  posts.forEach(p => {
    if (p.lat == null || p.lon == null) return;
    const who = p.username?.trim() ? p.username.trim() : "anonymous";
    const when = new Date(p.created_at).toLocaleString();
    const marker = L.circleMarker([p.lat, p.lon], {
      radius: 6,
      weight: 2,
      color: "#ffffff",
      fillColor: "#b30000",
      fillOpacity: 0.85
    }).bindPopup(`<strong>${who}</strong><br>${when}<br>${escapeHtml(p.message || "")}`);
    postPins.addLayer(marker);
  });
}

async function getPostLocation(){
  if (liveLastSentPos) return liveLastSentPos;
  if (!navigator.geolocation) return null;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 8000 }
    );
  });
}

function firstIncompleteStop(){
  return stops.find(s => !completed.has(s.id)) || stops[0];
}

async function openDetail(stop){
  setCurrentStop(stop);
  await setFeedStop(stop);
  setTab("Map");

  const img = document.getElementById("dPhoto");
  if (stop.imageName) {
  img.src = `./photos/${stop.imageName}.jpg`; // change to .png if needed
  img.classList.remove("hidden");
} else {
  img.classList.add("hidden");
}
  
  const detail = document.getElementById("detail");
  detail.classList.remove("hidden");
  document.getElementById("detail")
    .scrollIntoView({ behavior: "smooth", block: "start" });

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

function syncNameInputs(){
  const name = getLiveName();
  const nameInput = document.getElementById("onboardName");
  if (nameInput && name) nameInput.value = name;
  const postName = document.getElementById("username");
  if (postName && !postName.value.trim()) postName.value = name;
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

function getLiveName(){
  return (localStorage.getItem(LIVE_NAME_KEY) || "").trim();
}

function getLiveAvatarUrl(){
  return localStorage.getItem(LIVE_AVATAR_KEY) || "";
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
  const username = getLiveName();
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

async function uploadLiveAvatar(inputId = "liveAvatarFile"){
  const input = document.getElementById(inputId);
  const file = input?.files?.[0];
  if (!file) return;

  const username = getLiveName();

  const ext = file.name.split(".").pop() || "jpg";
  const path = `avatars/${getLiveId()}/${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await sb.storage.from("media").upload(path, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type
  });
  if (upErr) { console.error(upErr); alert("Upload failed"); return; }

  const { data } = sb.storage.from("media").getPublicUrl(path);
  const avatarUrl = data.publicUrl;
  localStorage.setItem(LIVE_AVATAR_KEY, avatarUrl);

  const stopId = currentStopId || stops[0]?.id || null;
  const { error: insErr } = await sb.from("media_posts").insert({
    stop_id: stopId,
    username,
    caption: "Avatar photo",
    media_url: avatarUrl,
    media_type: "avatar"
  });
  if (insErr) { console.error(insErr); }

  const { error: liveErr } = await sb.from(LIVE_TABLE).upsert({
    id: getLiveId(),
    username: username || "Anonymous",
    avatar_url: avatarUrl,
    seen_at: new Date().toISOString()
  });
  if (liveErr) console.error(liveErr);

  input.value = "";
  upsertLiveEntry({
    id: getLiveId(),
    username: username || "Anonymous",
    avatar_url: avatarUrl,
    lat: liveLastSentPos?.lat,
    lon: liveLastSentPos?.lon,
    accuracy: null,
    seen_at: new Date().toISOString()
  });
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
  if (liveWatchId !== null) return;
  setLiveStatus("Requesting location permission...");
  return new Promise((resolve, reject) => {
    let ready = false;
    liveWatchId = navigator.geolocation.watchPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        const accuracy = pos.coords.accuracy;
        if (!shouldSendLiveUpdate(lat, lon)) return;
        liveLastSentAt = Date.now();
        liveLastSentPos = { lat, lon };
        const name = getLiveName() || "Anonymous";
        setLiveStatus(`Sharing live as ${name} · ±${Math.round(accuracy)}m`);
        const payload = await sendLiveUpdate(lat, lon, accuracy);
        if (payload) upsertLiveEntry(payload);
        if (!ready){
          ready = true;
          resolve();
        }
      },
      (err) => {
        console.error(err);
        setLiveStatus("Location error. Check permissions.");
        if (liveWatchId !== null){
          navigator.geolocation.clearWatch(liveWatchId);
          liveWatchId = null;
        }
        reject(err);
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
  });
}

async function stopLiveSharing(){
  if (liveWatchId !== null){
    navigator.geolocation.clearWatch(liveWatchId);
    liveWatchId = null;
  }
  setLiveStatus("Sharing paused.");
  const { error } = await sb.from(LIVE_TABLE).delete().eq("id", getLiveId());
  if (error) console.error(error);
}

function initLive(){
  const avatarBtn = document.getElementById("liveAvatarBtn");
  if (avatarBtn) avatarBtn.onclick = () => uploadLiveAvatar("liveAvatarFile");

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

function setupOnboarding(){
  const modal = document.getElementById("onboardModal");
  if (!modal) return;

  const nameInput = document.getElementById("onboardName");
  const avatarBtn = document.getElementById("onboardAvatarBtn");
  const continueBtn = document.getElementById("onboardContinue");
  const statusEl = document.getElementById("onboardStatus");

  const showModal = () => {
    modal.classList.remove("hidden");
    document.body.classList.add("modalOpen");
  };
  const hideModal = () => {
    modal.classList.add("hidden");
    document.body.classList.remove("modalOpen");
    localStorage.setItem(LIVE_ONBOARD_KEY, "true");
  };

  const setStatus = (msg) => {
    if (statusEl) statusEl.textContent = msg;
  };

  if (nameInput){
    nameInput.value = getLiveName();
    nameInput.oninput = () => {
      localStorage.setItem(LIVE_NAME_KEY, nameInput.value.trim());
      syncNameInputs();
    };
  }

  if (avatarBtn){
    avatarBtn.onclick = async () => {
      setStatus("Uploading avatar...");
      await uploadLiveAvatar("onboardAvatarFile");
      if (getLiveAvatarUrl()) setStatus("Avatar uploaded.");
    };
  }

  if (continueBtn){
    continueBtn.onclick = async () => {
      const name = (nameInput?.value || "").trim();
      if (!name){
        setStatus("Please enter your name.");
        return;
      }
      localStorage.setItem(LIVE_NAME_KEY, name);
      syncNameInputs();
      try {
        await startLiveSharing();
        setStatus("Location sharing enabled.");
      } catch (err){
        setStatus("Location sharing is off. You can enable it later.");
      }
      hideModal();
    };
  }

  if (nameInput){
    nameInput.onkeydown = (e) => {
      if (e.key === "Enter"){
        e.preventDefault();
        continueBtn?.click();
      }
    };
  }

  if (localStorage.getItem(LIVE_ONBOARD_KEY) === "true"){
    syncNameInputs();
    startLiveSharing().catch(() => {
      setStatus("Location sharing is off. You can enable it later.");
    });
    return;
  }

  showModal();
}

function setCommitRef(){
  const el = document.getElementById("commitRef");
  if (el) el.textContent = `Commit: ${COMMIT_REF}`;
}

function setupClientLogging(){
  const MAX_QUEUE = 20;
  const FLUSH_INTERVAL_MS = 5000;
  const MAX_PER_MIN = 20;
  let sentInWindow = 0;
  let windowStart = Date.now();

  const resetWindowIfNeeded = () => {
    const now = Date.now();
    if (now - windowStart > 60000){
      windowStart = now;
      sentInWindow = 0;
    }
  };

  const enqueue = (level, message, extra) => {
    resetWindowIfNeeded();
    if (sentInWindow >= MAX_PER_MIN) return;
    if (isFlushingLogs) return;
    const username = getLiveName() || null;
    logQueue.push({
      level,
      message,
      extra,
      url: window.location.href,
      user_agent: navigator.userAgent,
      username,
      stop_id: currentStopId || null,
      created_at: new Date().toISOString()
    });
    if (logQueue.length > MAX_QUEUE) logQueue.shift();
    if (!logFlushTimer){
      logFlushTimer = setTimeout(flushLogs, FLUSH_INTERVAL_MS);
    }
  };

  const flushLogs = async () => {
    if (!logQueue.length) return;
    if (isFlushingLogs) return;
    isFlushingLogs = true;
    const batch = logQueue.splice(0, logQueue.length);
    resetWindowIfNeeded();
    sentInWindow += batch.length;
    try {
      await sb.from(LOG_TABLE).insert(batch);
    } catch (err) {
      console.warn("Log flush failed", err);
    } finally {
      isFlushingLogs = false;
      logFlushTimer = null;
    }
  };

  window.addEventListener("error", (event) => {
    const msg = event.message || "window.error";
    enqueue("error", msg, {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      stack: event.error?.stack
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const msg = typeof reason === "string" ? reason : (reason?.message || "unhandledrejection");
    enqueue("error", msg, {
      stack: reason?.stack
    });
  });

  const origWarn = console.warn;
  console.warn = (...args) => {
    try {
      enqueue("warn", args.map(a => String(a)).join(" "), null);
    } catch {}
    origWarn.apply(console, args);
  };

  const origError = console.error;
  console.error = (...args) => {
    try {
      enqueue("error", args.map(a => String(a)).join(" "), null);
    } catch {}
    origError.apply(console, args);
  };
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
  postPins.addTo(map);

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
  setupOnboarding();
  setCommitRef();
  setupClientLogging();

  // Optional: start on Map
  setTab("Map");
  fitRoute();
  renderProgress();
  renderList();

  if (stops.length){
    const stored = currentStopId ? stops.find(s => s.id === currentStopId) : null;
    const s = stored || firstIncompleteStop();
    if (s){
      setCurrentStop(s);
      setFeedStop(s);
    }
  }
  subscribeToFeed();
  loadFeedAll();
  document.getElementById("closeDetail").onclick = closeDetail;

  // auto-save render
  save();
}

init();
