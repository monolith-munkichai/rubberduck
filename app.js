const DIRECTION_DELTAS = {
  up: [0, -86],
  down: [0, 86],
  left: [-86, 0],
  right: [86, 0],
  upLeft: [-74, -74],
  upRight: [74, -74],
  downLeft: [-74, 74],
  downRight: [74, 74],
  idle: [0, 0],
  상: [0, -86],
  하: [0, 86],
  좌: [-86, 0],
  우: [86, 0],
  상좌: [-74, -74],
  상우: [74, -74],
  하좌: [-74, 74],
  하우: [74, 74],
};

const duckElements = new Map();
const playfield = document.getElementById("playfield");
const connectionStatus = document.getElementById("connectionStatus");
const lastCommand = document.getElementById("lastCommand");
const activeDuck = document.getElementById("activeDuck");
const eventLog = document.getElementById("eventLog");
const commandGrid = document.getElementById("commandGrid");
const targetChips = document.getElementById("targetChips");
const stageVideo = document.querySelector(".stage__video");
const stageVideoSource = stageVideo?.querySelector("source");
const drainElement = document.querySelector(".playfield__drain");
const gameStartButton = document.getElementById("gameStartButton");
const crownSound = new Audio("./duck.wav");
crownSound.preload = "auto";
const bgmIntroSound = new Audio("./bgm.wav");
const bgmActionSound = new Audio("./bgm2.wav");
const drainSound = new Audio("./drain.wav");
[bgmIntroSound, bgmActionSound].forEach((audio) => {
  audio.preload = "auto";
  audio.loop = true;
});
drainSound.preload = "auto";
const commStatus = document.getElementById("commStatus");
const gameTimer = document.getElementById("gameTimer");
const gameTimerHint = document.getElementById("gameTimerHint");
const gameTimerCard = document.getElementById("gameTimerCard");

const MOVE_CONFIG = {
  acceleration: 2800,
  maxSpeed: 980,
  drag: 6.2,
  stopThreshold: 8,
};

const DUCK_SCALE = 1.3;
const FRAME_PADDING = 0;
const FRAME_EDGE_GUTTER = 28;
const DRAIN_CONFIG = {
  radius: 420,
  strength: 3200,
  maxSpeed: 860,
  stopDistance: 14,
};
const GAME_CONFIG = {
  durationMs: 60_000,
  drainActivationElapsedMs: 20_000,
  bgmFadeDurationMs: 1000,
};
const VIDEO_SOURCES = {
  waiting: "./swim2.mp4",
  playing: "./swim4.mp4",
};
const PUBSUB_CONFIG = window.RubberDuckAzurePubSub?.config ?? {
  group: "rubberduck-room1",
};
const CONTROL_GROUP = PUBSUB_CONFIG.group ?? "rubberduck-room1";
const CONTROL_ROLES = [
  `webpubsub.joinLeaveGroup.${CONTROL_GROUP}`,
  `webpubsub.sendToGroup.${CONTROL_GROUP}`,
];
const SESSION_CODE = "rubberduck-room1";

const KEY_TO_VECTOR = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
};

const state = {
  selectedDuckId: null,
  crownDuckId: null,
  positions: new Map(),
  velocities: new Map(),
  heldKeys: new Map(),
  duckById: new Map(),
  ownershipElapsedById: new Map(),
  ownershipTimeElementById: new Map(),
  motionFrameId: null,
  lastMotionFrameAt: 0,
  bounds: { width: 0, height: 0 },
  transportMode: "comm",
  transportState: "idle",
  transportClient: null,
  transportConnectPromise: null,
  gameStarted: false,
  gameStartedAt: 0,
  gameRemainingMs: GAME_CONFIG.durationMs,
  gameEnded: false,
  drainActive: false,
  gameClockFrameId: null,
  trapAnnounced: false,
  musicUnlocked: false,
  musicStartAttempted: false,
  musicActionAttempted: false,
  drainCuePlayed: false,
  activeCollisionPairs: new Set(),
  backgroundVideoMode: "waiting",
};

const directions = Object.keys(DIRECTION_DELTAS);

function initPositions() {
  measureBounds();
  renderTargetChips();
  updateCommandButtonState();
  renderAllDucks();
}

function syncDuckState() {
  duckElements.forEach((duck, playerId) => {
    duck.classList.toggle("is-selected", playerId === state.selectedDuckId);
    duck.classList.toggle("is-crowned", playerId === state.crownDuckId);
  });

  activeDuck.textContent = state.crownDuckId ?? "대기 중";
}

