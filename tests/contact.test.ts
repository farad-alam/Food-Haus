import { describe, expect, it } from "vitest";
import { contactFromStored, contactSchema, DEFAULT_CONTACT, isConfirmed, missingForApproval, normaliseCompanyNumber, normaliseUkPhone, normaliseVat } from "@/lib/contact";
import { fullAddress, mapsLinkFor, phoneDisplay, telHref } from "@/lib/contact-format";

const good = { legalName: "Food Haus Ltd", phone: "07438 795428", email: "orders@foodhaus.test", street: "314-318 Selbourne Road", locality: "Luton", postcode: "lu4 8nu", companyNumber: "12345678", registeredOffice: "1 High Street, Luton LU1 1AA", vatNumber: "gb 123 456 789" };

describe("phone numbers", () => {
  it("accepts every common way of writing a UK number and stores one form", () => {
    for (const ok of ["07438 795428", "07438795428", "+44 7438 795428", "+447438795428", "0044 7438 795428", "(07438) 795-428", "01582 123456", "020 7946 0958"]) expect([ok, normaliseUkPhone(ok)?.startsWith("+44")]).toEqual([ok, true]);
    expect(normaliseUkPhone("07438 795428")).toBe("+447438795428");
    expect(normaliseUkPhone("+44 (0) 7438 795428")).toBeNull(); // the (0) form is ambiguous: refuse rather than guess
  });
  it("refuses anything else", () => {
    for (const bad of ["", "7438795428", "0743879542", "074387954289", "+1 202 555 0101", "00 7438 795428", "phone", "0743 87954 2a", "+4474387954"]) expect([bad, normaliseUkPhone(bad)]).toEqual([bad, null]);
  });
  it("shows the national form and makes a tel: link", () => {
    expect(phoneDisplay("+447438795428")).toBe("07438 795428");
    expect(telHref("+447438795428")).toBe("tel:+447438795428");
  });
});

describe("company numbers", () => {
  it("Companies House and VAT formats", () => {
    expect(normaliseCompanyNumber("1234 5678")).toBe("12345678");
    expect(normaliseCompanyNumber("sc123456")).toBe("SC123456");
    for (const bad of ["1234567", "123456789", "ABC12345", "12-345678", ""]) expect([bad, normaliseCompanyNumber(bad)]).toEqual([bad, null]);
    expect(normaliseVat("gb 123 456 789")).toBe("GB123456789");
    expect(normaliseVat("GB123456789012")).toBe("GB123456789012");
    for (const bad of ["123456789", "GB12345678", "FR123456789", "GB1234567890"]) expect([bad, normaliseVat(bad)]).toEqual([bad, null]);
  });
});

describe("the form schema", () => {
  it("tidies everything it accepts", () => {
    expect(contactSchema.parse(good)).toEqual({ legalName: "Food Haus Ltd", phone: "+447438795428", email: "orders@foodhaus.test", street: "314-318 Selbourne Road", locality: "Luton", postcode: "LU4 8NU", companyNumber: "12345678", registeredOffice: "1 High Street, Luton LU1 1AA", vatNumber: "GB123456789" });
    expect(contactSchema.parse({ ...good, legalName: null, companyNumber: "", registeredOffice: "   ", vatNumber: null })).toMatchObject({ legalName: null, companyNumber: null, registeredOffice: null, vatNumber: null });
    expect(contactSchema.parse({ ...good, street: "  1   High \n Street ", locality: " Luton  " })).toMatchObject({ street: "1 High Street", locality: "Luton" });
  });
  it("rejects bad values and unknown fields with a plain message", () => {
    const bad: [string, object][] = [
      ["phone", { phone: "12345" }], ["email", { email: "not an email" }], ["email", { email: "" }], ["street", { street: "" }], ["street", { street: "x".repeat(101) }],
      ["postcode", { postcode: "ABC" }], ["company number", { companyNumber: "12" }], ["vat", { vatNumber: "123" }], ["markup", { street: "<b>Road</b>" }], ["markup", { legalName: "<script>" }], ["long", { registeredOffice: "x".repeat(300) }],
    ];
    for (const [name, patch] of bad) expect([name, contactSchema.safeParse({ ...good, ...patch }).success]).toEqual([name, false]);
    expect(contactSchema.safeParse({ ...good, extra: 1 }).success).toBe(false);
    const noPhone: Record<string, unknown> = { ...good };
    delete noPhone.phone;
    expect(contactSchema.safeParse(noPhone).success).toBe(false);
    expect(contactSchema.safeParse({ ...good, phone: "12345" }).error?.issues[0].message).toMatch(/UK phone number/);
  });
});

describe("what the site reads", () => {
  it("a fresh database starts from the Google listing values, with NO invented legal name or company numbers", () => {
    expect(contactFromStored({})).toEqual(DEFAULT_CONTACT);
    expect(DEFAULT_CONTACT.legalName).toBeNull();
    expect(DEFAULT_CONTACT.companyNumber).toBeNull();
    expect(isConfirmed({})).toBe(false);
    expect(isConfirmed(contactSchema.parse(good))).toBe(true);
  });
  it("saved values win; invalid stored data is ignored whole, never shown", () => {
    expect(contactFromStored(contactSchema.parse(good)).phone).toBe("+447438795428");
    expect(contactFromStored({ ...contactSchema.parse(good), phone: "garbage" })).toEqual(DEFAULT_CONTACT);
    for (const junk of [null, undefined, "x", 5, []]) expect(contactFromStored(junk)).toEqual(DEFAULT_CONTACT);
  });
  it("derived address and directions link follow the saved address", () => {
    const c = contactSchema.parse(good);
    expect(fullAddress(c)).toBe("314-318 Selbourne Road, Luton LU4 8NU");
    expect(mapsLinkFor(c)).toContain(encodeURIComponent("Food Haus 314-318 Selbourne Road, Luton LU4 8NU"));
  });
  it("approval needs the legal name, company number and registered office", () => {
    expect(missingForApproval(DEFAULT_CONTACT)).toEqual(["legal name", "Companies House number", "registered office"]);
    expect(missingForApproval(contactSchema.parse(good))).toEqual([]);
  });
});
