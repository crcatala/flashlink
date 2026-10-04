import { CODE_ALPHABET, CODE_LENGTH } from '@flashlink/core';

// Largest multiple of the alphabet size that fits in a byte; bytes at or above it
// are discarded so every character is equally likely (no modulo bias).
const ACCEPT_BELOW = Math.floor(256 / CODE_ALPHABET.length) * CODE_ALPHABET.length;

/** Generate an unguessable short code using the platform CSPRNG. */
export function generateCode(): string {
  let code = '';
  const bytes = new Uint8Array(32);
  while (code.length < CODE_LENGTH) {
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte < ACCEPT_BELOW && code.length < CODE_LENGTH) {
        code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
      }
    }
  }
  return code;
}
