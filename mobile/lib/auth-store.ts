import { create } from 'zustand';
import type { MeUser } from '@/lib/api-types';

type AuthState = {
  accessToken: string | null;
  user: MeUser | null;
  ready: boolean;
  setAccessToken: (token: string | null) => void;
  setUser: (user: MeUser | null) => void;
  setReady: (ready: boolean) => void;
  clear: () => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  ready: false,
  setAccessToken: (accessToken) => set({ accessToken }),
  setUser: (user) => set({ user }),
  setReady: (ready) => set({ ready }),
  clear: () => set({ accessToken: null, user: null }),
}));
