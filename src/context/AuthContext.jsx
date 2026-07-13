import { createContext, useContext, useState, useEffect } from 'react';

export const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState({ authenticated: false, role: null, loading: true });

  useEffect(() => {
    const verifyToken = async () => {
      try {
        const response = await fetch('/api/auth/verify', {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
          }
        });

        if (response.ok) {
          const data = await response.json();
          setAuth({ authenticated: true, role: data.role, loading: false });
        } else {
          setAuth({ authenticated: false, role: null, loading: false });
          localStorage.removeItem('auth_token');
        }
      } catch (error) {
        console.error('Auth verification failed:', error);
        setAuth({ authenticated: false, role: null, loading: false });
      }
    };

    verifyToken();
  }, []);

  const login = async (token) => {
    localStorage.setItem('auth_token', token);
    const response = await fetch('/api/auth/verify', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    setAuth({ authenticated: response.ok, role: data.role, loading: false });
    return response.ok;
  };

  const logout = () => {
    localStorage.removeItem('auth_token');
    setAuth({ authenticated: false, role: null, loading: false });
  };

  return (
    <AuthContext.Provider value={{ ...auth, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
