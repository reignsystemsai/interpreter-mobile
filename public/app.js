(() => {
  "use strict";

  const REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";
  const MICROPHONE_RESUME_DELAY_MS = 600;
  const MAX_COMPANION_ENTRIES = 16;

  const statusDot = document.querySelector("#status-dot");
  const statusText = document.querySelector("#status-text");
  const startButton = document.querySelector("#start-button");
  const stopButton = document.querySelector("#stop-button");
  const interpreterModeButton = document.querySelector("#interpreter-mode");
  const companionModeButton = document.querySelector("#companion-mode");
  const modeTitle = document.querySelector("#mode-title");
  const modeEyebrow = document.querySelector("#mode-eyebrow");
  const interpreterLanguageCard = document.querySelector(
    "#interpreter-language-card"
  );
  const companionLanguageCard = document.querySelector(
    "#companion-language-card"
  );
  const targetLanguageSelect = document.querySelector("#target-language");
  const companionLanguageSelect = document.querySelector(
    "#companion-language"
  );
  const interpreterTranscripts = document.querySelector(
    "#interpreter-transcripts"
  );
  const companionTranscriptCard = document.querySelector(
    "#companion-transcript-card"
  );
  const originalTranscript = document.querySelector("#original-transcript");
  const translationTranscript = document.querySelector(
    "#translation-transcript"
  );
  const conversationLog = document.querySelector("#conversation-log");
  const translatedAudio = document.querySelector("#translated-audio");

  let peerConnection = null;
  let dataChannel = null;
  let localStream = null;
  let starting = false;
  let intentionallyStopping = false;
  let connectionGeneration = 0;
  let microphoneResumeTimer = null;
  let outputAudioActive = false;
  let originalBuffer = "";
  let translationBuffer = "";
  let activeMode = "interpreter";
  let activeTarget = "Spanish";
  let activeCompanionLanguage = "English";
  let companionEntries = [];
  let currentResponseId = null;
  let currentAssistantItemId = null;
  let playbackStartedAt = null;
  const cancelledResponseIds = new Set();
  const ignorableEventIds = new Set();

  function targetDisplayName() {
    return activeTarget === "Brazilian Portuguese"
      ? "Português (Brasil)"
      : "Spanish";
  }

  function selectedCompanionDisplayName() {
    if (activeCompanionLanguage === "Brazilian Portuguese") {
      return "Português (Brasil)";
    }
    if (activeCompanionLanguage === "Spanish") return "Español";
    return "English";
  }

  function listeningStatus() {
    return activeMode === "companion"
      ? "Listening…"
      : `Listening for English or ${targetDisplayName()}…`;
  }

  function originalPlaceholder() {
    return `The latest English or ${targetDisplayName()} speech will appear here.`;
  }

  function setStatus(message, state = "idle") {
    statusText.textContent = message;
    statusDot.dataset.state = state;
  }

  function setControls(active) {
    startButton.disabled = active;
    stopButton.disabled = !active;
    targetLanguageSelect.disabled = active;
    companionLanguageSelect.disabled = active;
  }

  function setTranscript(element, value, placeholder) {
    element.textContent = value.trim() || placeholder;
  }

  function makeCompanionEntry(speaker, text) {
    const wrapper = document.createElement("div");
    wrapper.className = `conversation-turn ${
      speaker === "Companion" ? "companion" : "user"
    }`;
    const label = document.createElement("span");
    label.className = "turn-language";
    label.textContent = speaker;
    const content = document.createElement("p");
    content.className = "turn-text";
    content.textContent = text;
    wrapper.append(label, content);
    return wrapper;
  }

  function renderCompanionTranscript() {
    conversationLog.replaceChildren();
    for (const entry of companionEntries) {
      conversationLog.append(makeCompanionEntry(entry.speaker, entry.text));
    }
    if (originalBuffer) {
      conversationLog.append(makeCompanionEntry("You", originalBuffer));
    }
    if (translationBuffer) {
      conversationLog.append(
        makeCompanionEntry("Companion", translationBuffer)
      );
    }
    if (!conversationLog.children.length) {
      const placeholder = document.createElement("p");
      placeholder.className = "conversation-placeholder";
      placeholder.textContent =
        "Your conversation with Companion will appear here.";
      conversationLog.append(placeholder);
    }
  }

  function appendCompanionEntry(speaker, text) {
    const value = (text || "").trim();
    if (!value) return;
    companionEntries.push({ speaker, text: value });
    companionEntries = companionEntries.slice(-MAX_COMPANION_ENTRIES);
  }

  function clearTranscripts() {
    originalBuffer = "";
    translationBuffer = "";
    companionEntries = [];
    setTranscript(originalTranscript, "", originalPlaceholder());
    setTranscript(translationTranscript, "", "The translation will appear here.");
    renderCompanionTranscript();
  }

  function clearMicrophoneResumeTimer() {
    if (microphoneResumeTimer) {
      window.clearTimeout(microphoneResumeTimer);
      microphoneResumeTimer = null;
    }
  }

  function setMicrophoneEnabled(enabled) {
    localStream?.getAudioTracks().forEach((track) => {
      track.enabled = enabled;
    });
  }

  function muteMicrophoneForTranslation() {
    clearMicrophoneResumeTimer();
    setMicrophoneEnabled(false);
  }

  function resumeMicrophoneAfterPlayback() {
    clearMicrophoneResumeTimer();
    microphoneResumeTimer = window.setTimeout(() => {
      microphoneResumeTimer = null;
      if (!localStream || !peerConnection || intentionallyStopping) return;
      setMicrophoneEnabled(true);
      setStatus(listeningStatus(), "listening");
    }, MICROPHONE_RESUME_DELAY_MS);
  }

  function sendIgnorable(type, body = {}) {
    if (!dataChannel || dataChannel.readyState !== "open") return;
    const eventId = `client_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    ignorableEventIds.add(eventId);
    dataChannel.send(JSON.stringify({ type, event_id: eventId, ...body }));
  }

  function interruptCompanionResponse() {
    if (
      activeMode !== "companion" ||
      (!outputAudioActive && !currentResponseId)
    ) {
      return;
    }

    const interruptedResponseId = currentResponseId;
    if (interruptedResponseId) {
      cancelledResponseIds.add(interruptedResponseId);
      sendIgnorable("response.cancel", { response_id: interruptedResponseId });
    }
    sendIgnorable("output_audio_buffer.clear");
    if (currentAssistantItemId && playbackStartedAt !== null) {
      sendIgnorable("conversation.item.truncate", {
        item_id: currentAssistantItemId,
        content_index: 0,
        audio_end_ms: Math.max(0, Date.now() - playbackStartedAt)
      });
    }

    outputAudioActive = false;
    currentResponseId = null;
    currentAssistantItemId = null;
    playbackStartedAt = null;
    translationBuffer = "";
    renderCompanionTranscript();
  }

  function finishCompanionResponse(responseId) {
    if (cancelledResponseIds.has(responseId)) return;
    appendCompanionEntry("Companion", translationBuffer);
    translationBuffer = "";
    renderCompanionTranscript();
  }

  function releaseConnection({ resetStatus = true } = {}) {
    intentionallyStopping = true;
    connectionGeneration += 1;
    clearMicrophoneResumeTimer();
    outputAudioActive = false;
    currentResponseId = null;
    currentAssistantItemId = null;
    playbackStartedAt = null;
    cancelledResponseIds.clear();
    ignorableEventIds.clear();

    if (dataChannel) {
      dataChannel.onopen = null;
      dataChannel.onmessage = null;
      dataChannel.onerror = null;
      dataChannel.onclose = null;
      dataChannel.close();
      dataChannel = null;
    }
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
      localStream = null;
    }
    if (peerConnection) {
      peerConnection.ontrack = null;
      peerConnection.onconnectionstatechange = null;
      peerConnection.close();
      peerConnection = null;
    }

    translatedAudio.pause();
    translatedAudio.srcObject = null;
    translatedAudio.removeAttribute("src");
    translatedAudio.load();
    starting = false;
    setControls(false);
    clearTranscripts();
    if (resetStatus) setStatus("Ready", "idle");
    window.setTimeout(() => {
      intentionallyStopping = false;
    }, 0);
  }

  function fail(message) {
    releaseConnection({ resetStatus: false });
    setStatus(message, "error");
  }

  function readableSessionError(payload, status) {
    try {
      const parsed = JSON.parse(payload);
      return parsed.error || `Session creation failed (${status}).`;
    } catch {
      return payload || `Session creation failed (${status}).`;
    }
  }

  function appendOriginal(delta) {
    originalBuffer = `${originalBuffer}${delta || ""}`.slice(-2000);
    if (activeMode === "companion") {
      renderCompanionTranscript();
    } else {
      setTranscript(originalTranscript, originalBuffer, originalPlaceholder());
    }
  }

  function appendResponseTranscript(delta) {
    translationBuffer = `${translationBuffer}${delta || ""}`.slice(-2000);
    if (activeMode === "companion") {
      renderCompanionTranscript();
    } else {
      setTranscript(
        translationTranscript,
        translationBuffer,
        "The translation will appear here."
      );
    }
  }

  function handleRealtimeEvent(rawEvent) {
    let event;
    try {
      event = JSON.parse(rawEvent.data);
    } catch {
      fail("OpenAI returned an unreadable event.");
      return;
    }

    switch (event.type) {
      case "input_audio_buffer.speech_started":
        if (activeMode === "companion") {
          interruptCompanionResponse();
          originalBuffer = "";
          renderCompanionTranscript();
        } else {
          originalBuffer = "";
          translationBuffer = "";
          setTranscript(originalTranscript, "", "Listening…");
          setTranscript(
            translationTranscript,
            "",
            "Waiting for translation…"
          );
        }
        setStatus(listeningStatus(), "listening");
        break;
      case "input_audio_buffer.speech_stopped":
        setStatus(
          activeMode === "companion" ? "Thinking…" : "Translating…",
          "working"
        );
        break;
      case "conversation.item.input_audio_transcription.delta":
        appendOriginal(event.delta);
        break;
      case "conversation.item.input_audio_transcription.completed":
        originalBuffer = event.transcript || originalBuffer;
        if (activeMode === "companion") {
          appendCompanionEntry("You", originalBuffer);
          originalBuffer = "";
          renderCompanionTranscript();
        } else {
          setTranscript(originalTranscript, originalBuffer, originalPlaceholder());
        }
        break;
      case "response.created":
        currentResponseId = event.response?.id || null;
        currentAssistantItemId = null;
        playbackStartedAt = null;
        outputAudioActive = false;
        if (activeMode === "interpreter") muteMicrophoneForTranslation();
        setStatus(
          activeMode === "companion" ? "Thinking…" : "Translating…",
          "working"
        );
        break;
      case "response.output_item.added":
        if (activeMode === "companion" && event.item?.role === "assistant") {
          currentAssistantItemId = event.item.id || null;
        }
        break;
      case "response.output_audio_transcript.delta":
        if (!cancelledResponseIds.has(event.response_id)) {
          appendResponseTranscript(event.delta);
        }
        break;
      case "response.output_audio_transcript.done":
        if (!cancelledResponseIds.has(event.response_id)) {
          translationBuffer = event.transcript || translationBuffer;
          if (activeMode === "companion") {
            renderCompanionTranscript();
          } else {
            setTranscript(
              translationTranscript,
              translationBuffer,
              "The translation will appear here."
            );
          }
        }
        break;
      case "output_audio_buffer.started":
      case "response.output_audio.delta":
        if (cancelledResponseIds.has(event.response_id)) break;
        outputAudioActive = true;
        if (
          event.type === "output_audio_buffer.started" &&
          playbackStartedAt === null
        ) {
          playbackStartedAt = Date.now();
        }
        if (activeMode === "interpreter") muteMicrophoneForTranslation();
        setStatus(
          activeMode === "companion" ? "Speaking…" : "Speaking translation…",
          "speaking"
        );
        break;
      case "output_audio_buffer.stopped":
      case "output_audio_buffer.cleared":
        outputAudioActive = false;
        playbackStartedAt = null;
        currentAssistantItemId = null;
        if (activeMode === "companion") {
          finishCompanionResponse(event.response_id);
          setMicrophoneEnabled(true);
          setStatus(listeningStatus(), "listening");
        } else {
          setStatus("Preventing speaker echo…", "working");
          resumeMicrophoneAfterPlayback();
        }
        break;
      case "response.done":
        if (event.response?.id === currentResponseId) currentResponseId = null;
        if (
          event.response?.status === "failed" ||
          event.response?.status === "incomplete"
        ) {
          const detail = event.response?.status_details?.error?.message;
          fail(
            detail ||
              (activeMode === "companion"
                ? "OpenAI could not complete the response."
                : "OpenAI could not complete the translation.")
          );
        } else if (activeMode === "companion") {
          if (!outputAudioActive) {
            finishCompanionResponse(event.response?.id);
            setStatus(listeningStatus(), "listening");
          }
        } else if (!outputAudioActive) {
          resumeMicrophoneAfterPlayback();
        }
        break;
      case "error":
        if (event.error?.event_id && ignorableEventIds.has(event.error.event_id)) {
          ignorableEventIds.delete(event.error.event_id);
          break;
        }
        fail(event.error?.message || "OpenAI returned a connection error.");
        break;
      default:
        break;
    }
  }

  function applyModeUi() {
    const companion = activeMode === "companion";
    interpreterModeButton.setAttribute("aria-pressed", String(!companion));
    companionModeButton.setAttribute("aria-pressed", String(companion));
    interpreterLanguageCard.hidden = companion;
    companionLanguageCard.hidden = !companion;
    interpreterTranscripts.hidden = companion;
    companionTranscriptCard.hidden = !companion;
    modeTitle.textContent = companion ? "Companion" : "Interpreter";
    modeEyebrow.textContent = companion
      ? selectedCompanionDisplayName()
      : `ENGLISH ↔ ${targetDisplayName().toUpperCase()}`;
    startButton.textContent = companion
      ? "START CONVERSATION"
      : "Start Interpreter";
    clearTranscripts();
    setStatus("Ready", "idle");
  }

  function switchMode(mode) {
    if (mode === activeMode) return;
    if (peerConnection || starting) releaseConnection();
    activeMode = mode;
    activeTarget = targetLanguageSelect.value;
    activeCompanionLanguage = companionLanguageSelect.value;
    applyModeUi();
  }

  async function startSession() {
    if (starting || peerConnection) return;
    if (!window.RTCPeerConnection || !navigator.mediaDevices?.getUserMedia) {
      fail("This browser does not support microphone WebRTC.");
      return;
    }

    starting = true;
    intentionallyStopping = false;
    activeTarget = targetLanguageSelect.value;
    activeCompanionLanguage = companionLanguageSelect.value;
    const currentGeneration = ++connectionGeneration;
    clearTranscripts();
    setControls(true);
    setStatus("Requesting microphone…", "working");

    try {
      try {
        const microphoneStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            autoGainControl: true,
            echoCancellation: true,
            noiseSuppression: true
          },
          video: false
        });
        if (currentGeneration !== connectionGeneration) {
          microphoneStream.getTracks().forEach((track) => track.stop());
          return;
        }
        localStream = microphoneStream;
        setMicrophoneEnabled(true);
      } catch (error) {
        if (
          error?.name === "NotAllowedError" ||
          error?.name === "PermissionDeniedError"
        ) {
          throw new Error(
            "Microphone permission was denied. Allow microphone access and try again."
          );
        }
        throw new Error("The microphone could not be opened.");
      }

      setStatus("Creating secure session…", "working");
      const sessionResponse = await fetch("/api/realtime/session", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          languageOne:
            activeMode === "companion" ? activeCompanionLanguage : "English",
          languageTwo: activeTarget,
          mode: activeMode === "companion" ? "companion" : "browser-two-way"
        })
      });
      const sessionPayload = await sessionResponse.text();
      if (currentGeneration !== connectionGeneration) return;
      if (!sessionResponse.ok) {
        throw new Error(
          readableSessionError(sessionPayload, sessionResponse.status)
        );
      }
      const clientSecret = JSON.parse(sessionPayload).value;
      if (!clientSecret) {
        throw new Error("The server did not return a Realtime credential.");
      }

      peerConnection = new RTCPeerConnection();
      peerConnection.ontrack = async (event) => {
        if (!event.track || event.track.kind !== "audio") {
          fail("OpenAI connected without a playable audio stream.");
          return;
        }
        const remoteStream =
          event.streams?.[0] || new MediaStream([event.track]);
        translatedAudio.srcObject = remoteStream;
        try {
          await translatedAudio.play();
        } catch {
          fail("The browser blocked speaker audio. Press Start and try again.");
        }
      };

      peerConnection.onconnectionstatechange = () => {
        if (!peerConnection || intentionallyStopping) return;
        if (peerConnection.connectionState === "connected") {
          setStatus(listeningStatus(), "listening");
        } else if (peerConnection.connectionState === "failed") {
          fail("The WebRTC connection to OpenAI failed.");
        } else if (
          peerConnection.connectionState === "disconnected" ||
          peerConnection.connectionState === "closed"
        ) {
          fail("The OpenAI audio connection was disconnected.");
        }
      };

      const microphoneTrack = localStream.getAudioTracks()[0];
      if (!microphoneTrack) {
        throw new Error("No microphone audio track is available.");
      }
      peerConnection.addTrack(microphoneTrack, localStream);

      dataChannel = peerConnection.createDataChannel("oai-events");
      dataChannel.onopen = () => {
        setStatus(listeningStatus(), "listening");
      };
      dataChannel.onmessage = handleRealtimeEvent;
      dataChannel.onerror = () => {
        fail("The OpenAI event connection failed.");
      };
      dataChannel.onclose = () => {
        if (!intentionallyStopping) {
          fail("The OpenAI event connection closed unexpectedly.");
        }
      };

      setStatus("Connecting to OpenAI…", "working");
      const offer = await peerConnection.createOffer();
      if (currentGeneration !== connectionGeneration) return;
      await peerConnection.setLocalDescription(offer);
      if (currentGeneration !== connectionGeneration) return;
      const offerSdp = peerConnection.localDescription?.sdp;
      if (!offerSdp) {
        throw new Error("The browser could not create an audio connection.");
      }

      const sdpResponse = await fetch(REALTIME_CALLS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${clientSecret}`,
          "Content-Type": "application/sdp"
        },
        body: offerSdp
      });
      const answerSdp = await sdpResponse.text();
      if (currentGeneration !== connectionGeneration) return;
      if (!sdpResponse.ok) {
        throw new Error(
          answerSdp || `OpenAI connection failed (${sdpResponse.status}).`
        );
      }
      await peerConnection.setRemoteDescription({
        sdp: answerSdp,
        type: "answer"
      });
      starting = false;
    } catch (error) {
      fail(
        error instanceof Error
          ? error.message
          : activeMode === "companion"
            ? "Companion could not start."
            : "Interpreter could not start."
      );
    }
  }

  interpreterModeButton.addEventListener("click", () => {
    switchMode("interpreter");
  });
  companionModeButton.addEventListener("click", () => {
    switchMode("companion");
  });
  targetLanguageSelect.addEventListener("change", () => {
    activeTarget = targetLanguageSelect.value;
    if (!peerConnection && !starting && activeMode === "interpreter") {
      applyModeUi();
    }
  });
  companionLanguageSelect.addEventListener("change", () => {
    activeCompanionLanguage = companionLanguageSelect.value;
    if (!peerConnection && !starting && activeMode === "companion") {
      applyModeUi();
    }
  });
  startButton.addEventListener("click", () => {
    void startSession();
  });
  stopButton.addEventListener("click", () => {
    releaseConnection();
  });
  window.addEventListener("pagehide", () => {
    releaseConnection();
  });
})();
