/**
 * Keeps only the head and tail of long content before sending it to an AI
 * provider, so a huge report/file doesn't burn tokens needlessly. Applied
 * before cache-key hashing too, so truncated-identical inputs still hit
 * the cache.
 */
export function truncateForAI(content: string, maxChars = 8000): string {
  if (content.length <= maxChars) {
    return content;
  }

  const headLength = Math.floor(maxChars * 0.7);
  const tailLength = maxChars - headLength;
  const head = content.slice(0, headLength);
  const tail = content.slice(-tailLength);

  return `${head}\n\n...(중략: 원본 ${content.length}자 중 ${maxChars}자만 표시)...\n\n${tail}`;
}
