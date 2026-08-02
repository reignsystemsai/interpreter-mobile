(() => {
  "use strict";

  const REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";
  const LISTENING_STATUS = "Listening for English or Spanish…";
  const ORIGINAL_PLACEHOLDER =
    "The latest English or Spanish speech will appear here.";
  const TRANSLATION_PLACEHOLDER = "The translation will appear here.";
  const MICROPHONE_RESUME_DELAY_MS = 600;

  const statusDot = document.querySelector("#status-dot");
  const statusText = document.querySelector("#status-text");
  const startButton = document.querySelector("#start-button");
  const stopButton = document.querySelector("#stop-button");
  const originalTranscript = document.querySelector("#original-transcript");
  const translationTranscript = document.querySelector(
    "#translation-transcript"
  );
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

  function setStatus(message, state = "idle") {
    statusText.textContent = message;
    statusDot.dataset.state = state;
  }

  function setControls(active) {
    startButton.disabled = active;
    stopButton.disabled = !active;
  }

  function setTranscript(element, value, placeholder) {
    element.textContent = value.trim() || placeholder;
  }

  function clearTranscripts() {
    originalBuffer = "";
    translationBuffer = "";
    setTranscript(originalTranscript, "", ORIGINAL_PLACEHOLDER);
    setTranscript(translationTranscript, "", TRANSLATION_PLACEHOLDER);
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
      if (!localStream || !peerConnection || intentionallyStopping) {
        return;
      }

      setMicrophoneEnabled(true);
      setStatus(LISTENING_STATUS, "listening");
    }, MICROPHONE_RESUME_DELAY_MS);
  }

  function releaseConnection({ resetStatus = true } = {}) {
    intentionallyStopping = true;
    connectionGeneration += 1;
    clearMicrophoneResumeTimer();
    outputAudioActive = false;

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
    if (resetStatus) {
      setStatus("Ready", "idle");
    }

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
    setTranscript(originalTranscript, originalBuffer, ORIGINAL_PLACEHOLDER);
  }

  function appendTranslation(delta) {
    translationBuffer = `${translationBuffer}${delta || ""}`.slice(-2000);
    setTranscript(
      translationTranscript,
      translationBuffer,
      TRANSLATION_PLACEHOLDER
    );
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
        originalBuffer = "";
        translationBuffer = "";
        setTranscript(originalTranscript, "", "Listening…");
        setTranscript(translationTranscript, "", "Waiting for translation…");
        setStatus(LISTENING_STATUS, "listening");
        break;
      case "input_audio_buffer.speech_stopped":
        setStatus("Translating…", "working");
        break;
      case "conversation.item.input_audio_transcription.delta":
        appendOriginal(event.delta);
        break;
      case "conversation.item.input_audio_transcription.completed":
        originalBuffer = event.transcript || originalBuffer;
        setTranscript(originalTranscript, originalBuffer, ORIGINAL_PLACEHOLDER);
        break;
      case "response.created":
        outputAudioActive = false;
        muteMicrophoneForTranslation();
        setStatus("Translating…", "working");
        break;
      case "response.output_audio_transcript.delta":
        appendTranslation(event.delta);
        break;
      case "response.output_audio_transcript.done":
        translationBuffer = event.transcript || translationBuffer;
        setTranscript(
          translationTranscript,
          translationBuffer,
          TRANSLATION_PLACEHOLDER
        );
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
        setStatus("Preventing speaker echo…", "working");
        resumeMicrophoneAfterPlayback();
        break;
      case "response.done":
        if (
          event.response?.status === "failed" ||
          event.response?.status === "incomplete"
        ) {
          const detail = event.response?.status_details?.error?.message;
          fail(detail || "OpenAI could not complete the translation.");
        } else if (!outputAudioActive) {
          resumeMicrophoneAfterPlayback();
        }
        break;
      case "error":
        fail(event.error?.message || "OpenAI returned a connection error.");
        break;
      default:
        break;
    }
  }

  async function startInterpreter() {
    if (starting || peerConnection) {
      return;
    }

    if (
      !window.RTCPeerConnection ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      fail("This browser does not support microphone WebRTC.");
      return;
    }

    starting = true;
    intentionallyStopping = false;
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
          languageOne: "English",
          languageTwo: "Spanish",
          mode: "browser-two-way"
        })
      });
      const sessionPayload = await sessionResponse.text();

      if (currentGeneration !== connectionGeneration) {
        return;
      }

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
        if (!peerConnection || intentionallyStopping) {
          return;
        }

        if (peerConnection.connectionState === "connected") {
          setStatus(LISTENING_STATUS, "listening");
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
        setStatus(LISTENING_STATUS, "listening");
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
      if (currentGeneration !== connectionGeneration) {
        return;
      }
      await peerConnection.setLocalDescription(offer);
      if (currentGeneration !== connectionGeneration) {
        return;
      }
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
      if (currentGeneration !== connectionGeneration) {
        return;
      }
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
      fail(error instanceof Error ? error.message : "Interpreter could not start.");
    }
  }

  startButton.addEventListener("click", () => {
    void startInterpreter();
  });
  stopButton.addEventListener("click", () => {
    releaseConnection();
  });
  window.addEventListener("pagehide", () => {
    releaseConnection();
  });
})();
