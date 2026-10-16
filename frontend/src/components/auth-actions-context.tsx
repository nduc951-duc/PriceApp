"use client";

import { createContext, useContext } from "react";

export const AuthLogoutContext = createContext<(() => Promise<void>) | null>(null);

export function useAuthLogout() {
  return useContext(AuthLogoutContext);
}