function formatOwnershipTime(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function getOwnershipTime(duckId, now = performance.now()) {
  const base = state.ownershipElapsedById.get(duckId) ?? 0;
  if (!state.gameStarted || state.crownDuckId !== duckId) {
    return base;
  }

  return base + Math.max(0, now - state.crownHoldStartedAt);
}

function updateOwnershipBadges(now = performance.now()) {
  duckElements.forEach((duck, playerId) => {
    const timeElement = state.ownershipTimeElementById.get(playerId);
    if (!timeElement) return;

    timeElement.textContent = formatOwnershipTime(getOwnershipTime(playerId, now));
  });
}

function measureBounds() {
  const rect = playfield.getBoundingClientRect();
  state.bounds = { width: rect.width, height: rect.height };
}

function renderDuck(duckId) {
  const duck = state.duckById.get(duckId);
  const position = state.positions.get(duckId);
  if (!duck || !position) return;

  duck.style.setProperty("--x", `${position.x}px`);
  duck.style.setProperty("--y", `${position.y}px`);
}

function renderAllDucks() {
  duckElements.forEach((duck, playerId) => renderDuck(playerId));
}

function getDuckRect(duckId) {
  return state.positions.get(duckId);
}

function getVisualSize(width, height) {
  return {
    width: width * DUCK_SCALE,
    height: height * DUCK_SCALE,
  };
}

function getLogicalBounds(width, height) {
  const visual = getVisualSize(width, height);
  const offsetX = (visual.width - width) / 2;
  const offsetY = (visual.height - height) / 2;

  return {
    minX: FRAME_PADDING + offsetX,
    minY: FRAME_PADDING + offsetY,
    maxX: state.bounds.width - visual.width - FRAME_EDGE_GUTTER + offsetX,
    maxY: state.bounds.height - visual.height - FRAME_EDGE_GUTTER + offsetY,
  };
}

function getCornerPosition(duckId, width, height) {
  const { minX, minY, maxX, maxY } = getLogicalBounds(width, height);

  switch (duckId) {
    case 1:
      return { x: minX, y: minY };
    case 2:
      return { x: maxX, y: minY };
    case 3:
      return { x: minX, y: maxY };
    case 4:
      return { x: maxX, y: maxY };
    default:
      return { x: minX, y: minY };
  }
}

function getSpawnPositionByIndex(index, width, height) {
  const cornerPosition = getCornerPosition((index % 4) + 1, width, height);
  if (index < 4) {
    return cornerPosition;
  }

  const center = getDrainCenter();
  const ringIndex = index - 4;
  const angle = (Math.PI * 2 * ringIndex) / 8;
  const radius = Math.min(state.bounds.width, state.bounds.height) * 0.22;
  const visual = getVisualSize(width, height);
  const position = {
    x: center.x + Math.cos(angle) * radius - visual.width / 2,
    y: center.y + Math.sin(angle) * radius - visual.height / 2,
  };
  const bounds = getLogicalBounds(width, height);
  return {
    x: clamp(position.x, bounds.minX, bounds.maxX),
    y: clamp(position.y, bounds.minY, bounds.maxY),
  };
}

function buildDuckElement(playerId) {
  const duck = document.createElement("div");
  duck.className = "duck";
  duck.dataset.playerId = playerId;
  duck.innerHTML = `
    <div class="duck__body"></div>
    <div class="duck__ownership" aria-hidden="true">
      <span class="duck__ownership-label"></span>
      <span class="duck__ownership-time">00:00</span>
    </div>
    <div class="duck__crown" aria-hidden="true">
      <span class="duck__crown-base"></span>
      <span class="duck__crown-spike duck__crown-spike--left"></span>
      <span class="duck__crown-spike duck__crown-spike--center"></span>
      <span class="duck__crown-spike duck__crown-spike--right"></span>
      <span class="duck__crown-jewel duck__crown-jewel--left"></span>
      <span class="duck__crown-jewel duck__crown-jewel--center"></span>
      <span class="duck__crown-jewel duck__crown-jewel--right"></span>
    </div>
    <div class="duck__eye duck__eye--left"></div>
    <div class="duck__eye duck__eye--right"></div>
    <div class="duck__beak"></div>
  `;

  duck.querySelector(".duck__ownership-label").textContent = playerId;
  return duck;
}

function ensurePlayerDuck(playerId) {
  const normalizedPlayerId = String(playerId || "").trim();
  if (!normalizedPlayerId) {
    return null;
  }

  if (duckElements.has(normalizedPlayerId)) {
    return duckElements.get(normalizedPlayerId);
  }

  const duck = buildDuckElement(normalizedPlayerId);
  const spawnIndex = duckElements.size;

  duckElements.set(normalizedPlayerId, duck);
  state.duckById.set(normalizedPlayerId, duck);
  state.ownershipTimeElementById.set(normalizedPlayerId, duck.querySelector(".duck__ownership-time"));
  duck.style.visibility = "hidden";
  playfield.appendChild(duck);
  const rect = duck.getBoundingClientRect();
  const position = getSpawnPositionByIndex(spawnIndex, rect.width, rect.height);
  duck.style.visibility = "";
  duck.style.setProperty("--x", `${position.x}px`);
  duck.style.setProperty("--y", `${position.y}px`);
  state.positions.set(normalizedPlayerId, {
    x: position.x,
    y: position.y,
    width: rect.width,
    height: rect.height,
  });
  state.velocities.set(normalizedPlayerId, { x: 0, y: 0 });

  if (!state.selectedDuckId) {
    setSelectedDuck(normalizedPlayerId);
  } else {
    renderTargetChips();
    updateCommandButtonState();
    syncDuckState();
  }

  if (!state.crownDuckId) {
    setCrownDuck(normalizedPlayerId);
  } else {
    updateOwnershipBadges();
  }

  return duck;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getDuckVelocity(duckId) {
  if (!state.velocities.has(duckId)) {
    state.velocities.set(duckId, { x: 0, y: 0 });
  }

  return state.velocities.get(duckId);
}

function getDirectionVector(direction) {
  return DIRECTION_DELTAS[direction] ?? null;
}

function toControllerDirection(direction) {
  const directionMap = {
    상: "up",
    하: "down",
    좌: "left",
    우: "right",
    상좌: "upLeft",
    상우: "upRight",
    하좌: "downLeft",
    하우: "downRight",
  };

  return directionMap[direction] ?? direction ?? null;
}

function getDrainCenter() {
  return {
    x: state.bounds.width / 2,
    y: state.bounds.height / 2,
  };
}

function getDrainInfluence(position) {
  if (!state.drainActive) {
    return { active: false, x: 0, y: 0, distance: Infinity };
  }

  const center = getDrainCenter();
  const duckCenterX = position.x + position.width / 2;
  const duckCenterY = position.y + position.height / 2;
  const offsetX = center.x - duckCenterX;
  const offsetY = center.y - duckCenterY;
  const distance = Math.hypot(offsetX, offsetY);

  if (distance >= DRAIN_CONFIG.radius || distance === 0) {
    return { active: false, x: 0, y: 0, distance };
  }

  const normalized = 1 - distance / DRAIN_CONFIG.radius;
  const pull = DRAIN_CONFIG.strength * normalized * normalized;
  const length = Math.hypot(offsetX, offsetY) || 1;

  return {
    active: true,
    x: (offsetX / length) * pull,
    y: (offsetY / length) * pull,
    distance,
  };
}

function formatGameTime(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function renderWaitingGameState() {
  if (gameTimer) {
    gameTimer.textContent = "대기";
  }
  if (gameTimerHint) {
    gameTimerHint.textContent = "게임 시작 버튼을 눌러주세요";
  }
  if (gameTimerCard) {
    gameTimerCard.classList.remove("is-warning", "is-ended");
  }
  if (drainElement) {
    drainElement.classList.remove("is-active");
  }
  if (gameStartButton) {
    gameStartButton.textContent = "게임 시작";
    gameStartButton.disabled = false;
    gameStartButton.classList.remove("is-active");
  }
}

function updateGameTimerUI(now = performance.now()) {
  if (!state.gameStarted) {
    renderWaitingGameState();
    setBackgroundVideoMode("waiting");
    return;
  }

  const elapsedMs = now - state.gameStartedAt;
  const remainingMs = clamp(GAME_CONFIG.durationMs - elapsedMs, 0, GAME_CONFIG.durationMs);
  const trapActive = elapsedMs >= GAME_CONFIG.drainActivationElapsedMs && remainingMs > 0;
  const hasEnded = remainingMs <= 0;

  state.gameRemainingMs = remainingMs;
  state.drainActive = trapActive && !hasEnded;

  if (gameTimer) {
    gameTimer.textContent = formatGameTime(remainingMs);
  }

  if (gameTimerHint) {
    gameTimerHint.textContent = hasEnded
      ? "경기 종료"
      : trapActive
        ? "배수구 트랩 활성화"
        : "배수구 트랩 대기 중";
  }

  if (gameTimerCard) {
    gameTimerCard.classList.toggle("is-warning", trapActive);
    gameTimerCard.classList.toggle("is-ended", hasEnded);
  }

  if (drainElement) {
    drainElement.classList.toggle("is-active", trapActive && !hasEnded);
  }

  syncBackgroundMusic(now, elapsedMs, remainingMs, trapActive, hasEnded);

  if (trapActive && !state.trapAnnounced) {
    state.trapAnnounced = true;
    logEvent("배수구 트랩이 활성화되었습니다.");
    startMotionLoop();
  }

  if (hasEnded && !state.gameEnded) {
    state.gameEnded = true;
    state.heldKeys.clear();
    stopMotionLoop();
    lastCommand.textContent = "게임 종료";
    logEvent("경기가 종료되었습니다.");
    state.musicStartAttempted = false;
    state.musicActionAttempted = false;
    state.drainCuePlayed = false;
    stopAudio(bgmActionSound);
    stopAudio(drainSound);
    setAudioVolume(bgmIntroSound, 1);
    tryPlayAudio(bgmIntroSound, 0);
  }

  if (!state.gameEnded) {
    state.gameClockFrameId = window.requestAnimationFrame(updateGameTimerUI);
  } else {
    state.gameClockFrameId = null;
  }
}

function setBackgroundVideoMode(mode) {
  if (!stageVideo || !stageVideoSource) {
    return;
  }

  const nextSource = mode === "playing" ? VIDEO_SOURCES.playing : VIDEO_SOURCES.waiting;
  const currentSource = stageVideoSource.getAttribute("src");
  if (state.backgroundVideoMode === mode && currentSource === nextSource) {
    if (stageVideo.paused) {
      stageVideo.play?.().catch(() => {
        logEvent("배경 영상 자동 재생이 차단되었습니다.");
      });
    }
    return;
  }

  state.backgroundVideoMode = mode;

  if (currentSource !== nextSource) {
    stageVideo.classList.remove("is-ready");
    stageVideoSource.setAttribute("src", nextSource);
    stageVideo.load();
  }

  const restorePlayback = () => {
    stageVideo.classList.add("is-ready");
    stageVideo.play?.().catch(() => {
      logEvent("배경 영상 자동 재생이 차단되었습니다.");
    });
  };

  if (stageVideo.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
    restorePlayback();
    return;
  }

  stageVideo.addEventListener("canplay", restorePlayback, { once: true });
}

function setAudioVolume(audio, volume) {
  audio.volume = clamp(volume, 0, 1);
}

function tryPlayAudio(audio, seekSeconds = 0) {
  if (Number.isFinite(seekSeconds)) {
    try {
      audio.currentTime = Math.max(0, seekSeconds);
    } catch {
      // 메타데이터가 아직 없으면 currentTime 세팅은 나중 틱에서 다시 시도합니다.
    }
  }

  const result = audio.play();
  if (result && typeof result.catch === "function") {
    result
      .then(() => {
        state.musicUnlocked = true;
      })
      .catch(() => {
        state.musicUnlocked = false;
      });
    return;
  }

  state.musicUnlocked = true;
}

function stopAudio(audio) {
  if (!audio.paused) {
    audio.pause();
  }
}

function unlockBackgroundMusic() {
  if (state.gameEnded || state.musicUnlocked || !state.gameStarted) {
    return;
  }

  state.musicStartAttempted = false;
  state.musicActionAttempted = false;

  const now = performance.now();
  const elapsedMs = now - state.gameStartedAt;
  const remainingMs = clamp(GAME_CONFIG.durationMs - elapsedMs, 0, GAME_CONFIG.durationMs);
  const trapActive = elapsedMs >= GAME_CONFIG.drainActivationElapsedMs && remainingMs > 0;
  const hasEnded = remainingMs <= 0;

  syncBackgroundMusic(now, elapsedMs, remainingMs, trapActive, hasEnded);
}

function syncBackgroundMusic(now, elapsedMs, remainingMs, trapActive, hasEnded) {
  if (hasEnded) {
    stopAudio(bgmActionSound);
    stopAudio(drainSound);
    setAudioVolume(bgmIntroSound, 1);
    if (bgmIntroSound.paused) {
      tryPlayAudio(bgmIntroSound, 0);
    }
    return;
  }

  const fadeStartMs = GAME_CONFIG.drainActivationElapsedMs;
  const fadeEndMs = fadeStartMs + GAME_CONFIG.bgmFadeDurationMs;
  const introSeek = elapsedMs / 1000;
  const actionSeek = Math.max(0, (elapsedMs - fadeStartMs) / 1000);

  let introVolume = 0;
  let actionVolume = 0;

  if (elapsedMs < fadeStartMs) {
    introVolume = 1;
  } else if (elapsedMs < fadeEndMs) {
    const fadeProgress = (elapsedMs - fadeStartMs) / GAME_CONFIG.bgmFadeDurationMs;
    introVolume = 1 - fadeProgress;
    actionVolume = fadeProgress;
  } else {
    actionVolume = 1;
  }

  setAudioVolume(bgmIntroSound, introVolume);
  setAudioVolume(bgmActionSound, actionVolume);

  if (introVolume > 0) {
    if (!state.musicStartAttempted || bgmIntroSound.paused) {
      state.musicStartAttempted = true;
      tryPlayAudio(bgmIntroSound, introSeek);
    }
  } else {
    stopAudio(bgmIntroSound);
  }

  if (actionVolume > 0) {
    if (!state.musicActionAttempted || bgmActionSound.paused) {
      state.musicActionAttempted = true;
      tryPlayAudio(bgmActionSound, actionSeek);
    }
  } else if (elapsedMs < fadeStartMs - 250) {
    stopAudio(bgmActionSound);
  }

  if (trapActive && bgmActionSound.paused) {
    tryPlayAudio(bgmActionSound, actionSeek);
  }

  if (trapActive && !state.drainCuePlayed) {
    state.drainCuePlayed = true;
    tryPlayAudio(drainSound, 0);
  }
}

function startGameClock() {
  if (state.gameStarted) {
    return;
  }

  setBackgroundVideoMode("playing");
  state.gameStarted = true;
  state.gameStartedAt = performance.now();
  state.gameRemainingMs = GAME_CONFIG.durationMs;
  state.gameEnded = false;
  state.trapAnnounced = false;
  state.musicStartAttempted = false;
  state.musicActionAttempted = false;
  state.drainCuePlayed = false;
  state.activeCollisionPairs.clear();
  if (state.crownDuckId) {
    state.crownHoldStartedAt = state.gameStartedAt;
  }
  if (gameStartButton) {
    gameStartButton.textContent = "진행 중";
    gameStartButton.disabled = true;
    gameStartButton.classList.add("is-active");
  }
  updateCommandButtonState();
  updateTransportUI();
  updateGameTimerUI(state.gameStartedAt);
}

function stopGameClock() {
  if (state.gameClockFrameId !== null) {
    window.cancelAnimationFrame(state.gameClockFrameId);
    state.gameClockFrameId = null;
  }
}

function getDurationScale(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return 1;
  }

  return clamp(1 + durationMs / 180, 1, 4);
}

function getHitbox(rect) {
  const insetX = rect.width * 0.24;
  const insetY = rect.height * 0.2;

  return {
    x: rect.x + insetX,
    y: rect.y + insetY,
    width: rect.width - insetX * 2,
    height: rect.height - insetY * 2,
  };
}

function getOverlapArea(first, second) {
  const firstHitbox = getHitbox(first);
  const secondHitbox = getHitbox(second);

  const left = Math.max(firstHitbox.x, secondHitbox.x);
  const top = Math.max(firstHitbox.y, secondHitbox.y);
  const right = Math.min(firstHitbox.x + firstHitbox.width, secondHitbox.x + secondHitbox.width);
  const bottom = Math.min(firstHitbox.y + firstHitbox.height, secondHitbox.y + secondHitbox.height);

  const overlapWidth = right - left;
  const overlapHeight = bottom - top;

  if (overlapWidth <= 0 || overlapHeight <= 0) {
    return 0;
  }

  return overlapWidth * overlapHeight;
}

function getCollisionKey(firstDuckId, secondDuckId) {
  return firstDuckId < secondDuckId
    ? `${firstDuckId}\u0001${secondDuckId}`
    : `${secondDuckId}\u0001${firstDuckId}`;
}

function getCollisionPairMembers(pairKey) {
  const separatorIndex = pairKey.indexOf("\u0001");
  if (separatorIndex === -1) {
    return [pairKey, ""];
  }

  return [pairKey.slice(0, separatorIndex), pairKey.slice(separatorIndex + 1)];
}

function findCollidedDuck(movingDuckId) {
  const movingDuck = getDuckRect(movingDuckId);
  let winner = null;
  let bestOverlap = 0;

  duckElements.forEach((duck, playerId) => {
    if (playerId === movingDuckId) return;

    const candidate = getDuckRect(playerId);
    const overlap = getOverlapArea(movingDuck, candidate);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      winner = playerId;
    }
  });

  return winner;
}

function updateCollisionContact(movingDuckId, collidedDuckId) {
  const pairKey = collidedDuckId ? getCollisionKey(movingDuckId, collidedDuckId) : null;
  const relatedKeys = [];

  state.activeCollisionPairs.forEach((key) => {
    const [firstDuckId, secondDuckId] = getCollisionPairMembers(key);
    if (firstDuckId === movingDuckId || secondDuckId === movingDuckId) {
      relatedKeys.push(key);
    }
  });

  relatedKeys.forEach((key) => state.activeCollisionPairs.delete(key));

  if (!pairKey) {
    return { newlyCollided: false, pairKey: null };
  }

  const newlyCollided = !state.activeCollisionPairs.has(pairKey);
  state.activeCollisionPairs.add(pairKey);
  return { newlyCollided, pairKey };
}

function setSelectedDuck(playerId) {
  const normalizedPlayerId = playerId == null ? null : String(playerId);
  state.selectedDuckId = normalizedPlayerId;
  targetChips.querySelectorAll(".chip").forEach((chip) => {
    chip.classList.toggle("is-selected", chip.dataset.playerId === normalizedPlayerId);
  });
  syncDuckState();
}

function setCrownDuck(playerId) {
  const normalizedPlayerId = playerId == null || playerId === "" ? null : String(playerId);

  if (!normalizedPlayerId) {
    state.crownDuckId = null;
    syncDuckState();
    updateOwnershipBadges();
    return;
  }

  const now = performance.now();
  const previousDuckId = state.crownDuckId;

  if (previousDuckId && !state.ownershipElapsedById.has(previousDuckId)) {
    state.ownershipElapsedById.set(previousDuckId, 0);
  }
  if (!state.ownershipElapsedById.has(normalizedPlayerId)) {
    state.ownershipElapsedById.set(normalizedPlayerId, 0);
  }

  if (previousDuckId && previousDuckId !== normalizedPlayerId && state.gameStarted) {
    const elapsed = Math.max(0, now - state.crownHoldStartedAt);
    state.ownershipElapsedById.set(previousDuckId, (state.ownershipElapsedById.get(previousDuckId) ?? 0) + elapsed);
  }

  state.crownDuckId = normalizedPlayerId;
  state.crownHoldStartedAt = now;
  syncDuckState();
  updateOwnershipBadges(now);
}

function playCrownSound() {
  try {
    const sound = crownSound.cloneNode(true);
    sound.volume = 0.75;
    sound.play().catch(() => {});
  } catch {
    // 사운드 재생이 막힌 환경은 조용히 무시합니다.
  }
}

function applyDuckMotion(duckId, dtSeconds, inputVector = null, inputHoldMs = 0) {
  if (state.gameEnded || !state.gameStarted) {
    return { moved: false, inDrain: false };
  }

  const position = state.positions.get(duckId);
  if (!position) {
    return { moved: false, inDrain: false };
  }

  const velocity = getDuckVelocity(duckId);
  let inDrain = false;

  if (inputVector && (inputVector.x !== 0 || inputVector.y !== 0)) {
    const holdBoost = 1 + Math.min(inputHoldMs / 700, 1.6);
    velocity.x += inputVector.x * MOVE_CONFIG.acceleration * holdBoost * dtSeconds;
    velocity.y += inputVector.y * MOVE_CONFIG.acceleration * holdBoost * dtSeconds;

    const speed = Math.hypot(velocity.x, velocity.y);
    const speedCap = MOVE_CONFIG.maxSpeed * (1 + Math.min(inputHoldMs / 2000, 0.35));
    if (speed > speedCap) {
      const scale = speedCap / speed;
      velocity.x *= scale;
      velocity.y *= scale;
    }
  }

  const drain = getDrainInfluence(position);
  if (drain.active) {
    velocity.x += drain.x * dtSeconds;
    velocity.y += drain.y * dtSeconds;
    inDrain = true;
  }

  const decay = Math.exp(-MOVE_CONFIG.drag * dtSeconds);
  velocity.x *= decay;
  velocity.y *= decay;

  const speed = Math.hypot(velocity.x, velocity.y);
  if (!inputVector && !inDrain && speed < MOVE_CONFIG.stopThreshold) {
    velocity.x = 0;
    velocity.y = 0;
    return { moved: false, inDrain: false };
  }

  if (speed > DRAIN_CONFIG.maxSpeed) {
    const scale = DRAIN_CONFIG.maxSpeed / speed;
    velocity.x *= scale;
    velocity.y *= scale;
  }

  const finalSpeed = Math.hypot(velocity.x, velocity.y);
  if (finalSpeed < DRAIN_CONFIG.stopDistance && !inDrain && !inputVector) {
    velocity.x = 0;
    velocity.y = 0;
    return { moved: false, inDrain: false };
  }

  if (finalSpeed <= 0) {
    return { moved: false, inDrain };
  }

  moveDuck(duckId, velocity.x * dtSeconds, velocity.y * dtSeconds, {
    source: inputVector ? "keyboard" : "drain",
  });

  return { moved: true, inDrain };
}

function renderTargetChips() {
  const players = Array.from(duckElements.keys());
  if (players.length === 0) {
    targetChips.innerHTML = `<button class="chip" type="button" disabled>플레이어 대기 중</button>`;
    return;
  }

  targetChips.innerHTML = players
    .map((playerId) => {
      return `<button class="chip${playerId === state.selectedDuckId ? " is-selected" : ""}" data-player-id="${playerId}" type="button">${playerId}</button>`;
    })
    .join("");

  targetChips.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => setSelectedDuck(chip.dataset.playerId));
  });
}

