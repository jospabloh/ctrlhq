import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import { PermissionProvider } from '@/lib/PermissionContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ProtectedRoute from '@/components/ProtectedRoute';
import ScrollToTop from './components/ScrollToTop';
// Add page imports here
import Layout from '@/components/Layout';
import Dashboard from '@/pages/Dashboard';
import Ingresos from '@/pages/Ingresos';
import Egresos from '@/pages/Egresos';
import Nomina from '@/pages/Nomina';
import ConsumosEquipo from '@/pages/ConsumosEquipo';
import Configuracion from '@/pages/Configuracion';
import Cuenta from '@/pages/Cuenta';
import Soporte from '@/pages/Soporte';
import Permisos from '@/pages/Permisos';
import Onboarding from '@/pages/Onboarding';
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import ForgotPassword from '@/pages/ForgotPassword';
import ResetPassword from '@/pages/ResetPassword';

const AuthenticatedApp = () => {
  const { user, isLoadingAuth, isLoadingPublicSettings, authError } = useAuth();

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  // "Not authenticated" is no longer handled here by redirecting to Base44's
  // hosted login — ProtectedRoute below sends unauthenticated visitors to the
  // in-app, Spanish /login page instead (Module 10). Only the distinct
  // "logged in but not provisioned for this app" case is special-cased here.
  if (authError?.type === 'user_not_registered') {
    return <UserNotRegisteredError />;
  }

  // Module 2: every user needs a tenant (business_id) before touching any
  // business_id-scoped entity — RLS would reject every read/write otherwise.
  // Applies to EVERY role, including the platform admin: role: admin exists
  // to satisfy each entity's RLS service-role branch (exercised server-side
  // by Mission Control), not to let a human skip setting up a business.
  if (user && !user.business_id) {
    return <Onboarding />;
  }

  return (
    <Routes>
      {/* Public custom-auth pages (Module 10) */}
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      {/* Authenticated area — everything below requires a signed-in user */}
      <Route element={<ProtectedRoute />}>
        <Route element={
          <PermissionProvider>
            <Layout />
          </PermissionProvider>
        }>
          <Route path="/" element={<Dashboard />} />
          <Route path="/ingresos" element={<Ingresos />} />
          <Route path="/egresos" element={<Egresos />} />
          <Route path="/nomina" element={<Nomina />} />
          <Route path="/consumos-equipo" element={<ConsumosEquipo />} />
          <Route path="/configuracion" element={<Configuracion />} />
          <Route path="/cuenta" element={<Cuenta />} />
          <Route path="/soporte" element={<Soporte />} />
          <Route path="/permisos" element={<Permisos />} />
        </Route>
      </Route>
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};


function App() {

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <ScrollToTop />
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App