const FORBIDDEN = [
  "asshole",
  "bastard",
  "bitch",
  "cunt",
  "dick",
  "faggot",
  "fuck",
  "fucking",
  "motherfucker",
  "nigger",
  "nigga",
  "piss",
  "pussy",
  "retard",
  "shit",
  "slut",
  "whore",
];

const PATTERN = new RegExp(`\\b(${FORBIDDEN.join("|")})\\b`, "gi");

export function censorText(input: string): { text: string; hit: boolean } {
  let hit = false;
  const text = input.replace(PATTERN, (word) => {
    hit = true;
    return "*".repeat(word.length);
  });
  return { text, hit };
}
