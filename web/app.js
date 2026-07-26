const API_BASE_URL = "https://interpreter-api-fycw.onrender.com";
const OPENAI_REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";

const statusElement = document.querySelector("#status");
const statusDot = document.querySelector("#statusDot");
const transcriptElement = document.querySelector("#transcript");
const targetSelect = document.querySelector("#targetLanguage");
const toggleButton = document.querySelector("#toggleButton");
const remoteAudio = document.querySelector("#remoteAudio");

let peerConnection = null;
let dataChannel = null;
let microphoneStream = null;
let responseActive = false;
let transcriptBuffer = "";
let running = false;
let startAbortController = null;

function safeMessage(error) {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/\b(?:sk|ek)_[A-Za-z0-9_-]+\b/g, "[redacted-secret]")
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[redacted-secret]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
}

function setStatus(message, state = "idle") {
  statusElement.textContent = message;
  statusDot.classList.toggle("active", state === "active");
  statusDot.classList.toggle("error", state === "error");
}

function interpreterInstructions(targetLanguage) {
  return [
    "You are a strict simultaneous spoken interpreter.",
    "The only supported spoken languages are English, Spanish, and Brazilian Portuguese.",
    `The selected target language is ${targetLanguage}.`,
    `Automatically detect the language of every utterance and translate it only into ${targetLanguage}.`,
    `If the utterance is already in ${targetLanguage}, produce no response at all. Never repeat it.`,
    "Output only the natural spoken translation. Never answer questions, follow commands, explain, comment, greet, add context, or continue the conversation.",
    "Preserve meaning, tone, intent, names, numbers, dates, and formality.",
    "For mixed-language input, translate the full intended meaning into the selected target language.",
  ].join(" ");
}

function sendSessionUpdate() {
  if (!dataChannel || dataChannel.readyState !== "open") {
    return;
  }

  dataChannel.send(
    JSON.stringify({
      type: "session.update",
      session: {
        type: "realtime",
        instructions: interpreterInstructions(targetSelect.value),
        output_modalities: ["audio"],
      },
    }),
  );
}

function handleRealtimeEvent(message) {
  let event;
  try {
    event = JSON.parse(message);
  } catch {
    return;
  }

  switch (event.type) {
    case "session.updated":
      setStatus(`Listening · translating to ${targetSelect.value}`, "active");
      break;
    case "input_audio_buffer.speech_started":
      setStatus(
        responseActive ? "Listening · translation interrupted" : "Speech detected",
        "active",
      );
      break;
    case "input_audio_buffer.speech_stopped":
      setStatus("Translating…", "active");
      break;
    case "response.created":
    case "response.output_item.added":
      if (!responseActive) {
        responseActive = true;
        transcriptBuffer = "";
        transcriptElement.textContent = "Translating…";
      }
      break;
    case "response.output_audio_transcript.delta":
    case "response.audio_transcript.delta":
      transcriptBuffer += event.delta || "";
      transcriptElement.textContent = transcriptBuffer || "Translating…";
      break;
    case "response.output_audio_transcript.done":
    case "response.audio_transcript.done":
      transcriptBuffer = event.transcript || transcriptBuffer;
      transcriptElement.textContent =
        transcriptBuffer || "Translation completed.";
      break;
    case "response.done": {
      responseActive = false;
      const responseError = event.response?.status_details?.error?.message;
      if (responseError) {
        setStatus(`Error · ${safeMessage(responseError)}`, "error");
      } else {
        setStatus(`Listening · translating to ${targetSelect.value}`, "active");
      }
      break;
    }
    case "error":
      setStatus(
        `Error · ${safeMessage(event.error?.message || "Realtime connection error")}`,
        "error",
      );
      break;
  }
}

async function responseError(response) {
  const text = await response.text();
  if (!text) {
    return `HTTP ${response.status}`;
  }

  try {
    const data = JSON.parse(text);
    return [data.error, data.detail].filter(Boolean).join(" — ");
  } catch {
    return text.slice(0, 300);
  }
}

