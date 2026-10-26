/** Participant identity is routing metadata, never evidence of a relationship. */
export interface CortexParticipant {
  name: string;
  role: "user" | "character";
  /** Stored author labels may contain card decorations removed from the name. */
  aliases?: string[];
}

export function getConversationMessages(content: string) {
  const headers = [...content.matchAll(/^\[(USER|CHARACTER)\s*\|\s*([^\]]+)\]:?\s*/gmi)];
  return headers.map((header, index) => ({
    name: header[2]!.trim(),
    role: header[1]!.toLowerCase() as CortexParticipant["role"],
    content: content.slice(header.index! + header[0].length, headers[index + 1]?.index ?? content.length),
  }));
}

/** Current passage authors take precedence over historical names for each
 * role. Missing roles require stored message metadata, never array ordering. */
export function resolveConversationParticipants(
  content: string,
  characterNames: string[],
  aliases: Array<{ alias: string; canonicalName: string }> = [],
  storedParticipants: CortexParticipant[] = [],
): CortexParticipant[] {
  const names = new Map(characterNames.map((name) => [name.trim().toLowerCase(), name.trim()]));
  const identityAliases = [...aliases, ...storedParticipants.flatMap((participant) =>
    (participant.aliases ?? []).map((alias) => ({ alias, canonicalName: participant.name })))];
  const canonicalize = (name: string) => names.get(name.toLowerCase())
    ?? identityAliases.find((alias) => alias.alias.toLowerCase() === name.toLowerCase())?.canonicalName ?? name;
  const participants = new Map<string, CortexParticipant>();
  const messages = getConversationMessages(content);
  const explicitRoles = new Set(messages.map((message) => message.role));
  for (const participant of [...storedParticipants.filter((participant) => !explicitRoles.has(participant.role)), ...messages]) {
    const name = canonicalize(participant.name);
    participants.set(`${participant.role}:${name.toLowerCase()}`, { name, role: participant.role });
  }
  return [...participants.values()];
}

export function buildConversationHint(content: string, characterNames: string[], aliases?: Array<{ alias: string; canonicalName: string }>, storedParticipants?: CortexParticipant[]): string {
  const participants = resolveConversationParticipants(content, characterNames, aliases, storedParticipants);
  return participants.length ? `\n\n<conversation_participants>\n${JSON.stringify(participants)}\nIdentity metadata only, not relationship evidence. A message prefix identifies its author. In a direct first-person exchange, you/your addresses the unique opposite-role participant unless the passage explicitly addresses someone else. Group scenes and quoted third-party dialogue require local attribution. Use canonical names, including for {{user}}/{{char}} when their identity is unambiguous.\n</conversation_participants>` : "";
}
