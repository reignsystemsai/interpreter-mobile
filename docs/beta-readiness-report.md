# Interpreter Phase 5 Beta Readiness Report

Date: August 3, 2026

## Outcome

Phase 5 hardens the existing calling and interpreted-calling experience without
changing the home screen, translation UI, contacts, authentication, language
selection, branding, or navigation model. Transcript content remains ephemeral
and is displayed only during an active interpreted call.

This report covers local implementation and validation. It is not a production
certification: Phase 5 has not been deployed, no Expo build was submitted, and no
physical Android device was connected to this workspace.

## Reliability and polish

- One connection message is visible at a time: Connecting, Ringing, Connected,
  Reconnecting, Connection Lost, or Call Failed. Connected is temporary; the
  connection message is otherwise hidden when it is not needed.
- LiveKit receives bounded initial retries and then obtains a fresh short-lived
  token for session recovery.
- Interpreted-call health is checked during active calls. A failed bridge falls
  back to direct audio and automatically retries without ending the human call.
- OpenAI Realtime recovery is exponential and bounded. Exhaustion produces a
  nontechnical unavailable state.
- Foreground recovery restores the audio session and the user's selected speaker
  route. Camera publishing remains paused while backgrounded.
- Presence, incoming-call, and contact-presence polling pauses while the app is
  backgrounded to reduce CPU, network, and battery use.
- Connection and translation errors are mapped to short user-facing messages.
  Provider responses, tokens, identifiers, language choices, and exception text
  are not written to operational logs.

## Audio and performance settings

- Echo cancellation, noise suppression, automatic gain control, and supported
  voice isolation are requested for call microphone capture.
- Calls publish mono speech-optimized Opus audio with DTX and redundant audio
  data enabled.
- Bluetooth and wired headsets are preferred, followed by speaker and earpiece.
- Remote playback defaults to full, consistent track volume.
- Adaptive streaming and dynacast remain enabled for video calls.
- Live transcripts retain only the latest four turns in memory. Latency samples
  retain only the latest twenty measurements.
- Production LiveKit logging is limited to warnings and errors.

## Validation results

- Repository automated tests: 22 passed, 0 failed.
- Mobile TypeScript: passed.
- Expo public configuration: passed.
- Expo Doctor: 18/18 checks passed.
- Server JavaScript syntax checks: passed.
- Secret scan: no permanent OpenAI, LiveKit, or Supabase secret found in mobile or
  public client source.
- Existing `useRealtimeInterpreter` remains unchanged.

The automated suite covers the voice, video, business-video, contacts,
authentication, interpreted-call, allowance, push registration, presence,
recovery, privacy, RLS, and menu integration paths at unit/static-integration
level. Real provider behavior still requires two-device acceptance testing.

## Performance profile

| Measurement | Result | Scope |
| --- | ---: | --- |
| Realtime event control-path throughput | 3,247,456 events/second | Local Node benchmark, 105,000 events |
| Average event-handler time | 0.000308 ms | Local control path only |
| Heap growth during benchmark | 30,200 bytes | After forced garbage collection |
| App launch time | Instrumented; device measurement pending | Physical release build required |
| Call setup time | Instrumented; device measurement pending | Deployed backend and two devices required |
| Translation latency | Runtime average/P95 instrumentation present; live measurement pending | Real OpenAI and LiveKit session required |
| Android memory and CPU | Pending | Android profiler/ADB unavailable in workspace |
| Battery consumption | Pending | Multi-hour physical-device test required |

The local control-path benchmark does not represent end-to-end translation
latency. It excludes device capture, mobile networking, LiveKit transport,
OpenAI processing, and audio playout.

## Modified and added Phase 5 files

Added:

- `mobile/src/features/calling/callMessages.ts`
- `mobile/src/services/performance.ts`
- `docs/beta-readiness-report.md`

Modified:

- `mobile/app/index.tsx`
- `mobile/src/features/calling/CallProvider.tsx`
- `mobile/src/features/calling/CallScreens.tsx`
- `mobile/src/features/calling/types.ts`
- `mobile/src/features/menu/AppMenu.tsx`
- `mobile/src/features/menu/DestinationSheet.tsx`
- `mobile/src/hooks/useInterpretedCall.ts`
- `server.js`
- `src/server/interpreted-call-manager.js`
- `src/server/realtime-translation.js`
- `src/server/routes/calls.js`
- `src/server/routes/interpreted-calls.js`
- `src/server/routes/livekit-webhook.js`
- `test/mobile-app.test.js`

## Known issues and production recommendations

1. Deploy the Phase 4/5 backend and run two-device acceptance tests on Wi-Fi, 5G,
   constrained bandwidth, packet loss, and network handoff.
2. Record release-build launch, call setup, translation average/P95, memory, CPU,
   thermal, and battery measurements on representative low-, mid-, and high-tier
   Android devices.
3. Verify RevenueCat purchase, restore, renewal, expiration, rollover, and usage
   limits against sandbox accounts.
4. Verify incoming-call notifications from terminated, backgrounded, and
   foreground states on physical Android devices.
5. Load-test interpreted-call workers and add a distributed ownership lease before
   running more than one Render instance.
6. Treat the current Node media bridge as beta infrastructure until the LiveKit
   RTC Node SDK has passed sustained production soak testing or the bridge is
   moved to a dedicated LiveKit Agents worker.
7. Keep legal screens unpublished until final legal approval, as already required
   by the project launch policy.
