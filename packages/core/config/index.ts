import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";

interface ConfigState {
  cdnDomain: string;
  serverUrl: string;
  allowSignup: boolean;
  googleClientId: string;
  casdoorEnabled: boolean;
  casdoorLoginUrl: string;
  daemonServerUrl: string;
  daemonAppUrl: string;
  // Self-host gate (#3433): when true, every "Create workspace" affordance
  // must be hidden. Defaults to false so unknown / older servers behave like
  // the managed-cloud case.
  workspaceCreationDisabled: boolean;
  setCdnDomain: (domain: string) => void;
  setServerUrl: (url: string) => void;
  setAuthConfig: (config: {
    allowSignup: boolean;
    googleClientId?: string;
    casdoorEnabled?: boolean;
    casdoorLoginUrl?: string;
    workspaceCreationDisabled?: boolean;
  }) => void;
  setDaemonConfig: (config: {
    daemonServerUrl?: string;
    daemonAppUrl?: string;
  }) => void;
}

export const configStore = createStore<ConfigState>((set) => ({
  cdnDomain: "",
  serverUrl: "",
  allowSignup: true,
  googleClientId: "",
  casdoorEnabled: false,
  casdoorLoginUrl: "",
  daemonServerUrl: "",
  daemonAppUrl: "",
  workspaceCreationDisabled: false,
  setCdnDomain: (domain) => set({ cdnDomain: domain }),
  setServerUrl: (url) => set({ serverUrl: url }),
  setAuthConfig: ({ allowSignup, googleClientId = "", casdoorEnabled = false, casdoorLoginUrl = "", workspaceCreationDisabled = false }) =>
    set({ allowSignup, googleClientId, casdoorEnabled, casdoorLoginUrl, workspaceCreationDisabled }),
  setDaemonConfig: ({ daemonServerUrl = "", daemonAppUrl = "" }) =>
    set({ daemonServerUrl, daemonAppUrl }),
}));

export function useConfigStore(): ConfigState;
export function useConfigStore<T>(selector: (state: ConfigState) => T): T;
export function useConfigStore<T>(selector?: (state: ConfigState) => T) {
  return useStore(configStore, selector as (state: ConfigState) => T);
}
