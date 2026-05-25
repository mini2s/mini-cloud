import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";

interface ConfigState {
  cdnDomain: string;
  allowSignup: boolean;
  googleClientId: string;
  casdoorEndpoint: string;
  casdoorClientId: string;
  casdoorOrgName: string;
  casdoorAppName: string;
  setCdnDomain: (domain: string) => void;
  setAuthConfig: (config: {
    allowSignup: boolean;
    googleClientId?: string;
    casdoorEndpoint?: string;
    casdoorClientId?: string;
    casdoorOrgName?: string;
    casdoorAppName?: string;
  }) => void;
}

export const configStore = createStore<ConfigState>((set) => ({
  cdnDomain: "",
  allowSignup: true,
  googleClientId: "",
  casdoorEndpoint: "",
  casdoorClientId: "",
  casdoorOrgName: "",
  casdoorAppName: "",
  setCdnDomain: (domain) => set({ cdnDomain: domain }),
  setAuthConfig: ({
    allowSignup,
    googleClientId = "",
    casdoorEndpoint = "",
    casdoorClientId = "",
    casdoorOrgName = "",
    casdoorAppName = "",
  }) =>
    set({
      allowSignup,
      googleClientId,
      casdoorEndpoint,
      casdoorClientId,
      casdoorOrgName,
      casdoorAppName,
    }),
}));

export function useConfigStore(): ConfigState;
export function useConfigStore<T>(selector: (state: ConfigState) => T): T;
export function useConfigStore<T>(selector?: (state: ConfigState) => T) {
  return useStore(configStore, selector as (state: ConfigState) => T);
}
