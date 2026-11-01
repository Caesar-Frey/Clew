# Clew

An app that helps you remember where you put what: in a drawer, under the bed, or with a friend.

A clew is a ball of thread, like the one Ariadne gave Theseus to find his way back out of the labyrinth (it's also where the word "clue" comes from). The app was first called Whereabouts.

Clew is designed like an old library. Every thing gets a catalog card, places are shelves, lending something out gets a date-due stamp, and every move is kept on the card's circulation record.

## What it does

- **Quick add.** Name it, tap a recently used shelf (or type a path like `Garage > Blue box`), done. "Save and add another" keeps the shelf, for unpacking a whole box.
- **Instant fuzzy search.** Results as you type, tolerant of typos and missing letters (`pasport`, `chrstms`). Matches names, subjects (tags), places, borrowers and notes.
- **Nested places.** Any depth: House › Garage › Tool shelf. Missing parts of a path are created on save. Deleting a place moves its contents up a level, so nothing is lost.
- **Lent out.** Who has what, grouped by borrower, with optional due dates and overdue warnings. One tap when it comes back.
- **Moved it.** One tap on a recent shelf re-shelves an item; every move is recorded. Moves, returns and withdrawals can be undone from the notice that slides up.
- **Due-date reminders.** A local notification at 9am on the day something is due back, and again three days later if it's still out. While the app lock is on they don't name the thing or the person.
- **Photos.** Up to four per card, from the camera or library. Stored inside the encrypted database (re-encoded, so location metadata is stripped), with a small thumbnail for lists.
- **Voice.** Say "the passport is in the desk drawer" or "I lent the drill to Sam until Friday" and the card fills itself in; ask "where's my passport" from search. Recognition runs on the phone only (English for now). If the phone can't recognise speech offline, the mic says so instead of sending audio anywhere, and Android offers to download its offline speech model.
- **Which box is this?** Photograph a box, or the label you scribbled on it, and Clew finds it among your boxes. It reads handwriting with the phone's built-in text recognition and compares colours and layout. No QR codes or printing. Each box keeps up to six views.
- **Backups.** A full copy of the catalog (photos included) sealed with a passphrase (scrypt + AES-256-GCM), saved anywhere through the share sheet and restored on any phone. Backups are `.clew` files; `.wbk` backups from the Whereabouts days still restore.
- **Library assistant (optional).** Download an open-weight vision model (SmolVLM2 500M, about 680 MB, or Qwen2.5-VL 3B, about 2.8 GB) and it suggests a name and subjects from a photo, as slips you tap to keep. It also adds "Might be what you mean" to search, using on-device text embeddings (nomic-embed-text v1.5). Runs entirely on the phone through llama.cpp.

## Privacy and security

- Everything stays on the device. No account, no analytics. The only network use is downloading the optional assistant's model files, when the user asks; nothing from the catalog is ever sent.
- The database is encrypted with SQLCipher. A random 256-bit key is generated on first launch and kept only in the iOS Keychain / Android Keystore (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`, so it is never synced or backed up). Release builds refuse to start without SQLCipher.
- Optional app lock with Face ID, fingerprint or device passcode. It re-locks after 30 seconds in the background, and the app-switcher snapshot is covered. Half-written cards survive a relock.
- Optional "seal": the database key itself is stored behind biometrics (iOS `biometryCurrentSet`, an auth-bound Android Keystore key), so the catalog can't be decrypted without the owner. Because the OS discards such keys when fingerprints or faces change, sealing asks for a recovery passphrase that can reopen the vault.
- Backups are sealed with the user's passphrase before they leave the app. Settings that describe the phone (prefixed `device.`) never travel in a backup.
- Android backups are disabled.

## Stack

Expo SDK 58, React Native 0.88, TypeScript, Expo Router, expo-sqlite (SQLCipher), expo-secure-store, expo-local-authentication, expo-crypto (AES-GCM), expo-notifications, expo-image-picker / image-manipulator, expo-speech-recognition, expo-text-extractor (Apple Vision / ML Kit OCR), llama.rn (llama.cpp). Fonts: Fraunces, Courier Prime, Special Elite (bundled, no network). Icons are hand-drawn SVGs in `src/ui/icons.tsx`.

## Running it

The app uses native modules (SQLCipher, secure storage, biometrics, speech, OCR, llama.cpp), so it needs a development build, not Expo Go. The assistant asks for the iOS increased-memory entitlement in production builds.

```bash
npm install
npx expo run:ios       # or: npx expo run:android
```

Or build in the cloud with EAS: `npx eas-cli@latest build --profile development`.

`npx expo start --web` serves a design preview in the browser with sample data. It is unencrypted, in-memory, and not a supported target. Camera, voice and OCR aren't available there, and the assistant is simulated (a pretend download and canned suggestions) so its screens can be reviewed.

```bash
npm test            # data layer and search tests (real SQL via better-sqlite3)
npm run typecheck
npm run lint
```

## Layout

```
src/app/          screens (Expo Router)
src/components/   screen-level components (place picker, cabinet tab bar, ...)
src/ai/           optional on-device assistant (models, prompts, llama.rn engine)
src/backup/       encrypted archive format and device glue
src/boxes/        box fingerprints (OCR words + colour features) and matching
src/db/           schema/migrations, repository, encrypted open
src/photos/       capture and resize
src/reminders/    due-date reminder planning and scheduling
src/search/       fuzzy matcher and catalog index
src/security/     app lock, key vault (sealed key + recovery)
src/ui/           theme, icons, toasts, library UI primitives
src/voice/        dictation and spoken-sentence parsing
scripts/          make-icons.js renders the icon set with Playwright
```
