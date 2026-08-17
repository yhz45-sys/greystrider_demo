const form = document.querySelector("#placeForm");
const cityInput = document.querySelector("#cityInput");
const startInput = document.querySelector("#startInput");
const endInput = document.querySelector("#endInput");
const candidateInputs = document.querySelector("#candidateInputs");
const addPlaceBtn = document.querySelector("#addPlaceBtn");
const mapCanvas = document.querySelector("#mapCanvas");
const selectedCount = document.querySelector("#selectedCount");
const buildRouteBtn = document.querySelector("#buildRouteBtn");
const routeList = document.querySelector("#routeList");
const routeMeta = document.querySelector("#routeMeta");
const mapHint = document.querySelector("#mapHint");
const amapConfig = window.GREYSTRIDER_AMAP_CONFIG || {};

let places = [];
let selectedIds = new Set();
let routeSegments = [];
let activeSegmentIndex = null;
let candidateRows = [];
let candidateRowId = 0;
let mapMode = "demo";
let amap = null;
let placeSearch = null;
let walkingService = null;
let ridingService = null;
let transferService = null;
let amapMarkers = [];
let amapPolylines = [];

const fixedPositions = {
  "人民广场": { x: 48, y: 47 },
  "外滩": { x: 66, y: 43 },
  "武康路": { x: 30, y: 50 },
  "上海博物馆": { x: 46, y: 52 },
  "愚园路": { x: 36, y: 35 },
  "静安寺": { x: 39, y: 39 },
  "思南公馆": { x: 43, y: 63 },
  "新天地": { x: 52, y: 62 }
};

const modeLabels = {
  walk: "步行",
  bike: "骑行",
  transit: "公交/地铁"
};

function hashPosition(name, index) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) % 997;
  return {
    x: 18 + ((hash + index * 13) % 65),
    y: 18 + ((hash * 3 + index * 17) % 62)
  };
}

