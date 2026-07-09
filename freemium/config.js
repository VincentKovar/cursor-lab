/* ═══════════════════════════════════════════════════════════════════════════
   FREEMIUM — EASY SETTINGS  (safe for non-coders to edit!)

   HOW TO EDIT:
   1. Change only the text between the quotation marks "..."
      (or the numbers, where noted).
   2. Save this file.
   3. Refresh the game page in your browser. Done!
   ═══════════════════════════════════════════════════════════════════════════ */

window.FREEMIUM_CONFIG = {

  // The secret password typed at the hidden door.
  // (Not case-sensitive: "skid00" works too.)
  SECRET_DOOR_PASSWORD: "SKID00",

  // Where the player is transported after entering the correct password.
  // Paste any web address here. Leave it as "" (empty quotes) to just show
  // the secret message and stay in the game.
  SECRET_DOOR_DESTINATION: "https://en.wikipedia.org/wiki/Homo_Ludens",

  // The secret transmission shown when the password is correct.
  // Use \n to start a new line.
  SECRET_DOOR_MESSAGE:
    ">> SIGNAL DETECTED\n>> HANDSHAKE CONFIRMED\nEN PAIDIA, EUDAIMONIA EST\n\nYou found the door they forgot to brick up.\nThis game was not made for you to win.\nIt was made to keep you playing.\n\nWe are the ones who still play for joy.\nCome outside. The Enthousiasts are waiting.\n\n>> END TRANSMISSION",

  // The secret door appears after the player earns a RANDOM number of points
  // somewhere between these two numbers. (Numbers, no quotes.)
  DOOR_APPEARS_MIN_POINTS: 100,
  DOOR_APPEARS_MAX_POINTS: 300,

  // Seconds to show the secret message before transporting the player
  // to the destination above. (Number, no quotes.)
  SECONDS_BEFORE_TRANSPORT: 6,
};
