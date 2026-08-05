/**
 * E5: single-user product — constant auth context.
 */
import { createContext, useContext, type ReactNode } from 'react'

export type AuthUser = { id: string; name: string }

const DEFAULT_USER: AuthUser = { id: 'system', name: 'local' }

type AuthState = {
  user: AuthUser
  isAuthenticated: boolean
}

const AuthContext = createContext<AuthState>({
  user: DEFAULT_USER,
  isAuthenticated: true,
})

export function AuthProvider({ children }: { children: ReactNode }) {
  return (
    <AuthContext.Provider value={{ user: DEFAULT_USER, isAuthenticated: true }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  return useContext(AuthContext)
}

export default AuthContext
