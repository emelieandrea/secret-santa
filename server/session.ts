import { randomBytes, randomInt } from "node:crypto";

export const token = () => randomBytes(24).toString("base64url");
export type Participant = {
  id: string;
  name: string;
  secret: string;
  pinHash?: string;
  failures?: number;
  lockedUntil?: number;
};
export type Session = {
  id: string;
  host: string;
  people: Participant[];
  matches: Map<string, string> | null;
  expires: number;
};

// Rejection sampling gives every permutation without fixed points equal probability.
export function draw(ids: string[]): Map<string, string> {
  if (ids.length < 2) throw new Error("Minst två deltagare behövs.");
  let shuffled: string[];
  do {
    shuffled = [...ids];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
  } while (shuffled.some((id, i) => id === ids[i]));
  return new Map(ids.map((id, i) => [id, shuffled[i]]));
}

export function view(s: Session, p: Participant) {
  return {
    id: s.id,
    people: s.people.map(({ id, name }) => ({ id, name })),
    me: p.id,
    isHost: p.secret === s.host,
    drawn: !!s.matches,
    recipient: s.matches
      ? s.people.find((x) => x.id === s.matches!.get(p.id))!.name
      : null,
    requiresPin: !p.pinHash,
    expires: s.expires,
  };
}
