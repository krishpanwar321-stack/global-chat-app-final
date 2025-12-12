// public/client.js — Final Stable Version (with Reactions Restored + Username Labels + Enter Fix)
document.addEventListener("DOMContentLoaded", () => {
  const socket = io();
  const API_BASE = "https://neonchat-backend.onrender.com/api";

  // ============================
// AUTO LOGIN
// ============================
const savedAlias = localStorage.getItem("neon_alias");
const savedKey = localStorage.getItem("neon_recovery_key");

if (savedAlias && savedKey) {
  username = savedAlias;
  hide(intro);
  hide(usernameScreen);
  show(overlay);

  const avatar = document.querySelector(".neon-avatar");
  if (avatar) avatar.textContent = savedAlias[0].toUpperCase();
}

  /* ============================
     MATRIX BACKGROUND
  ============================ */

  const canvas = document.getElementById("matrixCanvas");
  const ctx = canvas.getContext("2d");

  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);

  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ123456789@$#%&?".split("");
  const fontSize = window.innerWidth < 600 ? 12 : 16;
  let columns = Math.floor(window.innerWidth / fontSize);
  let drops = new Array(columns).fill(1);

  function drawMatrix() {
    ctx.fillStyle = "rgba(0,0,0,0.08)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#00FF41";
    ctx.font = fontSize + "px monospace";

    drops.forEach((y, i) => {
      const text = chars[Math.floor(Math.random() * chars.length)];
      ctx.fillText(text, i * fontSize, y * fontSize);
      drops[i] = (y * fontSize > canvas.height && Math.random() > 0.97) ? 0 : y + 1;
    });
  }
  setInterval(drawMatrix, 33);


  /* ============================
     DOM REFERENCES
  ============================ */

  const intro = document.getElementById("intro");
  const usernameScreen = document.getElementById("usernameScreen");
  const overlay = document.getElementById("overlay");
  const chat = document.getElementById("chat");

  const roomsScreen = document.getElementById("roomsScreen");
  const recentScreen = document.getElementById("recentScreen");
  const settingsScreen = document.getElementById("settingsScreen");

  const usernameInput = document.getElementById("username");
  const nameError = document.getElementById("nameError");

  const roomCodeInput = document.getElementById("roomCode");
  const roomPasswordInput = document.getElementById("roomPassword");
  const errorMsg = document.getElementById("error");

  const roomTitle = document.getElementById("roomTitle");
  const userCount = document.getElementById("userCount");

  const messagesList = document.getElementById("messages");
  const msgInput = document.getElementById("msgInput");
  const form = document.getElementById("form");

  const typingText = document.getElementById("typing");
  const reactionBar = document.getElementById("reactionBar");


  /* ============================
     SCREEN SWITCHING
  ============================ */

  const navButtons = document.querySelectorAll(".nav-btn");

  function showScreen(screen) {
    roomsScreen.classList.add("hidden");
    recentScreen.classList.add("hidden");
    settingsScreen.classList.add("hidden");

    if (screen === "rooms") roomsScreen.classList.remove("hidden");
    if (screen === "recent") recentScreen.classList.remove("hidden");
    if (screen === "settings") settingsScreen.classList.remove("hidden");
  }
  showScreen("rooms");

  navButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      navButtons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      showScreen(btn.dataset.section);
    });
  });

  const show = el => el && el.classList.remove("hidden");
  const hide = el => el && el.classList.add("hidden");
  
  function generateRecoveryKey() {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("");
  }
  // Register new user (alias + recovery key)
