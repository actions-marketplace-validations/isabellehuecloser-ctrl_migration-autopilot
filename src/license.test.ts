import { describe, it, expect } from "vitest";
import { checkLicense } from "./license";

const base = {
  licenseKey: "",
  toolName: "Test Autopilot",
  buyUrl: "https://useautopilot.dev/#pricing",
};
const FUTURE = "2999-01-01";
const PAST = "2000-01-01";

function fetchReturning(status: number, body: unknown): any {
  return async () => ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  });
}

describe("checkLicense", () => {
  it("public repo: always free", async () => {
    const r = await checkLicense({ ...base, repoPrivate: false, gateFrom: PAST, orgId: "org" });
    expect(r).toMatchObject({ allow: true, pro: false });
  });

  it("private + gate off (empty date): allowed, never broken", async () => {
    const r = await checkLicense({ ...base, repoPrivate: true, gateFrom: "" });
    expect(r.allow).toBe(true);
  });

  it("private + gate not yet active (future): allowed (grace window)", async () => {
    const r = await checkLicense({ ...base, repoPrivate: true, gateFrom: FUTURE });
    expect(r.allow).toBe(true);
  });

  it("private + gate active + no key: blocked with buy message", async () => {
    const r = await checkLicense({ ...base, repoPrivate: true, gateFrom: PAST, orgId: "org" });
    expect(r.allow).toBe(false);
    if (!r.allow) expect(r.message).toContain("useautopilot.dev");
  });

  it("private + gate active + valid key: allowed pro", async () => {
    const r = await checkLicense({
      ...base,
      licenseKey: "K",
      repoPrivate: true,
      gateFrom: PAST,
      orgId: "org",
      fetchImpl: fetchReturning(200, { status: "granted" }),
    });
    expect(r).toMatchObject({ allow: true, pro: true });
  });

  it("private + gate active + invalid key (404): blocked", async () => {
    const r = await checkLicense({
      ...base,
      licenseKey: "K",
      repoPrivate: true,
      gateFrom: PAST,
      orgId: "org",
      fetchImpl: fetchReturning(404, {}),
    });
    expect(r.allow).toBe(false);
  });

  it("private + gate active + expired key: blocked", async () => {
    const r = await checkLicense({
      ...base,
      licenseKey: "K",
      repoPrivate: true,
      gateFrom: PAST,
      orgId: "org",
      fetchImpl: fetchReturning(200, { status: "granted", expires_at: "2001-01-01" }),
    });
    expect(r.allow).toBe(false);
  });

  it("private + gate active + server error: FAILS OPEN (allowed)", async () => {
    const r = await checkLicense({
      ...base,
      licenseKey: "K",
      repoPrivate: true,
      gateFrom: PAST,
      orgId: "org",
      fetchImpl: fetchReturning(500, {}),
    });
    expect(r.allow).toBe(true);
  });

  it("private + gate active + network throw: FAILS OPEN (allowed)", async () => {
    const throwing: any = async () => {
      throw new Error("network down");
    };
    const r = await checkLicense({
      ...base,
      licenseKey: "K",
      repoPrivate: true,
      gateFrom: PAST,
      orgId: "org",
      fetchImpl: throwing,
    });
    expect(r.allow).toBe(true);
  });
});
