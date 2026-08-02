(() => {
  "use strict";

  const REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";
  const MICROPHONE_RESUME_DELAY_MS = 180;
  const ECHO_MATCH_WINDOW_MS = 2500;
  const MAX_TURN_ENTRIES = 16;

  const statusDot = document.querySelector("#status-dot");
  const statusText = document.querySelector("#status-text");
  const startButton = document.querySelector("#start-button");
  const stopButton = document.querySelector("#stop-button");
  const targetLanguageSelect = document.querySelector("#target-language");
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
  let sourceLanguage = "Original speech";
  let activeTarget = "Spanish";
  let conversationTurns = [];
  let lastSpokenTranslation = "";
  let echoGuardUntil = 0;
  let currentResponseId = null;
  let suppressingEcho = false;
  let transcriptRenderFrame = null;
  const ignorableEventIds = new Set();

  function targetDisplayName() {
    return activeTarget === "Brazilian Portuguese"
      ? "Português (Brasil)"
      : "Spanish";
  }

  function listeningStatus() {
    return `Listening for English or ${targetDisplayName()}…`;
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

  function makeTurn(language, text, type) {
    const wrapper = document.createElement("div");
    wrapper.className = `conversation-turn ${type}`;
    const label = document.createElement("span");
    label.className = "turn-language";
    label.textContent = language;
    const content = document.createElement("p");
    content.className = "turn-text";
    content.textContent = text;
    wrapper.append(label, content);
    return wrapper;
  }

  function renderConversation() {
    conversationLog.replaceChildren();
    for (const turn of conversationTurns) {
      conversationLog.append(makeTurn(turn.language, turn.text, turn.type));
    }

    if (originalBuffer) {
      conversationLog.append(
        makeTurn(sourceLanguage, originalBuffer, "original live")
      );
    }
    if (translationBuffer) {
      const translatedLanguage =
        sourceLanguage === "English" ? targetDisplayName() : "English";
      conversationLog.append(
        makeTurn(translatedLanguage, translationBuffer, "translation live")
      );
    }

    if (!conversationLog.children.length) {
      const placeholder = document.createElement("p");
      placeholder.className = "conversation-placeholder";
      placeholder.textContent =
        "Recent original speech and translations will appear here.";
      conversationLog.append(placeholder);
    }
  }

  function scheduleConversationRender() {
    if (transcriptRenderFrame !== null) return;
    transcriptRenderFrame = window.requestAnimationFrame(() => {
      transcriptRenderFrame = null;
      renderConversation();
    });
  }

  function resetPendingTurn() {
    originalBuffer = "";
    translationBuffer = "";
    sourceLanguage = "Original speech";
    suppressingEcho = false;
    renderConversation();
  }

  function clearConversation() {
    conversationTurns = [];
    resetPendingTurn();
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

  function resumeMicrophoneAfterPlayback(delay = MICROPHONE_RESUME_DELAY_MS) {
    clearMicrophoneResumeTimer();
    microphoneResumeTimer = window.setTimeout(() => {
      microphoneResumeTimer = null;
      if (!localStream || !peerConnection || intentionallyStopping) return;
      setMicrophoneEnabled(true);
      setStatus(listeningStatus(), "listening");
    }, delay);
  }

  function normalizeForEcho(text) {
    return (text || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function isLikelySpeakerEcho(text) {
    if (!lastSpokenTranslation || Date.now() > echoGuardUntil) return false;
    const heard = normalizeForEcho(text);
    const spoken = normalizeForEcho(lastSpokenTranslation);
    if (heard.length < 12 || spoken.length < 12) return false;
    if (heard === spoken) return true;
    const shorter = heard.length < spoken.length ? heard : spoken;
    const longer = heard.length < spoken.length ? spoken : heard;
    return shorter.length >= 20 && longer.includes(shorter);
  }

  function sendIgnorable(type, body = {}) {
    if (!dataChannel || dataChannel.readyState !== "open") return;
    const eventId = `echo_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    ignorableEventIds.add(eventId);
    dataChannel.send(JSON.stringify({ type, event_id: eventId, ...body }));
  }

  function suppressSpeakerEcho(itemId) {
    suppressingEcho = true;
    if (currentResponseId) {
      sendIgnorable("response.cancel", { response_id: currentResponseId });
    }
    sendIgnorable("output_audio_buffer.clear");
    if (itemId) sendIgnorable("conversation.item.delete", { item_id: itemId });
    currentResponseId = null;
    originalBuffer = "";
    translationBuffer = "";
    renderConversation();
    setStatus("Speaker echo ignored", "working");
    resumeMicrophoneAfterPlayback(80);
  }

  function inferSourceLanguage(text) {
    const normalized = ` ${normalizeForEcho(text)} `;
    const targetWords =
      activeTarget === "Brazilian Portuguese"
        ? [" o ", " a ", " os ", " as ", " de ", " para ", " voce ", " nao ", " sim ", " uma ", " temos ", " posso ", " obrigado "]
        : [" el ", " la ", " los ", " las ", " de ", " para ", " usted ", " no ", " si ", " una ", " tenemos ", " puedo ", " gracias "];
    const englishWords = [" the ", " is ", " are ", " to ", " for ", " you ", " we ", " yes ", " no ", " have ", " can ", " please "];
    const targetScore = targetWords.filter((word) => normalized.includes(word)).length;
    const englishScore = englishWords.filter((word) => normalized.includes(word)).length;
    return targetScore > englishScore ? targetDisplayName() : "English";
  }

  function finishConversationTurn() {
    const original = originalBuffer.trim();
    const translation = translationBuffer.trim();
    if (!original || !translation || suppressingEcho) return;
    const translatedLanguage =
      sourceLanguage === "English" ? targetDisplayName() : "English";
    conversationTurns.push(
      { language: sourceLanguage, text: original, type: "original" },
      { language: translatedLanguage, text: translation, type: "translation" }
    );
    conversationTurns = conversationTurns.slice(-MAX_TURN_ENTRIES);
    lastSpokenTranslation = translation;
    originalBuffer = "";
    translationBuffer = "";
    renderConversation();
  }

  function releaseConnection({ resetStatus = true } = {}) {
    intentionallyStopping = true;
    connectionGeneration += 1;
    clearMicrophoneResumeTimer();
    if (transcriptRenderFrame !== null) {
      window.cancelAnimationFrame(transcriptRenderFrame);
      transcriptRenderFrame = null;
    }
    outputAudioActive = false;
    currentResponseId = null;
    lastSpokenTranslation = "";
    echoGuardUntil = 0;
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
    clearConversation();
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
      return JSON.parse(payload).error || `Session creation failed (${status}).`;
    } catch {
      return payload || `Session creation failed (${status}).`;
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
        resetPendingTurn();
        setStatus(listeningStatus(), "listening");
        break;
      case "input_audio_buffer.speech_stopped":
        setStatus("Translating…", "working");
        break;
      case "conversation.item.input_audio_transcription.delta":
        originalBuffer = `${originalBuffer}${event.delta || ""}`.slice(-2000);
        scheduleConversationRender();
        break;
      case "conversation.item.input_audio_transcription.completed":
        originalBuffer = (event.transcript || originalBuffer).slice(-2000);
        if (isLikelySpeakerEcho(originalBuffer)) {
          suppressSpeakerEcho(event.item_id);
          break;
        }
        sourceLanguage = inferSourceLanguage(originalBuffer);
        renderConversation();
        if (translationBuffer && !outputAudioActive) {
          finishConversationTurn();
        }
        break;
      case "response.created":
        currentResponseId = event.response?.id || null;
        outputAudioActive = false;
        muteMicrophoneForTranslation();
        setStatus("Translating…", "working");
        break;
      case "response.output_audio_transcript.delta":
        if (!suppressingEcho) {
          translationBuffer = `${translationBuffer}${event.delta || ""}`.slice(-2000);
          scheduleConversationRender();
        }
        break;
      case "response.output_audio_transcript.done":
        if (!suppressingEcho) {
          translationBuffer = (event.transcript || translationBuffer).slice(-2000);
          lastSpokenTranslation = translationBuffer.trim();
          renderConversation();
        }
        break;
      case "output_audio_buffer.started":
      case "response.output_audio.delta":
        outputAudioActive = true;
        muteMicrophoneForTranslation();
        setStatus("Speaking translation…", "speaking");
        break;
      case "output_audio_buffer.stopped":
      case "output_audio_buffer.cleared":
        outputAudioActive = false;
        echoGuardUntil = Date.now() + ECHO_MATCH_WINDOW_MS;
        finishConversationTurn();
        setStatus("Listening again…", "working");
        resumeMicrophoneAfterPlayback();
        break;
      case "response.done":
        currentResponseId = null;
        if (event.response?.status === "failed" || event.response?.status === "incomplete") {
          fail(event.response?.status_details?.error?.message || "OpenAI could not complete the translation.");
        } else if (!outputAudioActive) {
          finishConversationTurn();
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

  async function startInterpreter() {
    if (starting || peerConnection) return;
    if (!window.RTCPeerConnection || !navigator.mediaDevices?.getUserMedia) {
      fail("This browser does not support microphone WebRTC.");
      return;
    }

    starting = true;
    intentionallyStopping = false;
    activeTarget = targetLanguageSelect.value;
    const currentGeneration = ++connectionGeneration;
    clearConversation();
    setControls(true);
    setStatus("Requesting microphone…", "working");

    try {
      try {
        const microphoneStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            autoGainControl: true,
            echoCancellation: true,
            noiseSuppression: true,
            channelCount: 1
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
        if (error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError") {
          throw new Error("Microphone permission was denied. Allow microphone access and try again.");
        }
        throw new Error("The microphone could not be opened.");
      }

      setStatus("Creating secure session…", "working");
      const sessionResponse = await fetch("/api/realtime/session", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          languageOne: "English",
          languageTwo: activeTarget,
          mode: "browser-two-way"
        })
      });
      const sessionPayload = await sessionResponse.text();
      if (currentGeneration !== connectionGeneration) return;
      if (!sessionResponse.ok) {
        throw new Error(readableSessionError(sessionPayload, sessionResponse.status));
      }
      const clientSecret = JSON.parse(sessionPayload).value;
      if (!clientSecret) throw new Error("The server did not return a Realtime credential.");

      peerConnection = new RTCPeerConnection();
      peerConnection.ontrack = async (event) => {
        if (!event.track || event.track.kind !== "audio") {
          fail("OpenAI connected without a playable audio stream.");
          return;
        }
        translatedAudio.srcObject = event.streams?.[0] || new MediaStream([event.track]);
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
        } else if (["disconnected", "closed"].includes(peerConnection.connectionState)) {
          fail("The OpenAI audio connection was disconnected.");
        }
      };

      const microphoneTrack = localStream.getAudioTracks()[0];
      if (!microphoneTrack) throw new Error("No microphone audio track is available.");
      microphoneTrack.contentHint = "speech";
      peerConnection.addTrack(microphoneTrack, localStream);

      dataChannel = peerConnection.createDataChannel("oai-events");
      dataChannel.onopen = () => setStatus(listeningStatus(), "listening");
      dataChannel.onmessage = handleRealtimeEvent;
      dataChannel.onerror = () => fail("The OpenAI event connection failed.");
      dataChannel.onclose = () => {
        if (!intentionallyStopping) fail("The OpenAI event connection closed unexpectedly.");
      };

      setStatus("Connecting to OpenAI…", "working");
      const offer = await peerConnection.createOffer();
      if (currentGeneration !== connectionGeneration) return;
      await peerConnection.setLocalDescription(offer);
      if (currentGeneration !== connectionGeneration) return;
      const offerSdp = peerConnection.localDescription?.sdp;
      if (!offerSdp) throw new Error("The browser could not create an audio connection.");

      const sdpResponse = await fetch(REALTIME_CALLS_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${clientSecret}`, "Content-Type": "application/sdp" },
        body: offerSdp
      });
      const answerSdp = await sdpResponse.text();
      if (currentGeneration !== connectionGeneration) return;
      if (!sdpResponse.ok) throw new Error(answerSdp || `OpenAI connection failed (${sdpResponse.status}).`);
      await peerConnection.setRemoteDescription({ sdp: answerSdp, type: "answer" });
      starting = false;
    } catch (error) {
      fail(error instanceof Error ? error.message : "Interpreter could not start.");
    }
  }

  startButton.addEventListener("click", () => void startInterpreter());
  stopButton.addEventListener("click", () => releaseConnection());
  window.addEventListener("pagehide", () => releaseConnection());
})();
