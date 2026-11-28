/** Native auth persistence. Only authenticated ciphertext is stored outside the OS vault.
 * Serializes each Supabase key; a committed tombstone prevents interrupted logout
 * or a leftover legacy value from restoring a signed-out account.
 */
export interface AuthStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
export interface AuthCipher {
  generateKey(): Promise<string>;
  seal(value: string, key: string, context: string): Promise<string>;
  open(value: string, key: string, context: string): Promise<string>;
}
export function createProtectedAuthStorage(storage: AuthStore, vault: AuthStore, cipher: AuthCipher): AuthStore {
  const tails = new Map<string, Promise<unknown>>();
  const encryptedKey = (key: string) => `${key}.encrypted-v1`;
  const vaultKey = (key: string) => {
    if (!/^[a-zA-Z0-9._-]+$/.test(key)) throw new Error("Unsupported sign-in storage key.");
    return `sweetmate.auth.v1.${key}`;
  };
  const loggedOut = "signed-out-v1";
  function serial<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const result = (tails.get(key) ?? Promise.resolve()).catch(() => {}).then(operation);
    tails.set(key, result);
    void result.finally(() => { if (tails.get(key) === result) tails.delete(key); }).catch(() => {});
    return result.catch(() => { throw new Error("Protected sign-in storage is unavailable. Unlock your device and try again."); });
  }
  async function save(key: string, value: string) {
    const secretName = vaultKey(key);
    let secret = await vault.getItem(secretName);
    if (!secret) {
      secret = await cipher.generateKey();
      await vault.setItem(secretName, secret);
      if (await vault.getItem(secretName) !== secret) throw new Error("Vault write failed");
    }
    const sealed = await cipher.seal(value, secret, key);
    // Verify before replacing the previous committed session or removing plaintext.
    if (await cipher.open(sealed, secret, key) !== value) throw new Error("Encryption verification failed");
    const encoded = JSON.stringify({ v: 1, data: sealed });
    await storage.setItem(encryptedKey(key), encoded);
    if (await storage.getItem(encryptedKey(key)) !== encoded) throw new Error("Session write failed");
    await storage.removeItem(key);
  }
  return {
    getItem: key => serial(key, async () => {
      const encoded = await storage.getItem(encryptedKey(key));
      if (encoded === loggedOut) return null;
      if (encoded !== null) {
        const secret = await vault.getItem(vaultKey(key));
        if (!secret) {
          // A restored Android backup cannot decrypt a key from the old install.
          // Do not resurrect leftover plaintext; require a new sign-in instead.
          await storage.setItem(encryptedKey(key), loggedOut);
          await storage.removeItem(key);
          return null;
        }
        const envelope = JSON.parse(encoded);
        if (envelope.v !== 1 || typeof envelope.data !== "string") throw new Error("Invalid encrypted session");
        const value = await cipher.open(envelope.data, secret, key);
        await storage.removeItem(key); // finishes a migration interrupted after commit
        return value;
      }
      const legacy = await storage.getItem(key);
      if (legacy === null) return null;
      await save(key, legacy);
      return legacy;
    }),
    setItem: (key, value) => serial(key, () => save(key, value)),
    removeItem: key => serial(key, async () => {
      await storage.setItem(encryptedKey(key), loggedOut);
      await storage.removeItem(key);
      await vault.removeItem(vaultKey(key));
      // Keep the tiny tombstone: no interruption can make legacy credentials authoritative.
    }),
  };
}
