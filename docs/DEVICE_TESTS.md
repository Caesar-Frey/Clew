# Device test script

Run this on a development build (`npx eas-cli@latest build --profile development`, or `npx expo run:ios` / `run:android`) on one iPhone and one Android phone (Android 13 or later). Each line is one check; tick it when it behaves as described. About 45 minutes.

## Setup
- [ ] Fresh install. Open Clew: home shows the empty catalog with three "how it works" lines and no keyboard.

## Adding and finding
- [ ] Tap +. Type a name, Return moves to "Where is it?". Type "gar", Return picks the highlighted place; Return never saves and never creates a place.
- [ ] The save button reads "Save to Garage › …". Tap it: you return to where you were and a toast says "Saved … in …" with Undo and View. Undo removes it.
- [ ] Add with no place: the toast offers "Add place", which opens Move.
- [ ] Type a name, then swipe the Add sheet down: "Discard this card?" appears. Same on Lend, Move, Edit, Backup, Seal.
- [ ] With the keyboard up on Add, Lend, Move, Seal, Backup and place rename, the Save button stays visible and the first tap on it saves (it doesn't only close the keyboard). Check on Android too (edge-to-edge).
- [ ] Search "where can I find the drill": the drill is found. Home's "Browse all N things A–Z" opens the A–Z list; the place chips filter it.

## Voice (needs microphone)
- [ ] Tap Say it on Add, allow the microphone and speech prompts. Say "I lent the drill to Sam until Friday": lent to Sam, due this Friday. The words appear while you speak.
- [ ] Force-quit Clew while listening, reopen: no crash, voice works again.
- [ ] Airplane mode: on a phone without offline speech for its language, Clew asks before using the online service (or says voice needs a connection).

## Photos and boxes
- [ ] Add a photo to a thing. Then check Files / Photos: no stray copies of the photo are left in Clew's caches after a restart.
- [ ] On a place page, "Fingerprint this box" with a labelled box. On Shelves, "Which box is this?" and photograph the same box: it shows both photos side by side and "Yes, that's it". A different, unsaved box offers "None of these".
- [ ] Android: the first label read works offline right after install (ML Kit OCR model). On a phone without Google Play services, the scan says "Reading labels isn't available on this phone".

## Lending and reminders
- [ ] Lend something due tomorrow. Android 13+: turning on reminders on the Desk shows the system notification prompt (first time). The Desk switch stays off until permission is granted.
- [ ] Change the phone's time to 9:01 the next day: one reminder arrives. Tap it: Clew opens that thing (also from a cold start).
- [ ] Deny notifications in Settings, return to Clew: the Desk switch shows off and says notifications are off.

## Lock and security
- [ ] Desk › App lock on. Background for longer than the relock time: Face ID/fingerprint asked on return.
- [ ] Remove the phone's passcode in Settings, reopen Clew: it explains why it can't unlock and offers "Open Settings" (no endless prompt).
- [ ] Desk › "Require Face ID to open data" with a recovery passphrase. Add a new fingerprint/face in Settings: Clew asks for the recovery passphrase and opens.

## Backup and restore
- [ ] Desk › Make a backup with a 3-word passphrase: the encryption progress shows (the stronger key derivation takes a few seconds; note how long). Save to Files. Answer "Yes, it's saved".
- [ ] Delete the app, reinstall, Restore a backup from the empty catalog: everything returns, including photos.
- [ ] iPhone transfer or iCloud restore onto a second iPhone: Clew opens on "This catalog is locked to another phone"; "Restore from a backup file" works; "I don't have a backup" needs ERASE typed.

## Assistant (optional, Wi-Fi)
- [ ] Desk › Library assistant: a phone under 6 GB RAM only offers the smaller model. On mobile data, Get asks first.
- [ ] Download the smaller model; it shows "Checking the files…" then ready (note how long). Cancel midway on a second try: no `.part` file is left and space is freed.
- [ ] On Add, take a photo with no name: the assistant suggests a name. Search "something to cut wood": a saw shows under "Might be what you mean".

## Accessibility
- [ ] VoiceOver / TalkBack: toasts stay until dismissed and offer Undo; tab "Desk, backup due" is read when the dot shows; buttons say what they do.
- [ ] Largest text size: item cards, spine chips and the item header don't clip.
- [ ] Reduce Motion on: no bounce on buttons, tabs or chips. Desk › Haptics off: no vibration anywhere.
