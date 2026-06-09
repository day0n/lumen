export function sanitizeVideoPromptText(text: string): string {
  return text
    .replace(
      /\binserts?\s+([^.,;]{0,80}?)\s+into\s+(?:his|her|their|the)?\s*ear\b/gi,
      'positions $1 near the side profile',
    )
    .replace(
      /\bputs?\s+([^.,;]{0,80}?)\s+(?:in|into|inside)\s+(?:his|her|their|the)?\s*ear\b/gi,
      'positions $1 near the side profile',
    )
    .replace(/\b(?:in|into|inside)\s+(?:his|her|their|the)?\s*ear\b/gi, 'near the side profile')
    .replace(/\bear\b/gi, 'side profile')
    .replace(/\binserts?\b/gi, 'positions')
    .replace(/\bmouth shapes?\b/gi, 'spoken timing')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
