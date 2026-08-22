# Trackt for iOS and Android — privacy policy

_Last updated: 19 August 2026. Applies to the Trackt mobile app published by the
Trackt project. It does not apply to any particular Trackt server._

## The short version

**The Trackt project does not collect, receive, or store any of your data
through this app.** The app has no backend. It talks to one server — the Trackt
instance whose address you type into the first screen — and to nothing else.

There is no analytics, no crash reporting, no advertising identifier, and no
third-party SDK that phones home. Nothing in the app sends anything to the
project that publishes it.

## Who holds your data

Whoever runs the instance you connected to. That may be you, on your own
hardware; it may be a friend; it may be a hosted instance someone else operates.
It is their server, their database, and their privacy practices — ask them, not
us.

What that server holds is what Trackt is for: your account (email, username,
display name, optional bio, optional avatar), what you track and when you
tracked it, your ratings and favourites, your lists, and your friendships.
Trackt's own source is public, so exactly what is stored is inspectable rather
than described: see [`packages/db/src/schema`](../packages/db/src/schema).

The app never contacts more than one server at a time, and never a server you
did not name. There is no default instance and no fallback.

## What stays on your device

- **The instance address and your session token**, in the platform keychain
  (iOS Keychain / Android Keystore, via `expo-secure-store`).
- **A cache of what you last loaded**, so the app opens on your library rather
  than a spinner when you have no signal, and so a check-in taken with no signal
  is queued and sent when you have one again. It is stored unencrypted in the
  app's private storage, keyed to the instance it came from, and dropped after
  seven days unused.
- **Photos you pick for an avatar**, for as long as it takes to upload one. The
  app opens your photo library only when you ask it to, and only to read the
  image you choose. It has no camera or microphone permission at all.

All of it goes when you uninstall the app. **Change server** on the profile
screen clears the cached data for that instance immediately; signing out clears
the session.

## Deleting your account

**Profile → Account → Delete account**, in the app. It asks for your password,
and then deletes your account on that instance and everything attached to it —
your logs, check-ins, ratings, favourites, lists and friendships — permanently.
There is no undo and nothing is retained afterwards.

## Children

Trackt is not directed at children and asks for no age information. An instance
operator may have their own policy.

## Changes

This policy is versioned in the Trackt repository along with the app. Material
changes will be reflected here and in the store listing.

## Contact

For the app itself, open an issue at
<https://github.com/pvrnn/trackt>. For anything about the data on a particular
instance, contact whoever runs it — the Trackt project has no access to it.