function renderCommandButtons() {
  const commandButtons = [
    { label: "상좌", direction: "upLeft" },
    { label: "상", direction: "up" },
    { label: "상우", direction: "upRight" },
    { label: "좌", direction: "left" },
    { label: "정지", direction: "idle" },
    { label: "우", direction: "right" },
    { label: "하좌", direction: "downLeft" },
    { label: "하", direction: "down" },
    { label: "하우", direction: "downRight" },
  ];

  commandGrid.innerHTML = commandButtons
    .map((command) => `<button class="command-btn" data-direction="${command.direction}" type="button">${command.label}</button>`)
    .join("");

  commandGrid.querySelectorAll(".command-btn").forEach((button) => {
    button.disabled = !state.gameStarted || !state.selectedDuckId;
    button.addEventListener("click", () => {
      if (!state.gameStarted) {
        logEvent("게임 시작 전에는 명령을 사용할 수 없습니다.");
        return;
      }

      if (!state.selectedDuckId) {
        logEvent("조작할 플레이어를 먼저 선택하세요.");
        return;
      }

      if (state.gameEnded) {
        logEvent("경기 종료 후 명령은 무시됩니다.");
        return;
      }

      const payload = {
        type: button.dataset.direction === "idle" ? "controller.stop" : "controller.move",
        playerId: state.selectedDuckId,
        sessionCode: SESSION_CODE,
        direction: button.dataset.direction,
        source: "local-ui",
      };

      handleIncomingMessage(payload);
      if (state.transportMode === "comm") {
        void broadcastCommand(payload);
      }
    });
  });
}

