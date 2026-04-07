(() => {
  const CONFIG = {
    endpoint: "https://monolith.webpubsub.azure.com",
    host: "monolith.webpubsub.azure.com",
    hub: "rubberduck",
    group: "rubberduck-room1",
    clientAccessUrl:
      "wss://monolith.webpubsub.azure.com/client/hubs/rubberduck?access_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJ3c3M6Ly9tb25vbGl0aC53ZWJwdWJzdWIuYXp1cmUuY29tL2NsaWVudC9odWJzL3J1YmJlcmR1Y2siLCJpYXQiOjE3NzU1NjQyNTIsImV4cCI6MTc3NTY1MDY1Miwicm9sZSI6WyJ3ZWJwdWJzdWIuc2VuZFRvR3JvdXAiLCJ3ZWJwdWJzdWIuam9pbkxlYXZlR3JvdXAiXSwic3ViIjoibW9ub2xpdGgifQ.2fRPHzFxy9MJY8Wf68N_eJpRA4OampOLG-FDaPFA818",
    connectionString:
      "Endpoint=https://monolith.webpubsub.azure.com;AccessKey=57YFuX4JHlk4qz1HpSIBVuCTGYFm0kg4XQOv01788mDAD3kySrwTJQQJ99CDACNns7RXJ3w3AAAAAWPS1Fxv;Version=1.0;",
    tokenMinutes: 60,
  };

  function parseConnectionString(connectionString) {
    const parts = connectionString
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean)
      .reduce((acc, item) => {
        const separatorIndex = item.indexOf("=");
        if (separatorIndex === -1) return acc;
        const key = item.slice(0, separatorIndex);
        const value = item.slice(separatorIndex + 1);
        acc[key] = value;
        return acc;
      }, {});

    return {
      endpoint: parts.Endpoint || CONFIG.endpoint,
      accessKey: parts.AccessKey || "",
    };
  }

  function base64UrlEncode(bytes) {
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });

    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function base64ToBytes(base64) {
    const normalized = base64.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  function serializeJwtPayload({ aud, exp, sub, roles = [], groups = [] }) {
    const claims = [`"aud":${JSON.stringify(aud)}`, `"exp":${exp}`];

    if (sub) {
      claims.push(`"sub":${JSON.stringify(sub)}`);
    }

    roles.forEach((role) => {
      claims.push(`"role":${JSON.stringify(role)}`);
    });

    groups.forEach((group) => {
      claims.push(`"webpubsub.group":${JSON.stringify(group)}`);
    });

    return `{${claims.join(",")}}`;
  }

  async function signJwt(requestUrl, accessKey, minutesToExpire = CONFIG.tokenMinutes, extraClaims = {}) {
    const header = { alg: "HS256", typ: "JWT" };
    const payloadJson = serializeJwtPayload({
      aud: requestUrl,
      exp: Math.floor(Date.now() / 1000) + minutesToExpire * 60,
      sub: extraClaims.sub,
      roles: extraClaims.roles ?? [],
      groups: extraClaims.groups ?? [],
    });

    const textEncoder = new TextEncoder();
    const headerSegment = base64UrlEncode(textEncoder.encode(JSON.stringify(header)));
    const payloadSegment = base64UrlEncode(textEncoder.encode(payloadJson));
    const signingInput = textEncoder.encode(`${headerSegment}.${payloadSegment}`);

    const key = await crypto.subtle.importKey(
      "raw",
      base64ToBytes(accessKey),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );

    const signature = await crypto.subtle.sign("HMAC", key, signingInput);
    const signatureSegment = base64UrlEncode(new Uint8Array(signature));

    return `${headerSegment}.${payloadSegment}.${signatureSegment}`;
  }

  async function buildClientAccessUrl({ userId, roles = [], groups = [] } = {}) {
    if (CONFIG.clientAccessUrl) {
      return CONFIG.clientAccessUrl;
    }

    const { accessKey } = parseConnectionString(CONFIG.connectionString);
    const clientUrl = `wss://${CONFIG.host}/client/hubs/${CONFIG.hub}`;
    const jwt = await signJwt(clientUrl, accessKey, CONFIG.tokenMinutes, {
      ...(userId ? { sub: userId } : {}),
      roles,
      groups,
    });
    return `${clientUrl}?access_token=${encodeURIComponent(jwt)}`;
  }

  function createRawClient(accessUrl, { onConnected, onDisconnected, onStopped, onGroupMessage } = {}) {
    const socket = new WebSocket(accessUrl, "json.webpubsub.azure.v1");
    const pendingAcks = new Map();
    let nextAckId = 1;
    let stopped = false;

    function sendJsonMessage(message) {
      if (socket.readyState !== WebSocket.OPEN) {
        throw new Error("WebSocket이 연결되지 않았습니다.");
      }

      const ackId = nextAckId++;
      const payload = { ...message, ackId };

      const ackPromise = new Promise((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          pendingAcks.delete(ackId);
          reject(new Error("명령 전송 응답이 시간 내에 도착하지 않았습니다."));
        }, 5000);

        pendingAcks.set(ackId, {
          resolve(value) {
            window.clearTimeout(timeout);
            resolve(value);
          },
          reject(error) {
            window.clearTimeout(timeout);
            reject(error);
          },
        });
      });

      socket.send(JSON.stringify(payload));
      return ackPromise;
    }

    const client = {
      async start() {
        if (socket.readyState === WebSocket.OPEN) {
          return;
        }

        await new Promise((resolve, reject) => {
          const handleOpen = () => {
            socket.removeEventListener("error", handleError);
            resolve();
          };

          const handleError = () => {
            socket.removeEventListener("open", handleOpen);
            reject(new Error("WebSocket 연결에 실패했습니다."));
          };

          socket.addEventListener("open", handleOpen, { once: true });
          socket.addEventListener("error", handleError, { once: true });
        });
      },
      async joinGroup(groupName) {
        return sendJsonMessage({
          type: "joinGroup",
          group: groupName,
        });
      },
      async sendToGroup(groupName, data, dataType = "json", options = {}) {
        return sendJsonMessage({
          type: "sendToGroup",
          group: groupName,
          noEcho: Boolean(options.noEcho),
          dataType,
          data,
        });
      },
      async stop() {
        stopped = true;
        if (socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
          return;
        }
        socket.close(1000, "client stop");
      },
      raw: socket,
    };

    socket.addEventListener("open", () => {
      console.log("[Azure Web Pub/Sub socket] open", { accessUrl });
      onConnected?.({ type: "connected" });
    });

    socket.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }

      if (message.type === "ack" && typeof message.ackId === "number") {
        const pending = pendingAcks.get(message.ackId);
        if (!pending) return;
        pendingAcks.delete(message.ackId);

        if (message.success !== false) {
          pending.resolve(message);
        } else {
          pending.reject(new Error(message.error?.message || "명령 전송에 실패했습니다."));
        }
        return;
      }

      if (message.type === "message" || message.type === "system") {
        onGroupMessage?.({ message });
      }
    });

    socket.addEventListener("close", () => {
      const wasStopped = stopped;
      pendingAcks.forEach((pending) => pending.reject(new Error("WebSocket이 종료되었습니다.")));
      pendingAcks.clear();
      console.log("[Azure Web Pub/Sub socket] close", {
        wasStopped,
        readyState: socket.readyState,
      });
      if (wasStopped) {
        onStopped?.({ type: "stopped" });
      } else {
        onDisconnected?.({ type: "disconnected" });
      }
    });

    socket.addEventListener("error", (event) => {
      console.error("[Azure Web Pub/Sub socket] error", event);
    });

    return client;
  }

  async function createClient({
    userId,
    roles = [],
    groups = [],
    onConnected,
    onDisconnected,
    onStopped,
    onGroupMessage,
  } = {}) {
    const accessUrl = await buildClientAccessUrl({ userId, roles, groups });
    const client = createRawClient(accessUrl, {
      onConnected,
      onDisconnected,
      onStopped,
      onGroupMessage,
    });

    await client.start();
    for (const group of groups) {
      await client.joinGroup(group);
    }
    return client;
  }

  window.RubberDuckAzurePubSub = {
    config: CONFIG,
    createClient,
    buildClientAccessUrl,
  };
})();