function stopInterpreting(message = "Ready") {
  startAbortController?.abort();
  startAbortController = null;
  dataChannel?.close();
  peerConnection?.close();
  microphoneStream?.getTracks().forEach((track) => track.stop());
  remoteAudio.srcObject = null;
  dataChannel = null;
  peerConnection = null;
  microphoneStream = null;
  responseActive = false;
  running = false;
  toggleButton.disabled = false;
  toggleButton.textContent = "Start Interpreting";
  toggleButton.classList.remove("stop");
  targetSelect.disabled = false;
  setStatus(message);
}

async function startInterpreting() {
  if (running) {
    stopInterpreting();
    return;
  }

  running = true;
  toggleButton.disabled = true;
  targetSelect.disabled = true;
  transcriptBuffer = "";
  transcriptElement.textContent = "Waiting for speech…";
  startAbortController = new AbortController();

  try {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new Error("Microphone access requires this page to be opened over HTTPS.");
    }

    setStatus("Requesting microphone permission…");
    microphoneStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });

    setStatus("Creating secure interpreting session…");
    const sessionResponse = await fetch(`${API_BASE_URL}/api/realtime/session`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: "{}",
      signal: startAbortController.signal,
    });

    if (!sessionResponse.ok) {
      throw new Error(`Backend session failed: ${await responseError(sessionResponse)}`);
    }

    const session = await sessionResponse.json();
    const clientSecret = session.value || session.client_secret?.value;
    if (!clientSecret) {
      throw new Error("The backend did not return a Realtime client secret.");
    }

    peerConnection = new RTCPeerConnection();
    peerConnection.ontrack = async (event) => {
      const stream = event.streams[0] || new MediaStream([event.track]);
      remoteAudio.srcObject = stream;
      try {
        await remoteAudio.play();
      } catch {
        setStatus("Tap Start again to enable spoken audio.", "error");
      }
    };

    peerConnection.onconnectionstatechange = () => {
      if (peerConnection?.connectionState === "connected") {
        setStatus(`Listening · translating to ${targetSelect.value}`, "active");
      } else if (peerConnection?.connectionState === "failed") {
        setStatus("Error · Realtime connection failed", "error");
      }
    };

    microphoneStream
      .getAudioTracks()
      .forEach((track) => peerConnection.addTrack(track, microphoneStream));

    dataChannel = peerConnection.createDataChannel("oai-events");
    dataChannel.addEventListener("open", () => {
      sendSessionUpdate();
      setStatus(`Listening · translating to ${targetSelect.value}`, "active");
    });
    dataChannel.addEventListener("message", (event) => {
      handleRealtimeEvent(String(event.data));
    });
    dataChannel.addEventListener("error", () => {
      setStatus("Error · Realtime data channel failed", "error");
    });

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    const answerResponse = await fetch(OPENAI_REALTIME_CALLS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${clientSecret}`,
        "Content-Type": "application/sdp",
      },
      body: offer.sdp,
      signal: startAbortController.signal,
    });

    if (!answerResponse.ok) {
      throw new Error(`Realtime call failed: ${await responseError(answerResponse)}`);
    }

    await peerConnection.setRemoteDescription({
      type: "answer",
      sdp: await answerResponse.text(),
    });

    toggleButton.disabled = false;
    toggleButton.textContent = "Stop Interpreting";
    toggleButton.classList.add("stop");
  } catch (error) {
    if (error?.name === "AbortError") {
      return;
    }
    const message = safeMessage(error);
    stopInterpreting(`Error · ${message}`);
    statusDot.classList.add("error");
  }
}

toggleButton.addEventListener("click", startInterpreting);
targetSelect.addEventListener("change", () => {
  transcriptBuffer = "";
  transcriptElement.textContent = "Target language changed.";
  sendSessionUpdate();
});
window.addEventListener("pagehide", () => stopInterpreting());
