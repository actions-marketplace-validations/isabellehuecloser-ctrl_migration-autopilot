import * as core from "@actions/core";
import * as github from "@actions/github";

// === Autopilot Pro licensing =============================================
// Model: free on PUBLIC repos forever. On PRIVATE repos, once the gate is
// active, a valid "Autopilot Pro" license is required. Validation FAILS OPEN
// on any network/server error so a paying customer's CI is never broken by
// our license server being unreachable.
//
// The two constants below are filled in at deploy time (Phase 3/4):
//   POLAR_ORG_ID     - Polar organization id. PUBLIC value; Polar license
//                      validation is unauthenticated, so it is safe to ship.
//   GATE_ACTIVE_FROM - ISO date (e.g. "2026-07-15"). Before this date the gate
//                      is OFF and private repos run free (existing users are
//                      warned, never broken). Empty string = gate off.
const POLAR_ORG_ID = ""; // TODO(deploy): set Polar organization id
const GATE_ACTIVE_FROM = ""; // TODO(deploy): set ISO go-live date, e.g. "2026-07-15"

const POLAR_VALIDATE_URL =
  "https://api.polar.sh/v1/customer-portal/license-keys/validate";
const VALIDATE_TIMEOUT_MS = 5000;

type FetchLike = (
  url: string,
  init: any
) => Promise<{ status: number; ok: boolean; json: () => Promise<any> }>;

export interface CheckLicenseOptions {
  licenseKey: string;
  toolName: string;
  buyUrl: string;
  // Test/override hooks (production leaves these undefined):
  repoPrivate?: boolean;
  orgId?: string;
  gateFrom?: string;
  now?: Date;
  fetchImpl?: FetchLike;
}

export type LicenseResult =
  | { allow: true; pro: boolean; note?: string }
  | { allow: false; message: string };

function resolvePrivate(opts: CheckLicenseOptions): boolean {
  if (typeof opts.repoPrivate === "boolean") return opts.repoPrivate;
  return github.context.payload.repository?.private === true;
}

function gateActive(gateFrom: string, now: Date): boolean {
  if (!gateFrom) return false;
  const from = new Date(gateFrom);
  if (Number.isNaN(from.getTime())) return false;
  return now.getTime() >= from.getTime();
}

async function validateKey(
  key: string,
  orgId: string,
  fetchImpl: FetchLike
): Promise<"valid" | "invalid" | "unknown"> {
  if (!orgId) return "unknown"; // not configured yet -> fail open
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VALIDATE_TIMEOUT_MS);
  try {
    const res = await fetchImpl(POLAR_VALIDATE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, organization_id: orgId }),
      signal: controller.signal,
    });
    if (res.status === 404) return "invalid"; // key not found
    if (!res.ok) return "unknown"; // server error -> fail open
    const data = await res.json();
    if (data?.status && data.status !== "granted") return "invalid";
    if (data?.expires_at && new Date(data.expires_at).getTime() < Date.now())
      return "invalid";
    return "valid";
  } catch {
    return "unknown"; // network/timeout -> fail open
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Decide whether this run is allowed and whether Pro features are unlocked.
 * Returns { allow:false, message } when a private repo must be blocked.
 */
export async function checkLicense(
  opts: CheckLicenseOptions
): Promise<LicenseResult> {
  const now = opts.now ?? new Date();
  const orgId = opts.orgId ?? POLAR_ORG_ID;
  const gateFrom = opts.gateFrom ?? GATE_ACTIVE_FROM;
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);

  // Public repos: always free.
  if (!resolvePrivate(opts)) return { allow: true, pro: false };

  const key = (opts.licenseKey || "").trim();

  // Gate not active yet: run free on private, but warn this is changing.
  // This is the grandfather / launch-grace window so existing private-repo
  // users are never broken without notice.
  if (!gateActive(gateFrom, now)) {
    if (gateFrom) {
      core.warning(
        `${opts.toolName} is free on private repos until ${gateFrom}. After that an ` +
          `Autopilot Pro license will be required. ${opts.buyUrl}`
      );
    }
    return { allow: true, pro: key.length > 0 };
  }

  // Gate active on a private repo.
  if (!key) {
    return {
      allow: false,
      message:
        `${opts.toolName} requires an Autopilot Pro license on private repositories. ` +
        `Start a free trial / subscribe at ${opts.buyUrl}, then set the key as the ` +
        "`license-key` input (store it in a repository or organization secret).",
    };
  }

  const verdict = await validateKey(key, orgId, fetchImpl);
  if (verdict === "invalid") {
    return {
      allow: false,
      message: `Autopilot Pro license key is invalid, expired, or revoked. Manage it at ${opts.buyUrl}`,
    };
  }
  if (verdict === "unknown") {
    core.warning(
      "Could not reach the Autopilot license server; allowing this run (fail-open). " +
        "The license will be re-checked on the next run."
    );
    return { allow: true, pro: true, note: "fail-open" };
  }
  return { allow: true, pro: true };
}
