const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

class FakeElement {
  constructor(value = "") {
    this.value = value;
    this.textContent = "";
    this.disabled = false;
    this.dataset = {};
    this.listeners = {};
    this.srcObject = null;
  }
  addEventListener(type, handler) { this.listeners[type] = handler; }
  click() { this.listeners.click?.(); }
  change() { this.listeners.change?.(); }
  removeAttribute() {}
  play() { return Promise.resolve(); }
  pause() {}
  load() {}
}

class FakeDataChannel {
  constructor() { this.readyState = "open"; this.sent = []; }
  emit(event) { this.onmessage?.({ data: JSON.stringify(event) }); }
  close() { this.readyState = "closed"; }
}

class FakePeerConnection {
  static instances = [];
  constructor() {
    this.connectionState = "new";
    this.localDescription = null;
    this.channel = new FakeDataChannel();
    this.closed = false;
    FakePeerConnection.instances.push(this);
  }
  createDataChannel() { return this.channel; }
  addTrack() {}
  async createOffer() { return { type: "offer", sdp: "offer-sdp" }; }
  async setLocalDescription(description) { this.localDescription = description; }
  async setRemoteDescription() {}
  close() { this.closed = true; this.connectionState = "closed"; }
}

function settle() { return new Promise((resolve) => setImmediate(resolve)); }

function createHarness() {
  FakePeerConnection.instances = [];
  const selectors = [
    "#status-dot", "#status-text", "#start-button", "#stop-button",
    "#target-language", "#mode-eyebrow", "#original-transcript",
    "#translation-transcript", "#translated-audio"
  ];
  const elements = Object.fromEntries(selectors.map((selector) => [selector, new FakeElement()]));
  elements["#target-language"].value = "Spanish";
  const tracks = [];
  const fetchCalls = [];
  const document = { querySelector: (selector) => elements[selector] };
  const window = {
    RTCPeerConnection: FakePeerConnection,
    addEventListener() {}, clearTimeout,
    setTimeout(callback) { callback(); return 1; }
  };
  const navigator = { mediaDevices: { async getUserMedia() {
    const track = { contentHint: "", enabled: true, stopped: false, stop() { this.stopped = true; } };
    tracks.push(track);
    return { getAudioTracks: () => [track], getTracks: () => [track] };
  } } };
  async function fetch(url, options) {
    fetchCalls.push({ url, options });
    if (url === "/api/realtime/session") {
      return { ok: true, status: 200, text: async () => JSON.stringify({ value: "temporary-token" }) };
    }
    return { ok: true, status: 200, text: async () => "answer-sdp" };
  }
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8"),
    vm.createContext({ console, document, fetch, MediaStream: class {}, navigator, RTCPeerConnection: FakePeerConnection, window })
  );
  return { elements, fetchCalls, tracks };
}

test("browser starts a two-way interpreter session and protects against speaker echo", async () => {
  const { elements, fetchCalls, tracks } = createHarness();
  elements["#start-button"].click();
  await settle();
  await settle();

  assert.deepEqual(JSON.parse(fetchCalls[0].options.body), {
    languageOne: "English", languageTwo: "Spanish", mode: "browser-two-way"
  });
  const peer = FakePeerConnection.instances[0];
  peer.channel.emit({ type: "response.created", response: { id: "r1" } });
  assert.equal(tracks[0].enabled, false);
  peer.channel.emit({ type: "output_audio_buffer.stopped" });
  assert.equal(tracks[0].enabled, true);

  peer.channel.emit({ type: "conversation.item.input_audio_transcription.completed", transcript: "Good morning" });
  peer.channel.emit({ type: "response.output_audio_transcript.done", transcript: "Buenos días" });
  assert.equal(elements["#original-transcript"].textContent, "Good morning");
  assert.equal(elements["#translation-transcript"].textContent, "Buenos días");
});

test("browser switches target language and Stop releases microphone and peer", async () => {
  const { elements, fetchCalls, tracks } = createHarness();
  elements["#target-language"].value = "Brazilian Portuguese";
  elements["#target-language"].change();
  assert.equal(elements["#mode-eyebrow"].textContent, "ENGLISH ↔ PORTUGUÊS (BRASIL)");
  elements["#start-button"].click();
  await settle();
  await settle();
  assert.equal(JSON.parse(fetchCalls[0].options.body).languageTwo, "Brazilian Portuguese");
  const peer = FakePeerConnection.instances[0];
  elements["#stop-button"].click();
  assert.equal(peer.closed, true);
  assert.equal(tracks[0].stopped, true);
  assert.equal(elements["#status-text"].textContent, "Ready");
});
