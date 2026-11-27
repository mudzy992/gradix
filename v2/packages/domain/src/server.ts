/**
 * `@gradix/domain/server` — dio domene koji traži Node API.
 *
 * Zašto odvojen ulaz: mobilni bundle (Metro) ne poznaje `node:crypto`, a barrel ga je
 * uvlačio preko `totp.ts` i rušio Android build. Ovaj ulaz uvoze web, worker i testovi;
 * mobilni NIKAD.
 */
export {
  RECOVERY_CODE_COUNT,
  TOTP_DIGITS,
  TOTP_PERIOD_SECONDS,
  TOTP_WINDOW_STEPS,
  base32Decode,
  base32Encode,
  decryptTotpSecret,
  encryptTotpSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  normalizeRecoveryCode,
  totpCode,
  totpStep,
  totpUri,
  verifyTotp,
  type TotpVerifyResult,
} from "./totp";
