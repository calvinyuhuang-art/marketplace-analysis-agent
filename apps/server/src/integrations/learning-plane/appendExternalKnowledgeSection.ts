/** Concatenate local memory text with external published-knowledge section (external below local). */
export function appendExternalKnowledgeSection(
  localSection: string,
  externalSection: string
): string {
  const local = localSection.trim();
  const external = externalSection.trim();
  if (!local) return external;
  if (!external) return local;
  return `${local}\n\n${external}`;
}
