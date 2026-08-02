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
    this.hidden = false;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this.className = "";
    this.srcObject = null;
  }

  addEventListener(type, handler) {
    this.listeners[type] = handler;
  }

  click() {
    this.listeners.click?.();
  }

  change() {
    this.listeners.change?.();
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = children;
  }

  play() {
    return Promise.resolve();
  }

  pause() {}
  load() {}
}

class FakeDataChannel {
  constructor() {
    this.readyState = "open";
    this.sent = [];
  }

  send(payload) {
    this.sent.push(JSON.parse(payload));
  }

  emit(event) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }

  close() {
    this.readyState = "closed";
  }
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

  createDataChannel() {
    return this.channel;
  }

  addTrack() {}

  async createOffer() {
    return { type: "offer", sdp: "offer-sdp" };
  }

  async setLocalDescription(description) {
    this.localDescription = description;
  }

  async setRemoteDescription() {}

  close() {
    this.closed = true;
    this.connectionState = "closed";
  }
}

function settle() {
  return new Promise((resolve) => setImmediate(resolve));
}

function createHarness() {
  FakePeerConnection.instances = [];
  const selectors = [
    "#status-dot",
    "#status-text",
    "#start-button",
    "#stop-button",
    "#interpreter-mode",
    "#companion-mode",
    "#mode-title",
    "#mode-eyebrow",
    "#interpreter-language-card",
    "#companion-language-card",
    "#target-language",
    "#companion-language",
    "#interpreter-transcripts",
    "#companion-transcript-card",
    "#original-transcript",
    "#translation-transcript",
    "#conversation-log",
    "#translated-audio"
  ];
  const elements = Object.fromEntries(
    selectors.map((selector) => [selector, new FakeElement()])
  );
  elements["#target-language"].value = "Spanish";
  elements["#companion-language"].value = "English";

  const tracks = [];
  const streams = [];
  const document = {
    querySelector(selector) {
      return elements[selector];
    },
    createElement() {
      return new FakeElement();
    }
  };
  const window = {
    RTCPeerConnection: FakePeerConnection,
    addEventListener() {},
    cancelAnimationFrame() {},
    clearTimeout,
    requestAnimationFrame(callback) {
      callback();
      return 1;
    },
    setTimeout(callback) {
      callback();
      return 1;
    }
  };
  const navigator = {
    mediaDevices: {
      async getUserMedia() {
        const track = {
          contentHint: "",
          enabled: true,
          stopped: false,
          stop() {
            this.stopped = true;
          }
        };
        const stream = {
          getAudioTracks: () => [track],
          getTracks: () => [track]
        };
        tracks.push(track);
        streams.push(stream);
        return stream;
      }
    }
  };
  const fetchCalls = [];
  async function fetch(url, options) {
    fetchCalls.push({ url, options });
    if (url === "/api/realtime/session") {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ value: "short-lived-test-token" })
      };
    }
    return { ok: true, status: 200, text: async () => "answer-sdp" };
  }

  const context = vm.createContext({
    console,
    document,
    fetch,
    MediaStream: class {},
    navigator,
    RTCPeerConnection: FakePeerConnection,
    window
  });
  const appSource = fs.readFileSync(
    path.join(__dirname, "..", "public", "app.js"),
    "utf8"
  );
  vm.runInContext(appSource, context);
  return { elements, fetchCalls, tracks };
}

