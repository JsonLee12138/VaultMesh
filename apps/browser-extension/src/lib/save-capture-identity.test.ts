import { describe, expect, it } from "vitest";

import type { CapturedIdentity } from "./save-capture";
import { buildIdentityUpdate, identityMatchesCapture, identityUpdateChanges } from "./save-capture-identity";

const identityId = "153370ec-4dc7-4c77-a6e0-f2a4f6e37f03";
const emailId = "253370ec-4dc7-4c77-a6e0-f2a4f6e37f03";
const existing = {
  id: identityId, title: "Ada", firstName: "Ada", middleName: null, lastName: "Lovelace", birthDate: null,
  emails: [{ id: emailId, label: "主要", value: "ada@example.test", preferred: true }], phones: [], addresses: [],
  organization: null, department: null, jobTitle: null, website: null, notes: "keep", folder: null, favorite: true,
};

function capture(overrides: Partial<CapturedIdentity> = {}): CapturedIdentity {
  return {
    title: "Ada", firstName: "Ada", middleName: null, lastName: "Lovelace", birthDate: null,
    emails: [{ label: "主要", value: "ada@example.test", preferred: true }], phones: [], addresses: [],
    organization: null, department: null, jobTitle: null, website: null,
    ...overrides,
  };
}

describe("identity save capture planning", () => {
  it("matches an existing profile by normalized email", () => {
    expect(identityMatchesCapture(existing, capture({ emails: [{ label: "主要", value: " ADA@EXAMPLE.TEST ", preferred: true }] }))).toBe(true);
  });

  it("matches an existing profile from a partial but exact street address", () => {
    const withAddress = {
      ...existing,
      emails: [],
      addresses: [{ id: emailId, label: "家庭", addressLine1: "12 Example Street", addressLine2: null, city: "London", region: null, postalCode: "N1 9GU", countryCode: "GB", country: null, preferred: true }],
    };
    const addressCapture = capture({
      emails: [],
      addresses: [{ label: "主要", addressLine1: "12 example street", addressLine2: null, city: null, region: null, postalCode: "N1 9GU", countryCode: null, country: null, preferred: true }],
    });
    expect(identityMatchesCapture(withAddress, addressCapture)).toBe(true);
    const update = buildIdentityUpdate(withAddress, { ...addressCapture, identityId });
    expect(identityUpdateChanges(withAddress, update)).toBe(false);
  });

  it("does not report a change for an unchanged captured profile", () => {
    const update = buildIdentityUpdate(existing, capture({ identityId }));
    expect(identityUpdateChanges(existing, update)).toBe(false);
  });

  it("replaces the sole filled email while preserving its stable entry id", () => {
    const update = buildIdentityUpdate(existing, capture({ identityId, emails: [{ label: "主要", value: "new@example.test", preferred: true }] }));
    expect(update.emails).toEqual([{ id: emailId, label: "主要", value: "new@example.test", preferred: true }]);
    expect(identityUpdateChanges(existing, update)).toBe(true);
  });

  it("preserves vault-only metadata while updating captured fields", () => {
    const update = buildIdentityUpdate(existing, capture({ identityId, organization: "Analytical Engines" }));
    expect(update).toMatchObject({ id: identityId, organization: "Analytical Engines", notes: "keep", favorite: true });
  });

  it("keeps only one preferred email, phone, and address when captured values are appended", () => {
    const profile = {
      ...existing,
      emails: [
        { id: emailId, label: "主要", value: "ada@example.test", preferred: true },
        { id: "353370ec-4dc7-4c77-a6e0-f2a4f6e37f03", label: "其他", value: "ada@work.test", preferred: false },
      ],
      phones: [
        { id: "453370ec-4dc7-4c77-a6e0-f2a4f6e37f03", label: "主要", value: "+44 20 7946 0958", preferred: true },
        { id: "553370ec-4dc7-4c77-a6e0-f2a4f6e37f03", label: "其他", value: "+44 20 7946 0959", preferred: false },
      ],
      addresses: [
        { id: "653370ec-4dc7-4c77-a6e0-f2a4f6e37f03", label: "主要", addressLine1: "12 Example Street", addressLine2: null, city: "London", region: null, postalCode: "N1 9GU", countryCode: "GB", country: null, preferred: true },
        { id: "753370ec-4dc7-4c77-a6e0-f2a4f6e37f03", label: "其他", addressLine1: "34 Example Street", addressLine2: null, city: "London", region: null, postalCode: "N1 9GX", countryCode: "GB", country: null, preferred: false },
      ],
    };
    const update = buildIdentityUpdate(profile, capture({
      identityId,
      emails: [{ label: "主要", value: "ada@new.test", preferred: true }],
      phones: [{ label: "主要", value: "+44 20 7946 0960", preferred: true }],
      addresses: [{ label: "主要", addressLine1: "56 Example Street", addressLine2: null, city: "London", region: null, postalCode: "N1 9GY", countryCode: "GB", country: null, preferred: true }],
    }));

    for (const field of ["emails", "phones", "addresses"] as const) {
      const values = update[field] as Array<{ preferred: boolean }>;
      expect(values.filter((entry) => entry.preferred)).toHaveLength(1);
      expect(values.at(-1)?.preferred).toBe(false);
    }
  });
});
