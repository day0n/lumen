const FORBIDDEN_PERCENT_ENCODING_PATTERN = /%(?:00|2e|2f|5c)/i;

export function validateReleasePath(filename) {
  if (
    typeof filename !== 'string' ||
    filename.length === 0 ||
    filename.startsWith('/') ||
    filename.includes('\\') ||
    filename.includes('?') ||
    filename.includes('#') ||
    FORBIDDEN_PERCENT_ENCODING_PATTERN.test(filename) ||
    hasControlCharacter(filename)
  ) {
    throw new Error(`unsafe release path: ${filename}`);
  }

  const parts = filename.split('/');
  if (
    parts.some(
      (part) => part.length === 0 || part === '.' || part === '..' || part.startsWith('.'),
    ) ||
    filename.toLowerCase().endsWith('.map')
  ) {
    throw new Error(`unsafe release path: ${filename}`);
  }
  return filename;
}

export function isSafeReleasePath(filename) {
  try {
    validateReleasePath(filename);
    return true;
  } catch {
    return false;
  }
}

export function hasControlCharacter(value) {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}