test("Companion barge-in stays live and Interpreter behavior remains isolated", async () => {
  const { elements, fetchCalls, tracks } = createHarness();

  elements["#companion-mode"].click();
  assert.equal(elements["#mode-title"].textContent, "Companion");
  assert.equal(elements["#start-button"].textContent, "START CONVERSATION");
  assert.equal(elements["#companion-language-card"].hidden, false);
  elements["#companion-language"].value = "Spanish";
  elements["#start-button"].click();
  await settle();
  await settle();

  const companionPeer = FakePeerConnection.instances[0];
  const companionRequest = JSON.parse(fetchCalls[0].options.body);
  assert.deepEqual(companionRequest, {
    languageOne: "Spanish",
    languageTwo: "Spanish",
    mode: "companion"
  });
  companionPeer.channel.emit({
    type: "response.created",
    response: { id: "response-1" }
  });
  companionPeer.channel.emit({
    type: "response.output_item.added",
    item: { id: "assistant-1", role: "assistant" }
  });
  companionPeer.channel.emit({
    type: "output_audio_buffer.started",
    response_id: "response-1"
  });
  assert.equal(tracks[0].enabled, true);

  companionPeer.channel.emit({ type: "input_audio_buffer.speech_started" });
  assert.deepEqual(
    companionPeer.channel.sent.map((event) => event.type),
    [
      "response.cancel",
      "output_audio_buffer.clear",
      "conversation.item.truncate"
    ]
  );
  assert.equal(elements["#status-text"].textContent, "Listening…");

  elements["#interpreter-mode"].click();
  assert.equal(companionPeer.closed, true);
  assert.equal(tracks[0].stopped, true);
  assert.equal(elements["#mode-title"].textContent, "Interpreter");
  assert.equal(elements["#start-button"].textContent, "Start Interpreter");

  elements["#target-language"].value = "Brazilian Portuguese";
  elements["#target-language"].change();
  elements["#start-button"].click();
  await settle();
  await settle();
  const interpreterPeer = FakePeerConnection.instances[1];
  assert.deepEqual(JSON.parse(fetchCalls[2].options.body), {
    languageOne: "English",
    languageTwo: "Brazilian Portuguese",
    mode: "browser-two-way"
  });
  interpreterPeer.channel.emit({
    type: "response.created",
    response: { id: "response-2" }
  });
  assert.equal(tracks[1].enabled, false);

  elements["#stop-button"].click();
  assert.equal(interpreterPeer.closed, true);
  assert.equal(tracks[1].stopped, true);
  assert.equal(elements["#status-text"].textContent, "Ready");
  assert.equal(elements["#start-button"].disabled, false);
});

test("Companion keeps five conversational turns and cancels repeated responses", async () => {
  const { elements, fetchCalls } = createHarness();
  elements["#companion-mode"].click();
  elements["#companion-language"].value = "Brazilian Portuguese";
  elements["#companion-language"].change();
  elements["#start-button"].click();
  await settle();
  await settle();
  const peer = FakePeerConnection.instances[0];
  assert.deepEqual(JSON.parse(fetchCalls[0].options.body), {
    languageOne: "Brazilian Portuguese",
    languageTwo: "Spanish",
    mode: "companion"
  });

  for (let index = 1; index <= 5; index += 1) {
    const responseId = `normal-${index}`;
    peer.channel.emit({ type: "input_audio_buffer.speech_started" });
    peer.channel.emit({ type: "input_audio_buffer.speech_stopped" });
    peer.channel.emit({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: `user-${index}`,
      transcript: `User turn ${index}`
    });
    peer.channel.emit({
      type: "response.created",
      response: { id: responseId }
    });
    peer.channel.emit({
      type: "response.output_item.added",
      item: { id: `assistant-${index}`, role: "assistant" }
    });
    peer.channel.emit({
      type: "response.output_audio_transcript.done",
      response_id: responseId,
      transcript: `Companion turn ${index}`
    });
    peer.channel.emit({
      type: "output_audio_buffer.started",
      response_id: responseId
    });
    peer.channel.emit({
      type: "output_audio_buffer.stopped",
      response_id: responseId
    });
  }

  assert.equal(elements["#conversation-log"].children.length, 10);
  assert.equal(elements["#status-text"].textContent, "Listening…");

  const sentBeforeInterruptions = peer.channel.sent.length;
  for (let index = 1; index <= 3; index += 1) {
    const responseId = `interrupted-${index}`;
    peer.channel.emit({
      type: "response.created",
      response: { id: responseId }
    });
    peer.channel.emit({
      type: "response.output_item.added",
      item: { id: `interrupted-item-${index}`, role: "assistant" }
    });
    peer.channel.emit({
      type: "output_audio_buffer.started",
      response_id: responseId
    });
    peer.channel.emit({ type: "input_audio_buffer.speech_started" });
  }

  assert.deepEqual(
    peer.channel.sent
      .slice(sentBeforeInterruptions)
      .map((event) => event.type),
    [
      "response.cancel",
      "output_audio_buffer.clear",
      "conversation.item.truncate",
      "response.cancel",
      "output_audio_buffer.clear",
      "conversation.item.truncate",
      "response.cancel",
      "output_audio_buffer.clear",
      "conversation.item.truncate"
    ]
  );
  assert.equal(elements["#status-text"].textContent, "Listening…");
});
