// Our Lights: connects the buttons and sliders on the page to the lights.
//
// Two ways it can run:
//  - CLOUD: the page is on GitHub Pages (https). Messages go through Adafruit IO,
//           so it works from anywhere.
//  - LOCAL: the page is served by the ESP32 itself (http). Messages go straight
//           to the ESP32, so it only works on the same WiFi.

const AIO_USERNAME = "madixbabcock";
const AIO_FEED = "lights";
const AIO_STATUS_FEED = "lights-status";
const AIO_API = `https://io.adafruit.com/api/v2/${AIO_USERNAME}/feeds`;

const CLOUD = location.protocol === "https:";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const modeNames = { text: "Message", hearts: "Hearts", rainbow: "Rainbow", clock: "Clock" };
const defaults = { mode: "text", text: "I LOVE YOU", color: "#ff0066", rainbow: false, brightness: 30, speed: 5 };

let state = { ...defaults };
let lightsOnline = null; // null = don't know yet

// ---- the secret code (Adafruit IO key), saved on this phone ------------

function readKey() {
  try { return localStorage.getItem("aioKey"); } catch (e) { return null; }
}

function saveKey(key) {
  try { localStorage.setItem("aioKey", key); } catch (e) { /* private mode: ask again next time */ }
}

function forgetKey() {
  try { localStorage.removeItem("aioKey"); } catch (e) {}
}

function getKey() {
  let key = readKey();
  if (!key) {
    key = (prompt("Enter the secret code to control the lights:") || "").trim();
    if (key) saveKey(key);
  }
  return key;
}

// ---- talking to the lights ---------------------------------------------

async function cloudFetch(path, options = {}) {
  const key = getKey();
  if (!key) throw new Error("no-key");
  const res = await fetch(`${AIO_API}/${path}`, {
    ...options,
    headers: { "X-AIO-Key": key, "Content-Type": "application/json" },
  });
  if (res.status === 401 || res.status === 403) {
    forgetKey();
    alert("That secret code didn't work. Try again.");
    throw new Error("bad-key");
  }
  return res;
}

async function send(changes) {
  try {
    if (CLOUD) {
      state = { ...state, ...changes };
      render(); // update the page right away
      const res = await cloudFetch(`${AIO_FEED}/data`, {
        method: "POST",
        body: JSON.stringify({ value: JSON.stringify(state) }),
      });
      if (res.status === 429) showStatus("Too many changes at once. Wait a few seconds.");
      else if (!res.ok) throw new Error(res.status);
    } else {
      const res = await fetch("/api/set?" + new URLSearchParams(changes).toString());
      if (!res.ok) throw new Error(res.status);
      state = await res.json();
      render();
    }
  } catch (err) {
    if (err.message !== "bad-key") showStatus("Can't reach the lights right now.");
  }
}

async function loadState() {
  try {
    if (CLOUD) {
      const res = await cloudFetch(`${AIO_FEED}/data/last`);
      if (res.ok) {
        const data = await res.json();
        try { state = { ...defaults, ...JSON.parse(data.value) }; } catch (e) {}
      }
      // The ESP32 checks in every 5 minutes. If we heard from it recently, it's online.
      const statusRes = await cloudFetch(`${AIO_STATUS_FEED}/data/last`);
      if (statusRes.ok) {
        const status = await statusRes.json();
        lightsOnline = Date.now() - Date.parse(status.created_at) < 7 * 60 * 1000;
      } else {
        lightsOnline = false;
      }
    } else {
      const res = await fetch("/api/state");
      state = await res.json();
      lightsOnline = true;
    }
    render();
  } catch (err) {
    if (err.message !== "bad-key") showStatus("Can't reach the lights right now.");
  }
}

// Sliders and the color picker fire many events while dragging.
// This only sends once you pause.
function throttle(fn, wait) {
  let timer = null;
  let lastArgs = null;
  return (...args) => {
    lastArgs = args;
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      fn(...lastArgs);
    }, wait);
  };
}

// ---- updating the page to match ----------------------------------------

function showStatus(text) {
  const el = $("#nowShowing");
  if (el) el.textContent = text;
}

function render() {
  let text = state.mode === "text"
    ? "Now showing: " + state.text
    : "Now showing: " + (modeNames[state.mode] || state.mode);
  if (lightsOnline === false) text += " (lights are offline, it'll show when they're back)";
  showStatus(text);

  $$(".mode").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === state.mode);
  });
  $$(".preset").forEach((btn) => {
    btn.classList.toggle("active", state.mode === "text" && btn.dataset.text === state.text);
  });

  // Don't move a control while someone is using it
  setIfNotFocused("#color", "value", state.color);
  setIfNotFocused("#brightness", "value", state.brightness);
  setIfNotFocused("#speed", "value", state.speed);
  setIfNotFocused("#rainbowText", "checked", !!state.rainbow);
}

function setIfNotFocused(sel, prop, value) {
  const el = $(sel);
  if (el && document.activeElement !== el && value !== undefined) el[prop] = value;
}

// ---- hooking up the controls -------------------------------------------

$$(".preset").forEach((btn) => {
  btn.addEventListener("click", () => send({ mode: "text", text: btn.dataset.text }));
});

$$(".mode").forEach((btn) => {
  btn.addEventListener("click", () => send({ mode: btn.dataset.mode }));
});

const customText = $("#customText");
const sendText = () => {
  const text = customText.value.trim();
  if (!text) {
    customText.focus();
    customText.placeholder = "Type something first!";
    return;
  }
  send({ mode: "text", text });
  customText.value = "";
  customText.blur(); // closes the iPhone keyboard
};
$("#sendText")?.addEventListener("click", sendText);
customText?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendText();
});

// The cloud allows about 30 messages a minute, so in cloud mode the sliders and
// color picker only send when you let go. On the local WiFi they update live.
const liveEvent = CLOUD ? "change" : "input";
const sendColor = throttle((v) => send({ color: v }), 150);
const sendBrightness = throttle((v) => send({ brightness: Number(v) }), 150);
const sendSpeed = throttle((v) => send({ speed: Number(v) }), 150);

$("#color")?.addEventListener(liveEvent, (e) => sendColor(e.target.value));
$("#brightness")?.addEventListener(liveEvent, (e) => sendBrightness(e.target.value));
$("#speed")?.addEventListener(liveEvent, (e) => sendSpeed(e.target.value));
$("#rainbowText")?.addEventListener("change", (e) => send({ rainbow: e.target.checked }));

// Refresh when the app is reopened, and every 30 seconds while it's open,
// in case the other person changed something.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) loadState();
});
setInterval(() => {
  if (!document.hidden) loadState();
}, 30000);

loadState();
