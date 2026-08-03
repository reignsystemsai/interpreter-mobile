(() => {
  "use strict";

  const statusDot = document.querySelector("#status-dot");
  const statusText = document.querySelector("#status-text");
  const startButton = document.querySelector("#start-button");
  const stopButton = document.querySelector("#stop-button");
  const targetLanguageSelect = document.querySelector("#target-language");
  const modeEyebrow = document.querySelector("#mode-eyebrow");
  const originalTranscript = document.querySelector("#original-transcript");
  const translationTranscript = document.querySelector("#translation-transcript");
  const translatedAudio = document.querySelector("#translated-audio");

  let peerConnection = null;
  let dataChannel = null;
  let microphoneStream = null;
  let microphoneTrack = null;
  let starting = false;
  let userStopped = false;
  let echoResumeTimer = null;
  let translationBuffer = "";

  function selectedLanguage() {
    return targetLanguageSelect.value;
  }

  function displayLanguage(language) {
    return language === "Brazilian Portuguese" ? "PORTUGUÊS (BRASIL)" : language.toUpperCase();
  }

  function updateLanguageLabel() {
    modeEyebrow.textContent = `ENGLISH ↔ ${displayLanguage(selectedLanguage())}`;
    if (!peerConnection && !starting) {
      originalTranscript.textContent = `The latest English or ${selectedLanguage()} speech will appear here.`;
    }
  }

  function setStatus(message, state = "idle") {
    statusText.textContent = message;
    statusDot.dataset.state = state;
  }

  function setControls(active) {
    startButton.disabled = active;
    stopButton.disabled = !active;
    targetLanguageSelect.disabled = active;
  }

  function setMicrophoneEnabled(enabled) {
    if (microphoneTrack) microphoneTrack.enabled = enabled;
  }

  function clearEchoTimer() {
    if (echoResumeTimer !== null) window.clearTimeout(echoResumeTimer);
    echoResumeTimer = null;
  }

  function stopInterpreter({ preserveError = false } = {}) {
    userStopped = true;
    starting = false;
    clearEchoTimer();
    dataChannel?.close();
    dataChannel = null;
    microphoneStream?.getTracks().forEach((track) => track.stop());
    microphoneStream = null;
    microphoneTrack = null;
    peerConnection?.close();
    peerConnection = null;
    translatedAudio.pause();
    translatedAudio.srcObject = null;
    translatedAudio.removeAttribute("src");
    translatedAudio.load();
    translationBuffer = "";
    setControls(false);
    if (!preserveError) setStatus("Ready", "idle");
  }

  function fail(message) {
    stopInterpreter({ preserveError: true });
    setStatus(message, "error");
  }

  function parseSessionCredential(payload) {
    const parsed = JSON.parse(payload);
    const value = parsed?.value ?? parsed?.client_secret?.value;
    if (!value) throw new Error(parsed?.error || "Session credential was missing.");
    return value;
  }

  function handleRealtimeEvent(event) {
    if (event.type === "conversation.item.input_audio_transcription.completed") {
      const text = event.transcript?.trim();
      if (text) originalTranscript.textContent = text;
      setStatus("Translating…", "working");
      return;
    }

    if (event.type === "response.output_audio_transcript.delta") {
      translationBuffer += event.delta ?? "";
      if (translationBuffer.trim()) translationTranscript.textContent = translationBuffer.trim();
      return;
    }

    if (event.type === "response.output_audio_transcript.done") {
      const text = event.transcript?.trim() || translationBuffer.trim();
      if (text) translationTranscript.textContent = text;
      translationBuffer = "";
      return;
    }

    if (event.type === "response.created") {
      translationBuffer = "";
      setMicrophoneEnabled(false);
      setStatus("Translating…", "working");
      return;
    }

    if (event.type === "output_audio_buffer.started") {
      setMicrophoneEnabled(false);
      setStatus("Speaking translation…", "speaking");
      return;
    }

    if (
      event.type === "output_audio_buffer.stopped" ||
      event.type === "output_audio_buffer.cleared"
    ) {
      clearEchoTimer();
      echoResumeTimer = window.setTimeout(() => {
        setMicrophoneEnabled(true);
        setStatus(`Listening for English or ${selectedLanguage()}…`, "listening");
        echoResumeTimer = null;
      }, 550);
      return;
    }

    if (event.type === "error") {
      fail(event.error?.message || "OpenAI connection failed.");
      return;
    }

    if (
      event.type === "response.done" &&
      ["failed", "incomplete"].includes(event.response?.status)
    ) {
      fail(event.response?.status_details?.error?.message || "Translation failed.");
    }
  }

  async function startInterpreter() {
    if (starting || peerConnection) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
      fail("This browser does not support microphone WebRTC.");
      return;
    }

    starting = true;
    userStopped = false;
    setControls(true);
    setStatus("Requesting microphone…", "working");

    try {
      microphoneStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      microphoneTrack = microphoneStream.getAudioTracks()[0];
      if (!microphoneTrack) throw new Error("No microphone audio track was available.");
      if ("contentHint" in microphoneTrack) microphoneTrack.contentHint = "speech";

      setStatus("Creating secure session…", "working");
      const sessionResponse = await fetch("/api/realtime/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          languageOne: "English",
          languageTwo: selectedLanguage(),
          mode: "browser-two-way"
        })
      });
      const sessionPayload = await sessionResponse.text();
      if (!sessionResponse.ok) throw new Error("Unable to create the interpretation session.");
      const clientSecret = parseSessionCredential(sessionPayload);

      peerConnection = new RTCPeerConnection();
      peerConnection.ontrack = (trackEvent) => {
        translatedAudio.srcObject = trackEvent.streams[0] ?? new MediaStream([trackEvent.track]);
        translatedAudio.play().catch(() => fail("Tap Start again to enable audio playback."));
      };
      peerConnection.onconnectionstatechange = () => {
        if (!peerConnection || userStopped) return;
        if (peerConnection.connectionState === "connected") {
          setStatus(`Listening for English or ${selectedLanguage()}…`, "listening");
        } else if (["failed", "disconnected"].includes(peerConnection.connectionState)) {
          fail("Realtime connection was lost. Tap Start to reconnect.");
        }
      };
      peerConnection.addTrack(microphoneTrack, microphoneStream);
      dataChannel = peerConnection.createDataChannel("oai-events");
      dataChannel.onopen = () => {
        setStatus(`Listening for English or ${selectedLanguage()}…`, "listening");
      };
      dataChannel.onclose = () => {
        if (!userStopped) fail("OpenAI connection closed. Tap Start to reconnect.");
      };
      dataChannel.onerror = () => fail("OpenAI connection failed.");
      dataChannel.onmessage = ({ data }) => {
        try {
          handleRealtimeEvent(JSON.parse(data));
        } catch {
          fail("An invalid response was received from OpenAI.");
        }
      };

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      const answerResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        headers: { Authorization: `Bearer ${clientSecret}`, "Content-Type": "application/sdp" },
        body: peerConnection.localDescription.sdp
      });
      const answerSdp = await answerResponse.text();
      if (!answerResponse.ok) throw new Error("OpenAI Realtime connection failed.");
      await peerConnection.setRemoteDescription({ type: "answer", sdp: answerSdp });
    } catch (error) {
      const denied = error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError";
      fail(denied ? "Microphone permission was denied." : error?.message || "Interpreter could not start.");
    } finally {
      starting = false;
    }
  }

  startButton.addEventListener("click", () => void startInterpreter());
  stopButton.addEventListener("click", () => stopInterpreter());
  targetLanguageSelect.addEventListener("change", updateLanguageLabel);
  window.addEventListener("beforeunload", () => stopInterpreter());
  updateLanguageLabel();
})();
