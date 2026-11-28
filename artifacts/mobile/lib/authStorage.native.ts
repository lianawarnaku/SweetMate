import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { AESEncryptionKey, AESSealedData, aesEncryptAsync, aesDecryptAsync } from "expo-crypto";
import { createProtectedAuthStorage } from "./protectedAuthStorage";

const options = { keychainService: "sweetmate.auth.v1", keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
export const authStorage = createProtectedAuthStorage(AsyncStorage, {
  getItem: key => SecureStore.getItemAsync(key, options),
  setItem: (key, value) => SecureStore.setItemAsync(key, value, options),
  removeItem: key => SecureStore.deleteItemAsync(key, options),
}, {
  generateKey: async () => (await AESEncryptionKey.generate()).encoded("base64"),
  seal: async (value, secret, context) => {
    const key = await AESEncryptionKey.import(secret, "base64");
    const data = await aesEncryptAsync(new TextEncoder().encode(value), key, { additionalData: new TextEncoder().encode(context) });
    return data.combined("base64");
  },
  open: async (value, secret, context) => {
    const key = await AESEncryptionKey.import(secret, "base64");
    const bytes = await aesDecryptAsync(AESSealedData.fromCombined(value), key, { additionalData: new TextEncoder().encode(context) });
    return new TextDecoder().decode(bytes);
  },
});
