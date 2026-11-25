import JailMonkey from "jail-monkey";

export type DeviceCheck = { safe: boolean; reasons: string[]; overridden: boolean };

/** A debug build on a developer's machine/emulator is allowed; a release build is not, unless explicitly built with the flag. */
const overridden = () => (typeof __DEV__ !== "undefined" && __DEV__) || process.env.EXPO_PUBLIC_ALLOW_ROOTED === "1";

/**
 * Detects phones that are rooted or tampered with. On such phones another app can read memory while a key is used,
 * so JanSetu will not create a wallet or sign. Detection is best effort: a determined attacker can hide root,
 * so this is one layer, not a guarantee.
 */
export function checkDevice(): DeviceCheck {
  const reasons: string[] = [];
  try {
    if (JailMonkey.isJailBroken()) reasons.push("This phone appears to be rooted.");
    if (JailMonkey.hookDetected()) reasons.push("A hooking tool (such as Frida or Xposed) was detected.");
  } catch {
    reasons.push("The phone security check could not run.");
  }
  const o = overridden();
  return { safe: reasons.length === 0 || o, reasons, overridden: o && reasons.length > 0 };
}

export function assertDeviceSafe() {
  const c = checkDevice();
  if (!c.safe) throw new Error(`For your safety JanSetu will not sign on this phone. ${c.reasons.join(" ")}`);
}
