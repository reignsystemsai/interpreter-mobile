# Interpreter.ai mobile

A focused Expo SDK 54 visual prototype for Android and iOS. The app uses Expo
Router, TypeScript, React Native Reanimated, SVG, and `expo-linear-gradient`.

The illuminated “I” toggles an entirely local demo animation. This version does
not request microphone access, connect to the backend, or contain an OpenAI API
key.

## Run from the repository root on Windows

Install the current Node.js LTS release from [nodejs.org](https://nodejs.org/)
first. Then open PowerShell in the repository root and run:

```powershell
npm install --global pnpm
cd mobile
pnpm install --frozen-lockfile
pnpm typecheck
pnpm start
```

The dependency and Expo commands run inside the `mobile` folder. The first
`cd mobile` command moves PowerShell into that folder.

## Open on Android or iOS with Expo Go

1. Install or update **Expo Go** from Google Play or the iOS App Store.
2. Put the phone and development computer on the same Wi-Fi network.
3. Run the commands above and leave the Expo terminal open.
4. On Android, open Expo Go, choose **Scan QR code**, and scan the QR code in
   PowerShell.
5. On iOS, scan the QR code with the Camera app, then approve opening it in
   Expo Go.

Tap the illuminated “I” to switch between idle and simulated listening modes.

If LAN discovery is blocked or the devices are on different networks, stop
Expo with `Ctrl+C` and start tunnel mode from `mobile`:

```powershell
pnpm exec expo start --tunnel
```

Scan the newly displayed QR code. Tunnel mode is slower than LAN but works
around many public Wi-Fi, guest-network, firewall, and device-isolation issues.

## Validation

From `mobile`:

```powershell
pnpm typecheck
pnpm exec expo config --type public
```