function loadAmap() {
  if (!amapConfig.jsApiKey) return Promise.reject(new Error("AMap key is missing"));
  if (window.AMap) return Promise.resolve(window.AMap);

  if (amapConfig.securityJsCode) {
    window._AMapSecurityConfig = { securityJsCode: amapConfig.securityJsCode };
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${amapConfig.jsApiKey}&plugin=AMap.PlaceSearch,AMap.Walking,AMap.Riding,AMap.Transfer`;
    script.async = true;
    script.onload = () => resolve(window.AMap);
    script.onerror = () => reject(new Error("AMap script failed to load"));
    document.head.appendChild(script);
  });
}

async function ensureRealMap(city) {
  try {
    const AMap = await loadAmap();
    if (!amap) {
      mapCanvas.classList.add("real-map");
      mapCanvas.innerHTML = "";
      amap = new AMap.Map("mapCanvas", {
        zoom: 12,
        viewMode: "2D",
        mapStyle: "amap://styles/normal"
      });
    }

    await new Promise((resolve) => {
      AMap.plugin(["AMap.PlaceSearch", "AMap.Walking", "AMap.Riding", "AMap.Transfer"], () => {
        placeSearch = new AMap.PlaceSearch({
          city,
          citylimit: true,
          pageSize: 6
        });
        walkingService = new AMap.Walking();
        ridingService = new AMap.Riding();
        transferService = new AMap.Transfer({
          city,
          cityd: city,
          policy: AMap.TransferPolicy?.LEAST_TIME,
          extensions: "all"
        });
        resolve();
      });
    });

    mapMode = "amap";
    return true;
  } catch (error) {
    console.warn(error);
    mapMode = "demo";
    mapCanvas.classList.remove("real-map");
    return false;
  }
}

function searchPoi(name, city) {
  return new Promise((resolve) => {
    if (!placeSearch) {
      resolve(null);
      return;
    }

    placeSearch.setCity(city);
    placeSearch.search(name, (status, result) => {
      const poi = result?.poiList?.pois?.[0];
      if (status === "complete" && poi?.location) {
        resolve({
          lng: poi.location.lng,
          lat: poi.location.lat,
          address: poi.address || poi.name,
          matchedName: poi.name || name
        });
        return;
      }
      resolve(null);
    });
  });
}

function addCandidateRow(value = "", poi = null) {
  candidateRows.push({
    id: `place-row-${candidateRowId}`,
    value,
    poi
  });
  candidateRowId += 1;
  renderCandidateInputs();
}

function removeCandidateRow(id) {
  if (candidateRows.length <= 1) return;
  candidateRows = candidateRows.filter((row) => row.id !== id);
  renderCandidateInputs();
}

function updateCandidateRow(id, patch) {
  candidateRows = candidateRows.map((row) => (row.id === id ? { ...row, ...patch } : row));
}

function renderCandidateInputs() {
  candidateInputs.innerHTML = "";
  candidateRows.forEach((row, index) => {
    const item = document.createElement("div");
    item.className = "candidate-row";
    item.innerHTML = `
      <div class="search-box">
        <input class="candidate-search" type="text" value="${escapeHtml(row.value)}" placeholder="搜索地点，例如 武康路" autocomplete="off" data-row-id="${row.id}" />
        <div class="suggestion-list" data-suggestions-for="${row.id}"></div>
      </div>
      <button class="remove-place-button" type="button" aria-label="删除候选地点" ${candidateRows.length <= 1 ? "disabled" : ""}>-</button>
    `;

    const input = item.querySelector(".candidate-search");
    const suggestions = item.querySelector(".suggestion-list");
    const removeButton = item.querySelector(".remove-place-button");

    input.addEventListener("input", () => {
      updateCandidateRow(row.id, { value: input.value, poi: null });
      queueSuggestions(row.id, input.value, suggestions);
    });
    input.addEventListener("focus", () => queueSuggestions(row.id, input.value, suggestions));
    removeButton.addEventListener("click", () => removeCandidateRow(row.id));
    candidateInputs.appendChild(item);

    if (index === candidateRows.length - 1 && !row.value) input.focus();
  });
}

const suggestionTimers = new Map();

function queueSuggestions(rowId, keyword, container) {
  const trimmed = keyword.trim();
  window.clearTimeout(suggestionTimers.get(rowId));
  if (!trimmed) {
    container.innerHTML = "";
    container.classList.remove("active");
    return;
  }
  const timer = window.setTimeout(() => showSuggestions(rowId, trimmed, container), 260);
  suggestionTimers.set(rowId, timer);
}

async function showSuggestions(rowId, keyword, container) {
  const city = cityInput.value.trim() || "当前城市";
  const hasRealMap = await ensureRealMap(city);
  if (!hasRealMap || !placeSearch) {
    container.innerHTML = `<button type="button" class="suggestion-option"><strong>${escapeHtml(keyword)}</strong><span>使用当前输入</span></button>`;
    container.classList.add("active");
    container.querySelector("button").addEventListener("click", () => chooseSuggestion(rowId, { name: keyword }));
    return;
  }

  placeSearch.setCity(city);
  placeSearch.search(keyword, (status, result) => {
    const pois = status === "complete" ? result?.poiList?.pois?.slice(0, 6) || [] : [];
    const options = ensureMinimumSuggestions(
      pois.length
        ? pois.map((poi) => ({
          name: poi.name,
          address: poi.address || poi.type || city,
          lng: poi.location?.lng,
          lat: poi.location?.lat
        }))
        : [{ name: keyword, address: "使用当前输入" }],
      keyword,
      city
    );

    container.innerHTML = options
      .map(
        (option, index) => `
          <button type="button" class="suggestion-option" data-index="${index}">
            <strong>${escapeHtml(option.name)}</strong>
            <span>${escapeHtml(option.address || "")}</span>
          </button>
        `
      )
      .join("");
    container.classList.add("active");
    container.querySelectorAll(".suggestion-option").forEach((button, index) => {
      button.addEventListener("click", () => chooseSuggestion(rowId, options[index]));
    });
  });
}

function ensureMinimumSuggestions(options, keyword, city) {
  const seen = new Set();
  const normalized = [];
  options.forEach((option) => {
    const key = `${option.name}-${option.address}`;
    if (!seen.has(key)) {
      seen.add(key);
      normalized.push(option);
    }
  });

  const pads = [
    { name: keyword, address: "使用当前输入" },
    { name: `${city}${keyword}`, address: "按城市 + 地点名搜索" },
    { name: `${keyword}附近`, address: "扩大范围搜索" }
  ];

  pads.forEach((option) => {
    const key = `${option.name}-${option.address}`;
    if (normalized.length < 3 && !seen.has(key)) {
      seen.add(key);
      normalized.push(option);
    }
  });

  return normalized.slice(0, 6);
}

function chooseSuggestion(rowId, option) {
  updateCandidateRow(rowId, {
    value: option.name,
    poi: option.lng && option.lat ? option : null
  });
  renderCandidateInputs();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function buildPlaces() {
  const city = cityInput.value.trim() || "当前城市";
  const startName = startInput.value.trim() || "起点";
  const endName = endInput.value.trim() || "终点";
  const candidates = candidateRows.map((row) => row.value.trim()).filter(Boolean);

  const fixed = [
    { id: "start", name: startName, role: "start", fixed: true },
    { id: "end", name: endName, role: "end", fixed: true }
  ];

  const candidatePlaces = candidates.map((name, index) => ({
    id: `candidate-${index}`,
    name,
    role: "candidate",
    fixed: false,
    selectedPoi: candidateRows.find((row) => row.value.trim() === name)?.poi || null
  }));

  const draftPlaces = [...fixed, ...candidatePlaces].map((place, index) => ({
    ...place,
    city,
    ...(fixedPositions[place.name] || hashPosition(place.name, index))
  }));

  selectedIds = new Set();
  routeSegments = [];
  activeSegmentIndex = null;
  routeMeta.textContent = "正在定位地点";
  mapHint.textContent = "正在调用高德地图搜索地点位置...";

  const hasRealMap = await ensureRealMap(city);
  if (hasRealMap) {
    places = await Promise.all(
      draftPlaces.map(async (place) => {
        const poi = place.selectedPoi || (await searchPoi(place.name, city));
        return {
          ...place,
          ...poi,
          resolved: Boolean(poi)
        };
      })
    );
  } else {
    places = draftPlaces.map((place) => ({ ...place, resolved: false }));
  }

  render();
}

function distance(a, b) {
  if (a.lng && a.lat && b.lng && b.lat) {
    const lngScale = Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
    const dx = (a.lng - b.lng) * 111 * lngScale;
    const dy = (a.lat - b.lat) * 111;
    return Math.hypot(dx, dy);
  }
  return Math.hypot(a.x - b.x, a.y - b.y) / 9;
}

function chooseMode(distanceScore) {
  if (distanceScore <= 1.2) return "walk";
  if (distanceScore <= 3.5) return "bike";
  return "transit";
}

function estimateSegment(from, to) {
  const distanceKm = Math.max(0.4, distance(from, to));
  const mode = chooseMode(distanceKm);
  const speed = mode === "walk" ? 4.6 : mode === "bike" ? 12 : 18;
  const minutes = Math.round((distanceKm / speed) * 60 + (mode === "transit" ? 8 : 2));

  return {
    from,
    to,
    mode,
    distanceKm: distanceKm.toFixed(1),
    minutes,
    path: buildFallbackPath(from, to),
    steps: buildSteps(from, to, mode, minutes)
  };
}

function buildSteps(from, to, mode, minutes) {
  if (mode === "walk") {
    return [
      { type: "start", title: from.name },
      { type: "walk", title: `步行约 ${Math.max(260, Math.round(minutes * 55))} 米` },
      { type: "end", title: to.name }
    ];
  }
  if (mode === "bike") {
    return [
      { type: "start", title: from.name },
      { type: "bike", title: `骑行约 ${Math.max(700, Math.round(minutes * 180))} 米` },
      { type: "end", title: to.name }
    ];
  }
  const lineNumber = pickTransitLine(from.name, to.name);
  const stations = Math.max(2, Math.round(minutes / 7));
  return [
    { type: "station", title: `${nearestStationName(from.name)}站进站（入口信息待高德返回）` },
    { type: "station", title: `${lineNumber} · ${nearestStationName(to.name)}方向 · 乘坐 ${stations} 站` },
    { type: "station", title: `${nearestStationName(to.name)}站出站（出口信息待高德返回）` },
    { type: "end", title: to.name }
  ];
}

function pickTransitLine(fromName, toName) {
  const lines = ["1号线", "2号线", "10号线", "12号线", "14号线"];
  let hash = 0;
  for (const char of `${fromName}${toName}`) hash += char.charCodeAt(0);
  return lines[hash % lines.length];
}

function nearestStationName(placeName) {
  return placeName.replace(/(路|馆|寺|公馆|天地|广场|滩)$/u, "") || placeName;
}

function buildFallbackPath(from, to) {
  if (!from.lng || !from.lat || !to.lng || !to.lat) return [];
  return [
    [from.lng, from.lat],
    [to.lng, to.lat]
  ];
}

function collectStepPath(steps = []) {
  return steps.flatMap((step) => {
    const directPath = normalizePath(step.path || step.polyline || []);
    if (directPath.length) return directPath;
    return (step.tmcs || []).flatMap((tmc) => normalizePath(tmc.path || tmc.polyline || []));
  });
}

function normalizePath(path = []) {
  const points = typeof path === "string" ? path.split(";") : Array.isArray(path) ? path.flat(Infinity) : [path];
  if (Array.isArray(path) && path.some((point) => Array.isArray(point) && point.length >= 2)) {
    return path
      .map((point) => normalizeCoordinate(point))
      .filter(Boolean);
  }
  return points
    .map((point) => {
      return normalizeCoordinate(point);
    })
    .filter(Boolean);
}

function normalizeCoordinate(point) {
  let coordinate = null;
  if (Array.isArray(point) && point.length >= 2) coordinate = [Number(point[0]), Number(point[1])];
  if (typeof point === "string" && point.includes(",")) coordinate = point.split(",").slice(0, 2).map(Number);
  if (point && typeof point === "object") {
    const lng = typeof point.getLng === "function" ? point.getLng() : point.lng;
    const lat = typeof point.getLat === "function" ? point.getLat() : point.lat;
    if (lng !== undefined && lat !== undefined) coordinate = [Number(lng), Number(lat)];
  }
  return coordinate?.every(Number.isFinite) ? coordinate : null;
}

async function buildRoute() {
  const start = places.find((place) => place.role === "start");
  const end = places.find((place) => place.role === "end");
  const targets = places.filter((place) => selectedIds.has(place.id));
  const ordered = [];
  let current = start;
  const remaining = [...targets];

  while (remaining.length) {
    remaining.sort((a, b) => distance(current, a) - distance(current, b));
    const next = remaining.shift();
    ordered.push(next);
    current = next;
  }

  const fullRoute = [start, ...ordered, end];
  routeSegments = [];
  activeSegmentIndex = null;
  routeMeta.textContent = "正在生成路线";
  buildRouteBtn.disabled = true;
  for (let index = 0; index < fullRoute.length - 1; index += 1) {
    routeSegments.push(await enrichSegment(estimateSegment(fullRoute[index], fullRoute[index + 1])));
  }
  render();
}

async function enrichSegment(segment) {
  if (mapMode !== "amap" || !segment.from.lng || !segment.to.lng) return segment;
  const origin = [segment.from.lng, segment.from.lat];
  const destination = [segment.to.lng, segment.to.lat];

  try {
    if (segment.mode === "walk" && walkingService) {
      const result = await searchRoute(walkingService, origin, destination);
      const route = result?.routes?.[0];
      if (route?.steps?.length) {
        return {
          ...segment,
          minutes: Math.max(1, Math.round((route.time || segment.minutes * 60) / 60)),
          distanceKm: ((route.distance || Number(segment.distanceKm) * 1000) / 1000).toFixed(1),
          path: collectStepPath(route.steps),
          steps: [
            { type: "start", title: segment.from.name },
            ...route.steps.slice(0, 5).map((step) => ({ type: "walk", title: cleanInstruction(step.instruction) })),
            { type: "end", title: segment.to.name }
          ]
        };
      }
    }

    if (segment.mode === "bike" && ridingService) {
      const result = await searchRoute(ridingService, origin, destination);
      const route = result?.routes?.[0];
      if (route?.rides?.length) {
        return {
          ...segment,
          minutes: Math.max(1, Math.round((route.time || segment.minutes * 60) / 60)),
          distanceKm: ((route.distance || Number(segment.distanceKm) * 1000) / 1000).toFixed(1),
          path: collectStepPath(route.rides),
          steps: [
            { type: "start", title: segment.from.name },
            ...route.rides.slice(0, 5).map((step) => ({ type: "bike", title: cleanInstruction(step.instruction) })),
            { type: "end", title: segment.to.name }
          ]
        };
      }
    }

    if (segment.mode === "transit" && transferService) {
      const result = await searchRoute(transferService, origin, destination);
      const plan = result?.plans?.[0];
      if (plan?.segments?.length) {
        return {
          ...segment,
          minutes: Math.max(1, Math.round((plan.time || segment.minutes * 60) / 60)),
          distanceKm: ((plan.distance || Number(segment.distanceKm) * 1000) / 1000).toFixed(1),
          path: collectTransferPath(plan),
          steps: parseTransferSteps(segment, plan)
        };
      }
    }
  } catch (error) {
    console.warn(error);
  }
  return segment;
}

function collectTransferPath(plan) {
  const path = [];
  plan.segments?.forEach((part) => {
    path.push(...collectStepPath(part.walking?.steps || []));
    path.push(...normalizePath(part.transit?.path || part.bus?.path || []));
    getTransitLines(part).forEach((line) => {
      path.push(...normalizePath(line.path || line.polyline || []));
    });
  });
  return path;
}

function searchRoute(service, origin, destination) {
  return new Promise((resolve, reject) => {
    service.search(origin, destination, (status, result) => {
      if (status === "complete") {
        resolve(result);
      } else {
        reject(result);
      }
    });
  });
}

function parseTransferSteps(segment, plan) {
  const steps = [];
  const rides = plan.segments.slice(0, 10).flatMap((part) => {
    const transit = part.transit || part.bus || {};
    const line = getTransitLines(part)[0];
    if (!line) return [];

    const departureStop = transit.on_station || transit.onStation || line.departure_stop || line.departureStop;
    const arrivalStop = transit.off_station || transit.offStation || line.arrival_stop || line.arrivalStop;
    const departure = readName(departureStop, "上车站");
    const arrival = readName(arrivalStop, "下车站");
    return [{
      departure,
      arrival,
      lineName: cleanTransitLineName(readName(line, "公共交通")),
      direction: getTransitDirection(line, arrival),
      stopCount: getTransitStopCount(transit, line),
      entrance: readStationPort(transit.entrance, part.entrance),
      exit: readStationPort(transit.exit, part.exit)
    }];
  });

  rides.forEach((ride, index) => {
    const isFirst = index === 0;
    const isLast = index === rides.length - 1;

    if (isFirst) {
      steps.push({
        type: "station",
        title: ride.entrance
          ? `${ride.departure}站（${ride.entrance}）进站`
          : `${ride.departure}站进站（入口信息未返回）`
      });
    }
    steps.push({
      type: "station",
      title: `${ride.lineName} · ${ride.direction}方向 · 乘坐 ${ride.stopCount} 站`
    });
    if (isLast) {
      steps.push({
        type: "station",
        title: ride.exit
          ? `${ride.arrival}站（${ride.exit}）出站`
          : `${ride.arrival}站出站（出口信息未返回）`
      });
    } else {
      steps.push({ type: "transfer", title: `${ride.arrival}站下车换乘` });
    }
  });
  steps.push({ type: "end", title: segment.to.name });
  return steps.length > 1 ? steps : buildSteps(segment.from, segment.to, "transit", segment.minutes);
}

function getTransitDirection(line, fallback) {
  const lineName = readName(line, "");
  const terminals = lineName.match(/\(([^()]*)\s*(?:--|—|－|至)\s*([^()]*)\)/u);
  return (
    readName(line.end_stop || line.endStop, "") ||
    cleanDirection(line.direction) ||
    terminals?.[2]?.trim() ||
    fallback
  );
}

function getTransitLines(part) {
  const transit = part.transit || part.bus || {};
  const lines = transit.lines || transit.buslines || transit.busLines || part.lines || [];
  return Array.isArray(lines) ? lines : lines ? [lines] : [];
}

function readName(value, fallback = "") {
  if (!value) return fallback;
  if (typeof value === "string") return value.trim() || fallback;
  return String(value.name || value.title || value.alias || fallback).trim();
}

function cleanTransitLineName(name) {
  return String(name || "公共交通")
    .replace(/\([^)]*(?:上行|下行|方向|开往|--|—)[^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanDirection(direction) {
  return String(direction || "")
    .replace(/^(?:往|开往)/, "")
    .replace(/方向$/, "")
    .trim();
}

function getTransitStopCount(transit, line) {
  const viaCount = Number(transit.via_num ?? transit.viaNum);
  if (Number.isFinite(viaCount) && viaCount >= 0) return viaCount + 1;
  const viaStops = transit.via_stops || transit.viaStops || line.via_stops || line.viaStops;
  if (Array.isArray(viaStops)) return viaStops.length + 1;
  const explicit = Number(line.stop_count ?? line.stopCount);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  return "若干";
}

function readStationPort(...values) {
  for (const value of values) {
    const items = Array.isArray(value) ? value : [value];
    for (const item of items) {
      const text = readName(item, typeof item === "string" ? item : "");
      if (!text) continue;
      const port = text.match(/[A-Za-z0-9一二三四五六七八九十]+号?口/u)?.[0];
      return port || text;
    }
  }
  return "";
}

function cleanInstruction(instruction) {
  return String(instruction || "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function render() {
  renderMap();
  renderSummary();
  renderRoute();
}

function renderMap() {
  if (mapMode === "amap" && amap) {
    renderAmap();
    return;
  }
  renderDemoMap();
}

function renderAmap() {
  clearAmapOverlays();
  places.forEach((place) => drawAmapMarker(place));
  drawAmapRoute();

  const visibleOverlays = amapPolylines.length ? amapPolylines : amapMarkers;
  if (visibleOverlays.length) {
    amap.setFitView(visibleOverlays, false, [70, 70, 70, 70]);
  }
}

function clearAmapOverlays() {
  if (amapMarkers.length) amap.remove(amapMarkers);
  if (amapPolylines.length) amap.remove(amapPolylines);
  amapMarkers = [];
  amapPolylines = [];
}

function drawAmapMarker(place) {
  if (!place.lng || !place.lat) return;
  const isSelected = selectedIds.has(place.id);
  const marker = new AMap.Marker({
    position: [place.lng, place.lat],
    title: place.name,
    content: `
      <button class="amap-place-marker ${place.fixed ? "fixed" : ""} ${isSelected ? "selected" : ""}" type="button">
        <span><i>${place.role === "start" ? "起" : place.role === "end" ? "终" : isSelected ? "✓" : "+"}</i></span>
        <b>${escapeHtml(place.name)}</b>
      </button>
    `,
    offset: new AMap.Pixel(-42, -54),
    zIndex: place.fixed ? 120 : isSelected ? 110 : 100
  });

  marker.on("click", () => {
    if (place.fixed) return;
    if (selectedIds.has(place.id)) {
      selectedIds.delete(place.id);
    } else {
      selectedIds.add(place.id);
    }
    routeSegments = [];
    activeSegmentIndex = null;
    render();
  });
  marker.setMap(amap);
  amapMarkers.push(marker);
}

function drawAmapRoute() {
  const segment = routeSegments[activeSegmentIndex];
  if (!segment) return;
  const path = segment.path?.length ? segment.path : buildFallbackPath(segment.from, segment.to);
  if (!path.length) return;
  const polyline = new AMap.Polyline({
    path,
    strokeColor: getRouteColor(segment.mode),
    strokeWeight: segment.mode === "transit" ? 8 : 7,
    strokeOpacity: 0.96,
    isOutline: true,
    outlineColor: "#ffffff",
    borderWeight: 3,
    lineJoin: "round",
    showDir: true
  });
  polyline.setMap(amap);
  amapPolylines.push(polyline);
}

function getRouteColor(mode) {
  if (mode === "bike") return "#bf8a13";
  if (mode === "transit") return "#3267c6";
  return "#147d7e";
}

function renderDemoMap() {
  mapCanvas.innerHTML = "";
  const activeSegment = routeSegments[activeSegmentIndex];
  if (activeSegment) drawLine(activeSegment.from, activeSegment.to);
  places.forEach((place) => drawMarker(place));
}

function drawLine(from, to) {
  const line = document.createElement("div");
  const x1 = from.x;
  const y1 = from.y;
  const x2 = to.x;
  const y2 = to.y;
  const length = Math.hypot(x2 - x1, y2 - y1);
  const angle = Math.atan2(y2 - y1, x2 - x1) * (180 / Math.PI);
  line.className = "route-line";
  line.style.left = `${x1}%`;
  line.style.top = `${y1}%`;
  line.style.width = `${length}%`;
  line.style.transform = `rotate(${angle}deg)`;
  mapCanvas.appendChild(line);
}

function drawMarker(place) {
  const marker = document.createElement("button");
  const isSelected = selectedIds.has(place.id);
  marker.className = `place-marker ${place.fixed ? "fixed" : ""} ${isSelected ? "selected" : ""}`;
  marker.type = "button";
  marker.style.left = `${place.x}%`;
  marker.style.top = `${place.y}%`;
  marker.disabled = place.fixed;
  marker.setAttribute("aria-label", place.fixed ? place.name : `选择 ${place.name}`);
  marker.innerHTML = `
    <span class="pin"><span>${place.role === "start" ? "起" : place.role === "end" ? "终" : isSelected ? "✓" : "+"}</span></span>
    <span class="place-name">${escapeHtml(place.name)}</span>
  `;
  marker.addEventListener("click", () => {
    if (selectedIds.has(place.id)) {
      selectedIds.delete(place.id);
    } else {
      selectedIds.add(place.id);
    }
    routeSegments = [];
    activeSegmentIndex = null;
    render();
  });
  mapCanvas.appendChild(marker);
}

function renderSummary() {
  selectedCount.textContent = selectedIds.size;
  buildRouteBtn.disabled = selectedIds.size === 0;
  const unresolvedCount = places.filter((place) => mapMode === "amap" && !place.resolved).length;
  if (unresolvedCount) {
    mapHint.textContent = `已定位 ${places.length - unresolvedCount} 个地点，${unresolvedCount} 个地点未匹配到，可修改名称后重试。`;
    return;
  }
  mapHint.textContent = selectedIds.size
    ? `已选择 ${selectedIds.size} 个地点，可继续调整或确认生成路线。`
    : mapMode === "amap"
      ? "真实地图已加载，点击候选地点进行选择，起点和终点已固定。"
      : "当前为离线演示地图，点击候选地点进行选择。";
}

function renderRoute() {
  routeList.innerHTML = "";
  if (!routeSegments.length) {
    routeMeta.textContent = selectedIds.size ? "可生成路线" : "等待选择地点";
    return;
  }

  const totalMinutes = routeSegments.reduce((sum, segment) => sum + segment.minutes, 0);
  const totalDistance = routeSegments.reduce((sum, segment) => sum + Number(segment.distanceKm), 0);
  routeMeta.textContent = `${routeSegments.length} 段 · 约 ${totalMinutes} 分钟 · ${totalDistance.toFixed(1)} km`;

  routeSegments.forEach((segment, index) => {
    const item = document.createElement("li");
    const detail = document.createElement("details");
    detail.className = "route-step";
    detail.dataset.segmentIndex = String(index);
    detail.innerHTML = `
      <summary>
        <span>
          <span class="segment-title">${index + 1}. ${segment.from.name} -> ${segment.to.name}</span>
          <span class="segment-meta">${segment.distanceKm} km · 约 ${segment.minutes} 分钟</span>
        </span>
        <span class="mode-badge mode-${segment.mode}">${modeLabels[segment.mode]}</span>
      </summary>
      ${renderSegmentDetail(segment)}
    `;
    detail.addEventListener("toggle", () => {
      if (detail.open) {
        activeSegmentIndex = index;
        routeList.querySelectorAll("details.route-step").forEach((other) => {
          if (other !== detail) other.open = false;
        });
      } else if (activeSegmentIndex === index) {
        activeSegmentIndex = null;
      }
      renderMap();
    });
    item.appendChild(detail);
    routeList.appendChild(item);
  });
}

function renderSegmentDetail(segment) {
  const modeIntro =
    segment.mode === "transit"
      ? `<div class="route-overview"><strong>推荐方案</strong><span>${segment.minutes} 分钟 · ${segment.distanceKm} km</span></div>`
      : `<div class="route-overview"><strong>地图高亮</strong><span>${modeLabels[segment.mode]}路线已在右侧地图高亮展示</span></div>`;

  return `
    <div class="segment-detail">
      ${modeIntro}
      <div class="route-timeline ${segment.mode === "transit" ? "transit-timeline" : ""}">
        ${segment.steps.map((step) => renderTimelineStep(step, segment.mode)).join("")}
      </div>
    </div>
  `;
}

function renderTimelineStep(step, mode) {
  const iconMap = {
    start: "起",
    end: "终",
    walk: "走",
    bike: "骑",
    station: "站",
    transfer: "换"
  };
  const lineClass = step.type === "station" || mode === "transit" ? "rail" : mode;
  return `
    <div class="timeline-step ${lineClass}">
      <span class="timeline-icon">${iconMap[step.type] || "•"}</span>
      <div>
        <strong>${escapeHtml(step.title)}</strong>
      </div>
    </div>
  `;
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  buildPlaces();
});

buildRouteBtn.addEventListener("click", buildRoute);
addPlaceBtn.addEventListener("click", () => addCandidateRow());

["武康路", "上海博物馆", "愚园路"].forEach((name) => addCandidateRow(name));
buildPlaces();
