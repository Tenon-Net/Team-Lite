import React, { createContext, useContext, type ReactNode } from 'react'
type LayoutState = { isMobile: boolean; siderCollapsed?: boolean }
const LayoutContext = createContext<LayoutState>({ isMobile: false })
export function LayoutProvider({ children }: { children: ReactNode }) {
  return <LayoutContext.Provider value={{ isMobile: false }}>{children}</LayoutContext.Provider>
}
export function useLayoutContext() {
  return useContext(LayoutContext)
}
export default LayoutContext
