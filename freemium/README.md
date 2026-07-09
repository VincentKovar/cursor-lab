# FREEMIUM

A satirical FPS where you play a corporate "monetization engine" blasting gamers
with ads, subscription traps, and microtransaction grenades. Hit a brand-crisis
yellow orb and the gamers revolt and hunt YOU. Earn enough points and a secret
door glitches into a corner of the arena…

## Play it

Open a terminal in this folder and run:

```
python3 -m http.server 8000
```

Then visit http://localhost:8000 in your browser. Works on desktop
(click to aim, WASD to move, click/SPACE to fire, 1/2/3 to switch weapons)
and mobile (on-screen joystick and buttons).

## Changing the secret door password or destination (no coding needed)

Open **`config.js`** in any text editor. Everything you can safely change is in
there with instructions:

- `SECRET_DOOR_PASSWORD` — the code typed at the hidden door (default `SKID00`)
- `SECRET_DOOR_DESTINATION` — the web address the player is transported to
- `SECRET_DOOR_MESSAGE` — the resistance transmission shown first
- `DOOR_APPEARS_MIN_POINTS` / `DOOR_APPEARS_MAX_POINTS` — the door appears at a
  random score between these
- `SECONDS_BEFORE_TRANSPORT` — countdown before the player is whisked away

Save the file and refresh the browser. That's it.
