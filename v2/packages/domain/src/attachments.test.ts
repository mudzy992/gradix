import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_ENTITY_TYPES,
  MAX_ATTACHMENT_BYTES,
  attachmentObjectKey,
  isAttachmentEntityType,
  validateAttachmentInput,
} from "./attachments";

const sha = "a".repeat(64);

describe("validateAttachmentInput", () => {
  it("propušta ispravan unos", () => {
    expect(validateAttachmentInput({ sizeBytes: 1024, sha256: sha })).toBeNull();
  });

  it("odbija nulu, negativno i preko 10 MB", () => {
    for (const sizeBytes of [0, -1, Number.NaN]) {
      expect(validateAttachmentInput({ sizeBytes, sha256: sha })?.code).toBe("VALIDATION_FAILED");
    }
    expect(validateAttachmentInput({ sizeBytes: MAX_ATTACHMENT_BYTES + 1, sha256: sha })?.message).toContain("10 MB");
  });

  it("odbija sha256 koji nije 64 mala heksadecimalna znaka", () => {
    for (const bad of ["", "abc", "A".repeat(64), "a".repeat(63), "g".repeat(64)]) {
      expect(validateAttachmentInput({ sizeBytes: 1, sha256: bad })?.code).toBe("VALIDATION_FAILED");
    }
  });
});

describe("attachmentObjectKey", () => {
  it("stavlja firmu u putanju i tip u kebab oblik", () => {
    expect(attachmentObjectKey("cmp_1", "MACHINE_DAILY_CHECK", "chk_1", "att_1")).toBe(
      "gx2/cmp_1/machine-daily-check/chk_1/att_1",
    );
  });
});

describe("isAttachmentEntityType", () => {
  it("priznaje samo tipove iz baze", () => {
    for (const value of ATTACHMENT_ENTITY_TYPES) expect(isAttachmentEntityType(value)).toBe(true);
    for (const value of ["OBLIGATIONS", "", null, 7]) expect(isAttachmentEntityType(value)).toBe(false);
    // Vrijednost je VELIKIM slovima; malo slovo ne smije proći (CHECK u bazi je strog).
    expect(isAttachmentEntityType("project")).toBe(false);
  });
});
