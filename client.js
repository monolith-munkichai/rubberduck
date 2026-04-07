const PUBSUB_CONFIG = window.RubberDuckAzurePubSub?.config ?? {
  group: "rubberduck-room1",
};
const CONTROL_GROUP = PUBSUB_CONFIG.group ?? "rubberduck-room1";
const CONTROL_ROLES = [
  `webpubsub.joinLeaveGroup.${CONTROL_GROUP}`,
  `webpubsub.sendToGroup.${CONTROL_GROUP}`,
];
const SESSION_CODE = "rubberduck-room1";

const state = {
  selectedDuckId: 1,
  connected: false,
  connectionPhase: "idle",
  connection: null,
};

const connectToggle = document.getElementById("connectToggle");
const connectionState = document.getElementById("connectionState");
const targetState = document.getElementById("targetState");
const lastSent = document.getElementById("lastSent");
const eventLog = document.getElementById("eventLog");
const targetChips = document.getElementById("targetChips");
const directionPad = document.getElementById("directionPad");
const modeNote = document.getElementById("modeNote");

function log(message) {
  const timestamp = new Date().toLocaleTimeString("ko-KR", { hour12: false });
  eventLog.textContent = `[${timestamp}] ${message}\n${eventLog.textContent}`.trim();
}

function updateUI() {
  const statusText =
    state.connectionPhase === "connecting"
      ? "연결 중"
      : state.connected
        ? "연결됨"
        : state.connectionPhase === "error"
          ? "오류"
          : "대기 중";

  connectionState.textContent = statusText;
  targetState.textContent = getPlayerId();
  connectToggle.textContent = state.connected ? "연결 해제" : "연결";
  connectToggle.classList.toggle("is-on", state.connected);
  connectToggle.setAttribute("aria-pressed", String(state.connected));
  modeNote.textContent = state.connected ? "Azure Web Pub/Sub 전송 중" : "연결 대기";

  targetChips.querySelectorAll(".chip").forEach((chip) => {
    chip.classList.toggle("is-selected", Number(chip.dataset.duck) === state.selectedDuckId);
  });
}

function getPlayerId() {
  return `duck-${state.selectedDuckId}`;
}

function buildJoinPayload() {
  return {
    type: "join",
    playerId: getPlayerId(),
    sessionCode: SESSION_CODE,
  };
}

function buildMovePayload(direction) {
  return {
    type: direction === "idle" ? "controller.stop" : "controller.move",
    playerId: getPlayerId(),
    sessionCode: SESSION_CODE,
    direction,
  };
}

async function sendControlPayload(connection, payload) {
  await connection.sendToGroup(CONTROL_GROUP, payload, "json", { noEcho: true });
  console.log("[Azure Web Pub/Sub send]", payload);
  log(`전송: ${JSON.stringify(payload)}`);
}

async function sendStopPayload(connection) {
  return sendControlPayload(connection, {
    type: "controller.stop",
    playerId: getPlayerId(),
    sessionCode: SESSION_CODE,
    direction: "idle",
  });
}

