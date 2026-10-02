/** Base58 alphabet (no 0, O, I, l) used for short codes. */
export const CODE_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export const CODE_LENGTH = 8;
export const CODE_REGEX = /^[1-9A-HJ-NP-Za-km-z]{8}$/;

export const DEFAULT_TTL_SECONDS = 60 * 60;
export const MIN_TTL_SECONDS = 1;
export const DEFAULT_MAX_FILE_BYTES = 50 * 1024 * 1024;
/** The Workers request body limit on the free and pro plans. */
export const HARD_MAX_FILE_BYTES = 100 * 1024 * 1024;