async function registerUser(alias, recoveryKey) {
  try {
    const res = await fetch(`${API_BASE}/users/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alias, recoveryKey })
    });
    return await res.json();
  } catch (err) {
    console.error("registerUser error:", err);
    return { success: false, error: err.message || "Network error" };
  }
}

// Check if alias exists
async function verifyUser(alias) {
  try {
    const res = await fetch(`${API_BASE}/users/check/${encodeURIComponent(alias)}`);
    return await res.json();
  } catch (err) {
    console.error("verifyUser error:", err);
    return { exists: false, error: err.message || "Network error" };
  }
}


  /* ============================
     CRYPTO HELPERS
  ============================ */

  function arrayBufferToBase64(buffer) {
    return btoa(String.fromCharCode(...new Uint8Array(buffer)));
  }
  function base64ToArrayBuffer(b64) {
    return Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer;
  }

  const PBKDF2_ITER = 200000;

  async function deriveKeyFromPassword(password, saltBase64) {
    const salt = base64ToArrayBuffer(saltBase64);
    const baseKey = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveKey"]
    );

    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: PBKDF2_ITER, hash: "SHA-256" },
      baseKey,
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );
  }

  async function encryptWithKey(key, text) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(text)
    );
    return { iv: arrayBufferToBase64(iv), cipher: arrayBufferToBase64(cipher) };
  }

  async function decryptWithKey(key, payload) {
    try {
      const iv = base64ToArrayBuffer(payload.iv);
      const cipher = base64ToArrayBuffer(payload.cipher);
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: new Uint8Array(iv) },
        key,
        cipher
      );
      return new TextDecoder().decode(plain);
    } catch {
      return null;
    }
  }


  /* ============================
     STATE
  ============================ */

  let username = "";
  let roomKey = null;
  let roomSalt = null;
  let currentRoom = null;

  const pendingMessages = new Map();


  /* ============================
     LOGIN FLOW
  ============================ */

  document.getElementById("startBtn").addEventListener("click", () => {
    hide(intro);
    show(usernameScreen);
  });

  document.getElementById("continueBtn").addEventListener("click", async () => {
    nameError.textContent = ""; // clear previous error
    const alias = (usernameInput.value || "").trim();
  
    if (!alias) {
      nameError.textContent = "Please enter a username!";
      return;
    }
  
    // Disable the button briefly to prevent duplicate submits (visual optional)
    const btn = document.getElementById("continueBtn");
    btn.disabled = true;
  
    try {
      // 1 — Check if alias exists
      const check = await verifyUser(alias);
      if (check && check.exists) {
        nameError.textContent = "Alias already taken, choose another!";
        btn.disabled = false;
        return;
      }
  
      // 2 — Generate recovery key
      const recoveryKey = generateRecoveryKey();
  
      // 3 — Save to DB via backend
      const result = await registerUser(alias, recoveryKey);
      if (!result || !result.success) {
        console.error("registerUser result:", result);
        nameError.textContent = result?.error || "Could not register user. Try again.";
        btn.disabled = false;
        return;
      }
  
      // 4 — Save locally for session and recovery
      localStorage.setItem("neon_alias", alias);
      localStorage.setItem("neon_recovery_key", recoveryKey);
  
      // 5 — Continue to next screen
      username = alias;
      hide(usernameScreen);
      show(overlay);
  
      const avatar = document.querySelector(".neon-avatar");
      if (avatar) avatar.textContent = alias[0].toUpperCase();
    } catch (err) {
      console.error("Continue flow error:", err);
      nameError.textContent = "Unexpected error, try again.";
    } finally {
      btn.disabled = false;
    }
  });
  // ============================================
  // RECOVERY LOGIN (ADD THIS BELOW CONTINUE BTN)
  // ============================================
 document.getElementById("recoverBtn").addEventListener("click", () => {
  hide(usernameScreen);

  const alias = prompt("Enter your alias (username):");
  const key = prompt("Enter your recovery key:");

  if (alias && key) {
    localStorage.setItem("neon_alias", alias);
    localStorage.setItem("neon_recovery_key", key);

    username = alias;
    hide(intro);
    show(overlay);

    const avatar = document.querySelector(".neon-avatar");
    if (avatar) avatar.textContent = alias[0].toUpperCase();
  }
});

  /* ============================
     CREATE ROOM
  ============================ */

  document.getElementById("createBtn").addEventListener("click", () => {
    if (!roomPasswordInput.value.trim()) {
      errorMsg.textContent = "Enter room password";
      return;
    }
    errorMsg.textContent = "";
    socket.emit("createRoom", username);
  });


  /* ============================
     GET SALT → THEN JOIN
  ============================ */

  document.getElementById("getSaltBtn").addEventListener("click", () => {
    const room = roomCodeInput.value.trim().toUpperCase();
    const pwd = roomPasswordInput.value.trim();

    if (!room) return (errorMsg.textContent = "Enter Room Code");
    if (!pwd) return (errorMsg.textContent = "Enter Room Password");

    errorMsg.textContent = "";
    socket.emit("getSalt", { room });
  });


  /* ============================
     SERVER EVENTS
  ============================ */

  socket.on("roomCreated", (room) => {
    currentRoom = room;
    roomTitle.textContent = "Room: " + room;
  });

  socket.on("roomSalt", async ({ room, salt }) => {
    const pwd = roomPasswordInput.value.trim();
    roomPasswordInput.value = "";

    roomSalt = salt;
    roomKey = await deriveKeyFromPassword(pwd, salt);

    if (!currentRoom) currentRoom = room;

    socket.emit("joinRoom", { username, room });

    hide(overlay);
    show(chat);

    roomTitle.textContent = "Room: " + room;

    // decrypt pending
    for (const [id, entry] of pendingMessages.entries()) {
      const dec = await decryptWithKey(roomKey, entry.data.encrypted);
      entry.li.querySelector(".msg-text").textContent = dec || "🔒 Unable to decrypt";
      pendingMessages.delete(id);
    }
  });

  socket.on("systemMessage", msg => {
    const li = document.createElement("li");
    li.classList.add("message", "system");
    li.textContent = msg;
    messagesList.appendChild(li);
    messagesList.scrollTop = messagesList.scrollHeight;
  });

  socket.on("userCountUpdate", count => {
    userCount.textContent = count;
  });


  /* ============================
     SEND MESSAGE
  ============================ */

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    e.stopPropagation(); // prevents reload

    const text = msgInput.value.trim();
    if (!text) return;

    if (!roomKey) return (errorMsg.textContent = "Missing key");

    const encrypted = await encryptWithKey(roomKey, text);
    socket.emit("chatMessage", encrypted);

    msgInput.value = "";
    socket.emit("stopTyping");
  });


  /* ============================
     RECEIVE MESSAGE
  ============================ */

  socket.on("chatMessage", async (data) => {
    const { username: sender, encrypted, time, messageId } = data;

    const li = document.createElement("li");
    li.classList.add("message", sender === username ? "self" : "other");
    li.dataset.id = messageId;

    if (sender !== username) {
      const u = document.createElement("div");
      u.classList.add("msg-user");
      u.textContent = sender;
      li.appendChild(u);
    }

    const msgText = document.createElement("div");
    msgText.classList.add("msg-text");
    li.appendChild(msgText);

    const footer = document.createElement("div");
    footer.classList.add("msg-footer");
    footer.innerHTML = `<span class="msg-time">${time}</span><span class="msg-tick">✔✔</span>`;
    li.appendChild(footer);

    messagesList.appendChild(li);
    messagesList.scrollTop = messagesList.scrollHeight;

    if (roomKey) {
      const dec = await decryptWithKey(roomKey, encrypted);
      msgText.textContent = dec || "🔒 Unable to decrypt";
    } else {
      msgText.textContent = "🔒 Encrypted — enter password";
      pendingMessages.set(messageId, { data, li });
    }
  });

  socket.on("messageSent", ({ messageId }) => {
    const bubble = document.querySelector(`[data-id="${messageId}"]`);
    if (bubble) bubble.querySelector(".msg-tick").textContent = "✔";
  });


  /* ============================
     TYPING
  ============================ */

  msgInput.addEventListener("input", () => {
    socket.emit("typing");
    clearTimeout(window._typingTimer);
    window._typingTimer = setTimeout(() => socket.emit("stopTyping"), 1200);
  });

  socket.on("typing", user => typingText.textContent = `${user} typing...`);
  socket.on("stopTyping", () => typingText.textContent = "");


  /* ============================
     LEAVE ROOM
  ============================ */

  document.getElementById("leaveBtn").addEventListener("click", () => {
    location.reload();
  });


  /* ============================
     REACTIONS — FULLY RESTORED
  ============================ */

  // open reaction bar
  messagesList.addEventListener("click", (e) => {
    const msgElem = e.target.closest(".message");
    if (!msgElem || msgElem.classList.contains("system")) return;

    const rect = msgElem.getBoundingClientRect();
    reactionBar.dataset.selectedMessage = msgElem.dataset.id;

    reactionBar.style.left = rect.left + "px";
    reactionBar.style.top = rect.top - 56 + "px";

    reactionBar.classList.remove("hidden");
    reactionBar.classList.add("show");
  });

  // close reaction bar when clicking outside
  document.addEventListener("click", (e) => {
    if (!reactionBar.contains(e.target) && !e.target.closest(".message")) {
      reactionBar.classList.add("hidden");
      reactionBar.classList.remove("show");
    }
  });

  // send reaction
  reactionBar.addEventListener("click", async (e) => {
    const emoji = e.target.dataset.react;
    const messageId = reactionBar.dataset.selectedMessage;

    if (!emoji || !messageId) return;

    const payload = {
      action: "add",
      emoji,
      username
    };

    const encrypted = await encryptWithKey(roomKey, JSON.stringify(payload));
    socket.emit("addReactionEncrypted", { messageId, encryptedCipher: encrypted });

    reactionBar.classList.add("hidden");
    reactionBar.classList.remove("show");
  });

  // update reactions on a message
  socket.on("reactionUpdate", async ({ messageId, history }) => {
    const msg = document.querySelector(`[data-id="${messageId}"]`);
    if (!msg || !Array.isArray(history)) return;

    const entries = [];
    for (const item of history) {
      const dec = await decryptWithKey(roomKey, item.ciphertext);
      if (dec) entries.push(JSON.parse(dec));
    }

    const map = {};
    for (const r of entries) {
      if (!map[r.emoji]) map[r.emoji] = new Set();
      map[r.emoji].add(r.username);
    }

    let container = msg.querySelector(".reactions");
    if (!container) {
      container = document.createElement("div");
      container.classList.add("reactions");
      msg.appendChild(container);
    }

    container.innerHTML = "";

    for (const [emoji, users] of Object.entries(map)) {
      if (users.size === 0) continue;
      const badge = document.createElement("div");
      badge.classList.add("reaction-badge");
      badge.textContent = `${emoji} ${users.size}`;
      container.appendChild(badge);
    }
  });

});