function updateCommandButtonState() {
  commandGrid.querySelectorAll(".command-btn").forEach((button) => {
    button.disabled = !state.gameStarted || !state.selectedDuckId;
  });
}

function logEvent(message) {
  const timestamp = new Date().toLocaleTimeString("ko-KR", { hour12: false });
  eventLog.textContent = `[${timestamp}] ${message}\n${eventLog.textContent}`.trim();
}

function updateTransportUI() {
  const statusText = state.transportState === "connecting"
      ? "통신 연결 중"
      : state.transportState === "connected"
        ? "통신 연결됨"
        : state.transportState === "error"
          ? "통신 오류"
          : "통신 대기";

  connectionStatus.textContent = statusText;
  if (commStatus) {
    commStatus.textContent = state.gameStarted
      ? state.transportState === "connected"
        ? "Azure Web Pub/Sub 수신 중"
        : state.transportState === "connecting"
          ? "Azure Web Pub/Sub 연결 중"
          : "Azure Web Pub/Sub 오류"
      : state.transportState === "connected"
        ? "게임 시작 전에도 메시지 수신 대기 중"
        : state.transportState === "connecting"
          ? "Azure Web Pub/Sub 연결 중"
          : "Azure Web Pub/Sub 오류";
  }
}

function disconnectTransportClient() {
  const connection = state.transportClient;
  state.transportConnectPromise = null;
  state.transportClient = null;
  state.transportState = "idle";
  updateTransportUI();

  if (connection?.stop) {
    Promise.resolve(connection.stop()).catch((error) => {
      logEvent(`Web Pub/Sub 종료 실패: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
}

async function connectTransportClient() {
  if (state.transportClient) {
    return state.transportClient;
  }

  if (state.transportConnectPromise) {
    return state.transportConnectPromise;
  }

  if (!window.RubberDuckAzurePubSub) {
    state.transportState = "error";
    updateTransportUI();
    logEvent("Web Pub/Sub 도우미를 불러오지 못했습니다.");
    return null;
  }

  state.transportState = "connecting";
  updateTransportUI();

  state.transportConnectPromise = (async () => {
    try {
      const connection = await window.RubberDuckAzurePubSub.createClient({
        userId: "dashboard",
        roles: CONTROL_ROLES,
        groups: [CONTROL_GROUP],
        onConnected() {
          state.transportState = "connected";
          updateTransportUI();
        },
        onDisconnected() {
          if (state.transportMode === "comm") {
            state.transportState = "idle";
            updateTransportUI();
            logEvent("Web Pub/Sub 연결이 끊어졌습니다.");
          }
        },
        onStopped() {
          if (state.transportMode === "comm") {
            state.transportState = "idle";
            updateTransportUI();
            logEvent("Web Pub/Sub 연결이 종료되었습니다.");
          }
        },
        onGroupMessage(event) {
          const message = event?.message?.data ?? event?.data ?? event;
          console.log("[Azure Web Pub/Sub receive]", message);
          handleIncomingMessage(message);
        },
      });

      if (state.transportMode !== "comm") {
        await connection.stop();
        return null;
      }

      state.transportClient = connection;
      state.transportState = "connected";
      updateTransportUI();
      logEvent("Azure Web Pub/Sub에 연결되었습니다.");
      return connection;
    } catch (error) {
      state.transportClient = null;
      state.transportState = "error";
      updateTransportUI();
      logEvent(`Azure Web Pub/Sub 연결 실패: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    } finally {
      state.transportConnectPromise = null;
    }
  })();

  return state.transportConnectPromise;
}

async function broadcastCommand(payload) {
  if (state.transportMode !== "comm") {
    return false;
  }

  const connection = state.transportClient ?? (await connectTransportClient());
  if (!connection) {
    return false;
  }

  try {
    await connection.sendToGroup(CONTROL_GROUP, payload, "json", { noEcho: true });
    return true;
  } catch (error) {
    logEvent(`명령 전송 실패: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

function moveDuck(duckId, deltaX, deltaY, options = {}) {
  if (state.gameEnded || !state.gameStarted) {
    return null;
  }

  const duck = state.duckById.get(duckId);
  if (!duck) return null;

  const current = state.positions.get(duckId);
  const { minX, minY, maxX, maxY } = getLogicalBounds(current.width, current.height);
  const next = {
    x: clamp(current.x + deltaX, minX, maxX),
    y: clamp(current.y + deltaY, minY, maxY),
    width: current.width,
    height: current.height,
  };

  state.positions.set(duckId, next);
  renderDuck(duckId);

  const angle = deltaX > 0 ? 5 : deltaX < 0 ? -5 : 0;
  duck.style.setProperty("--rot", `${angle}deg`);
  window.setTimeout(() => duck.style.setProperty("--rot", "0deg"), 240);

  const collidedDuckId = findCollidedDuck(duckId);
  const collision = updateCollisionContact(duckId, collidedDuckId);
  if (collision.newlyCollided && collidedDuckId && collidedDuckId === state.crownDuckId) {
    setCrownDuck(duckId);
    playCrownSound();
    lastCommand.textContent = `${duckId} · 왕관 획득`;
    logEvent(`collision | player=${duckId} beat crown holder=${collidedDuckId} | crown transferred`);
  }

  startMotionLoop();
  return collidedDuckId;
}

function moveDuckByDirection(duckId, direction, options = {}) {
  if (state.gameEnded || !state.gameStarted) {
    return null;
  }

  const delta = getDirectionVector(direction);
  if (!delta) return null;

  const scale = getDurationScale(options.durationMs);
  return moveDuck(duckId, delta[0] * scale, delta[1] * scale, options);
}

function applyVelocityStep(duckId, velocityX, velocityY, dtSeconds) {
  return moveDuck(duckId, velocityX * dtSeconds, velocityY * dtSeconds, { source: "keyboard" });
}

function getHeldInputVector(now) {
  let x = 0;
  let y = 0;
  let longestHoldMs = 0;

  state.heldKeys.forEach((startedAt, key) => {
    const delta = KEY_TO_VECTOR[key];
    if (!delta) return;

    x += delta[0];
    y += delta[1];
    longestHoldMs = Math.max(longestHoldMs, now - startedAt);
  });

  if (x === 0 && y === 0) {
    return { x: 0, y: 0, holdMs: 0 };
  }

  const length = Math.hypot(x, y);
  return {
    x: x / length,
    y: y / length,
    holdMs: longestHoldMs,
  };
}

function startMotionLoop() {
  if (state.gameEnded || !state.gameStarted) {
    return;
  }

  if (state.motionFrameId !== null) {
    return;
  }

  state.lastMotionFrameAt = performance.now();

  const tick = (now) => {
    const dtSeconds = Math.min((now - state.lastMotionFrameAt) / 1000, 0.032);
    state.lastMotionFrameAt = now;

    const input = getHeldInputVector(now);
    const hasInput = input.x !== 0 || input.y !== 0;
    const selectedDuckId = state.selectedDuckId;
    let keepRunning = hasInput;

    duckElements.forEach((duck, playerId) => {
      const result = applyDuckMotion(
        playerId,
        dtSeconds,
        playerId === selectedDuckId ? input : null,
        playerId === selectedDuckId ? input.holdMs : 0,
      );
      keepRunning = keepRunning || result.moved || result.inDrain;
    });

    if (keepRunning) {
      state.motionFrameId = window.requestAnimationFrame(tick);
      return;
    }

    state.motionFrameId = null;
  };

  state.motionFrameId = window.requestAnimationFrame(tick);
}

function stopMotionLoop() {
  if (state.motionFrameId !== null) {
    window.cancelAnimationFrame(state.motionFrameId);
    state.motionFrameId = null;
  }
}

function normalizeIncomingPayload(raw) {
  if (typeof raw === "string") {
    try {
      return normalizeIncomingPayload(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  if (!raw || typeof raw !== "object") return null;

  const type = raw.type ?? raw.eventType ?? "";
  const sessionCode = raw.sessionCode ?? raw.roomCode ?? "";
  const rawDuckId = raw.duckId ?? raw.targetDuck ?? raw.duck ?? raw.id;
  const playerId = String(raw.playerId ?? raw.clientId ?? raw.userId ?? rawDuckId ?? "").trim();
  const direction = raw.direction ?? raw.move ?? raw.action;
  const durationMs = Number(raw.durationMs ?? raw.holdMs ?? raw.pressDuration);
  const velocityX = Number(raw.velocityX ?? raw.vx ?? raw.vectorX ?? raw.vector?.x);
  const velocityY = Number(raw.velocityY ?? raw.vy ?? raw.vectorY ?? raw.vector?.y);

  if (type === "sendToGroup" || type === "message") {
    return normalizeIncomingPayload(raw.data ?? raw.message ?? raw.body ?? null);
  }

  if (type === "joinGroup") {
    return null;
  }

  if (sessionCode && sessionCode !== SESSION_CODE) {
    logEvent(`다른 세션 메시지 무시: ${sessionCode}`);
    return null;
  }

  if (!playerId) return null;

  if (type === "session.join") {
    return {
      kind: "join",
      playerId,
      sessionCode: sessionCode || SESSION_CODE,
      source: raw.source ?? "web-pubsub",
    };
  }

  if (type === "join") {
    return {
      kind: "join",
      playerId,
      sessionCode: sessionCode || SESSION_CODE,
      source: raw.source ?? "web-pubsub",
    };
  }

  if (type === "controller.stop" || direction === "idle") {
    return {
      kind: "stop",
      playerId,
      direction: "idle",
      sessionCode: sessionCode || SESSION_CODE,
      source: raw.source ?? "web-pubsub",
    };
  }

  if (Number.isFinite(velocityX) && Number.isFinite(velocityY)) {
    return {
      kind: "move",
      playerId,
      velocityX,
      velocityY,
      sessionCode: sessionCode || SESSION_CODE,
      source: raw.source ?? "web-pubsub",
    };
  }

  const normalizedDirection = toControllerDirection(direction);
  if (!DIRECTION_DELTAS[normalizedDirection]) return null;

  return {
    kind: "move",
    playerId,
    direction: normalizedDirection,
    durationMs: Number.isFinite(durationMs) ? durationMs : null,
    sessionCode: sessionCode || SESSION_CODE,
    source: raw.source ?? "web-pubsub",
  };
}

function handleIncomingMessage(payload) {
  const message = normalizeIncomingPayload(payload);
  if (!message) {
    logEvent("무효한 메시지 수신");
    return;
  }

  console.log("[Azure Web Pub/Sub receive]", message);

  if (message.kind === "join") {
    ensurePlayerDuck(message.playerId);
    if (!state.selectedDuckId) {
      setSelectedDuck(message.playerId);
    }
    if (!state.crownDuckId) {
      setCrownDuck(message.playerId);
    }
    logEvent(`join | player=${message.playerId} | session=${message.sessionCode}`);
    return;
  }

  if (!state.gameStarted) {
    ensurePlayerDuck(message.playerId);
    logEvent(`게임 시작 전 명령 무시 | player=${message.playerId}`);
    return;
  }

  if (state.gameEnded) {
    ensurePlayerDuck(message.playerId);
    logEvent(`게임 종료 후 명령 무시 | player=${message.playerId}`);
    return;
  }

  if (message.kind === "stop") {
    ensurePlayerDuck(message.playerId);
    const velocity = getDuckVelocity(message.playerId);
    velocity.x = 0;
    velocity.y = 0;
    lastCommand.textContent = `${message.playerId} · 정지`;
    logEvent(`stop | player=${message.playerId}`);
    return;
  }

  if (Number.isFinite(message.velocityX) && Number.isFinite(message.velocityY)) {
    ensurePlayerDuck(message.playerId);
    moveDuck(message.playerId, message.velocityX, message.velocityY, { source: message.source });
  } else {
    ensurePlayerDuck(message.playerId);
    moveDuckByDirection(message.playerId, message.direction, {
      durationMs: message.durationMs,
      source: message.source,
    });
  }

  if (state.selectedDuckId === message.playerId) {
    const commandLabel = message.direction ?? `vx:${message.velocityX},vy:${message.velocityY}`;
    lastCommand.textContent = `${message.playerId} · ${commandLabel}`;
  }
  const details =
    message.direction !== undefined
      ? `type=${message.kind} | direction=${message.direction}${message.durationMs ? ` | hold=${message.durationMs}ms` : ""}`
      : `type=${message.kind} | velocity=(${message.velocityX}, ${message.velocityY})`;
  logEvent(`${message.source} | player=${message.playerId} | ${details}`);
}

function connectAzureTransport() {
  logEvent("게임 시작 전에도 Azure Web Pub/Sub 수신 대기 중입니다.");
  void connectTransportClient();
}

function setupBackgroundVideo() {
  if (!stageVideo) return;

  const revealVideo = () => {
    stageVideo.classList.add("is-ready");
  };

  setBackgroundVideoMode("waiting");
  stageVideo.addEventListener("loadeddata", revealVideo, { once: true });
  stageVideo.addEventListener("canplay", revealVideo, { once: true });
  stageVideo.play?.().catch(() => {
    logEvent("배경 영상 자동 재생이 차단되었습니다.");
  });
}

function attachWindowHooks() {
  window.rubberDuckControl = {
    send(payload) {
      handleIncomingMessage(payload);
      if (state.transportClient) {
        void broadcastCommand(payload);
      }
    },
    setSelectedDuck(duckId) {
      setSelectedDuck(duckId);
    },
  };
}

function handleResize() {
  measureBounds();
  duckElements.forEach((duck, playerId) => {
    const position = state.positions.get(playerId);
    if (!position) return;

    const { minX, minY, maxX, maxY } = getLogicalBounds(position.width, position.height);
    const clampedX = clamp(position.x, minX, maxX);
    const clampedY = clamp(position.y, minY, maxY);
    if (clampedX !== position.x || clampedY !== position.y) {
      state.positions.set(playerId, { ...position, x: clampedX, y: clampedY });
      renderDuck(playerId);
    }
  });
}

window.addEventListener("resize", handleResize);

document.addEventListener("keydown", (event) => {
  unlockBackgroundMusic();
  if (!KEY_TO_VECTOR[event.key]) return;
  if (event.repeat) return;

  event.preventDefault();
  state.heldKeys.set(event.key, performance.now());
  startMotionLoop();
});

document.addEventListener("keyup", (event) => {
  if (!KEY_TO_VECTOR[event.key]) return;

  event.preventDefault();
  state.heldKeys.delete(event.key);
});

document.addEventListener("pointerdown", () => {
  unlockBackgroundMusic();
});

window.addEventListener("blur", () => {
  state.heldKeys.clear();
  stopMotionLoop();
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    state.heldKeys.clear();
    stopMotionLoop();
  }
});

initPositions();
renderTargetChips();
renderCommandButtons();
setSelectedDuck(state.selectedDuckId);
setCrownDuck(state.crownDuckId);
renderWaitingGameState();
connectAzureTransport();
setupBackgroundVideo();
attachWindowHooks();

if (gameStartButton) {
  gameStartButton.addEventListener("click", () => {
    startGameClock();
  });
}
