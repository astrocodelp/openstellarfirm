/**
 * What a form says when this computer has no keychain to keep a secret in.
 * On Linux that means no keyring is running, which the person can change, so
 * the sentence says how.
 */
export function noKeychainNote(
  platform: string | undefined,
  secret: "key" | "password",
): string {
  const base = `This computer has no keychain, so a ${secret} cannot be saved here.`;
  return platform === "linux"
    ? `${base} Start GNOME Keyring, KWallet or another Secret Service keyring, then open OpenStellarFirm again.`
    : base;
}
