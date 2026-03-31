/**
 * MIL-STD-2525D tactical SIDC: symbol set is digits 5–6 (1-based); "01" = air.
 * 30-digit values with digits 21–30 all zero use the first 20 digits (project rule).
 * Legacy letter/SIDC strings: APP-6 warfighting dimension at 0-based index 2 is "A" for air.
 */

function normalizeNumericSidcCore(trimmed: string): string | null {
  const digitsOnly = trimmed.replace(/\D/g, "");
  if (digitsOnly.length < 20) return null;
  let core = digitsOnly;
  if (core.length === 30 && core.slice(20).split("").every((c) => c === "0")) {
    core = core.slice(0, 20);
  }
  if (core.length < 20) return null;
  return core.slice(0, 20);
}

/** True only when the SIDC is explicitly the air symbol set (2525D "01" or legacy dimension A). */
export function isExplicitAirSidc(sidc: string | undefined | null): boolean {
  if (sidc == null) return false;
  const trimmed = sidc.trim();
  if (trimmed.length === 0) return false;

  const normalized = trimmed.replace(/[\s-]/g, "");
  if (/^\d+$/.test(normalized)) {
    const core = normalizeNumericSidcCore(normalized);
    if (!core) return false;
    return core.slice(4, 6) === "01";
  }

  const compact = normalized.toUpperCase();
  if (compact.length < 3) return false;
  return compact[2] === "A";
}
