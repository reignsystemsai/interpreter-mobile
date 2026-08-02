(() => {
  "use strict";

  const REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";
  const ENGLISH_PLACEHOLDER = "Your English speech will appear here.";
  const PORTUGUESE_PLACEHOLDER =
    "A tradução em português aparecerá aqui.";

  const statusDot = document.querySelector("#status-dot");
  const statusText = document.querySelector("#status-text");
  const startButton = document.querySelector("#start-button");
  const stopButton = document.querySelector("#stop-button");
  const englishTranscript = document.querySelector("#english-transcript");
  const portugueseTranscript = document.querySelector(
    "#portuguese-transcript"
  );
  const translatedAudio = document.querySelector("#translated-audio");

  let peerConnection = null;
  let dataChannel = null;
  let localStream = null;
  let starting = false;
  let intentionallyStopping = false;
  let connectionGeneration = 0;
  let englishBuffer = "";
  let portugueseBuffer = "";

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
    englishBuffer = "";
    portugueseBuffer = "";
    setTranscript(englishTranscript, "", ENGLISH_PLACEHOLDER);
    setTranscript(portugueseTranscript, "", PORTUGUESE_PLACEHOLDER);
  }

  function releaseConnection({ resetStatus = true } = {}) {
    intentionallyStopping = true;
    connectionGeneration += 1;

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

  function appendEnglish(delta) {
    englishBuffer = `${englishBuffer}${delta || ""}`.slice(-2000);
    setTranscript(englishTranscript, englishBuffer, ENGLISH_PLACEHOLDER);
  }

  function appendPortuguese(delta) {
    portugueseBuffer = `${portugueseBuffer}${delta || ""}`.slice(-2000);
    setTranscript(
      portugueseTranscript,
      portugueseBuffer,
      PORTUGUESE_PLACEHOLDER
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
        englishBuffer = "";
        portugueseBuffer = "";
        setTranscript(englishTranscript, "", "Listening…");
        setTranscript(portugueseTranscript, "", "Waiting for translation…");
        setStatus("Listening to English…", "listening");
        break;
      case "input_audio_buffer.speech_stopped":
        setStatus("Translating…", "working");
        break;
      case "conversation.item.input_audio_transcription.delta":
        appendEnglish(event.delta);
        break;
      case "conversation.item.input_audio_transcription.completed":
        englishBuffer = event.transcript || englishBuffer;
        setTranscript(englishTranscript, englishBuffer, ENGLISH_PLACEHOLDER);
        break;
      case "response.output_audio_transcript.delta":
        appendPortuguese(event.delta);
        break;
      case "response.output_audio_transcript.done":
        portugueseBuffer = event.transcript || portugueseBuffer;
        setTranscript(
          portugueseTranscript,
          portugueseBuffer,
          PORTUGUESE_PLACEHOLDER
        );
        break;
      case "output_audio_buffer.started":
      case "response.output_audio.delta":
        setStatus("Speaking Portuguese…", "speaking");
        break;
      case "output_audio_buffer.stopped":
      case "output_audio_buffer.cleared":
        setStatus("Listening to English…", "listening");
        break;
      case "response.done":
        if (
          event.response?.status === "failed" ||
          event.response?.status === "incomplete"
        ) {
          const detail = event.response?.status_details?.error?.message;
          fail(detail || "OpenAI could not complete the translation.");
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
          languageTwo: "Brazilian Portuguese",
          mode: "browser-one-way"
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
          setStatus("Listening to English…", "listening");
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
        setStatus("Listening to English…", "listening");
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