function disconnectRemoteClient() {
  const connection = state.connection;
  state.connection = null;
  state.connected = false;
  state.connectionPhase = "idle";
  updateUI();

  if (connection?.stop) {
    Promise.resolve(connection.stop()).catch((error) => {
      log(`연결 종료 실패: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
}

async function connectRemoteClient() {
  if (state.connection || state.connectionPhase === "connecting") {
    return state.connection;
  }

  if (!window.RubberDuckAzurePubSub) {
    state.connectionPhase = "error";
    updateUI();
    log("Azure Web Pub/Sub 도우미를 불러오지 못했습니다.");
    return null;
  }

  state.connectionPhase = "connecting";
  updateUI();
  log("Azure Web Pub/Sub 연결 중...");

  try {
    const connection = await window.RubberDuckAzurePubSub.createClient({
      userId: getPlayerId(),
      roles: CONTROL_ROLES,
      groups: [CONTROL_GROUP],
      onConnected() {
        state.connected = true;
        state.connectionPhase = "connected";
        updateUI();
      },
      onDisconnected() {
        if (state.connected) {
          state.connected = false;
          state.connectionPhase = "idle";
          updateUI();
          log("연결이 끊어졌습니다.");
        }
      },
      onStopped() {
        if (state.connected) {
          state.connected = false;
          state.connectionPhase = "idle";
          updateUI();
          log("연결이 종료되었습니다.");
        }
      },
      onGroupMessage(event) {
        const payload = event?.message?.data ?? event?.data ?? event;
        console.log("[Azure Web Pub/Sub receive]", payload);
        log(`수신: ${JSON.stringify(payload)}`);
      },
    });

    if (state.connectionPhase !== "connecting") {
      await connection.stop();
      return null;
    }

    state.connection = connection;
    state.connected = true;
    state.connectionPhase = "connected";
    updateUI();
    await sendControlPayload(connection, buildJoinPayload());
    log("리모콘이 연결되었습니다.");
    return connection;
  } catch (error) {
    state.connection = null;
    state.connected = false;
    state.connectionPhase = "error";
    updateUI();
    log(`연결 실패: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

async function toggleConnection() {
  if (state.connected || state.connectionPhase === "connecting") {
    if (state.connected && state.connection) {
      try {
        await sendStopPayload(state.connection);
      } catch {
        // 연결 종료 전 정지 전송 실패는 무시합니다.
      }
    }
    disconnectRemoteClient();
    log("리모콘 연결을 해제했습니다.");
    return;
  }

  await connectRemoteClient();
}

async function sendCommand(direction) {
  if (!state.connected) {
    log("먼저 연결을 켜주세요.");
    return;
  }

  const payload = buildMovePayload(direction);

  const connection = state.connection ?? (await connectRemoteClient());
  if (!connection) {
    return;
  }

  try {
    await sendControlPayload(connection, payload);
    lastSent.textContent = `${payload.playerId} · ${payload.direction}`;
  } catch (error) {
    log(`전송 실패: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function renderTargets() {
  targetChips.innerHTML = [1, 2, 3, 4]
    .map(
      (duckId) =>
        `<button class="chip${duckId === state.selectedDuckId ? " is-selected" : ""}" data-duck="${duckId}" type="button">${getPlayerIdFor(duckId)}</button>`,
    )
    .join("");

  targetChips.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      state.selectedDuckId = Number(chip.dataset.duck);
      updateUI();
      log(`대상 변경: ${getPlayerId()}`);
      if (state.connected && state.connection) {
        void sendControlPayload(state.connection, buildJoinPayload());
      }
    });
  });
}

function getPlayerIdFor(duckId) {
  return `duck-${duckId}`;
}

function renderPad() {
  const keys = ["상좌", "상", "상우", "좌", "정지", "우", "하좌", "하", "하우"];
  directionPad.innerHTML = keys
    .map((key) => {
      const directionMap = {
        상좌: "upLeft",
        상: "up",
        상우: "upRight",
        좌: "left",
        정지: "idle",
        우: "right",
        하좌: "downLeft",
        하: "down",
        하우: "downRight",
      };
      return `<button class="pad-btn" data-direction="${directionMap[key]}" type="button">${key}</button>`;
    })
    .join("");

  directionPad.querySelectorAll(".pad-btn[data-direction]").forEach((button) => {
    button.addEventListener("click", () => {
      void sendCommand(button.dataset.direction);
    });
  });
}

connectToggle.addEventListener("click", () => {
  void toggleConnection();
});

window.addEventListener("beforeunload", () => {
  if (state.connected && state.connection) {
    void sendStopPayload(state.connection);
  }
  if (state.connection?.stop) {
    state.connection.stop();
  }
});

renderTargets();
renderPad();
updateUI();
log("리모콘 준비 완료");
