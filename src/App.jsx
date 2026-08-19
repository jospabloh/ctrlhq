import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import { PermissionProvider } from '@/lib/PermissionContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
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
import Onboarding from '@/pages/Onboarding';

const AuthenticatedApp = () => {
  const { user, isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Handle authentication errors
  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      // Redirect to login automatically
      navigateToLogin();
      return null;
    }
  }

  // Module 2: every user needs a tenant (business_id) before touching any
  // business_id-scoped entity — RLS would reject every read/write otherwise.
  // The platform admin (role: admin) has no business_id and doesn't need one.
  if (user && user.role !== 'admin' && !user.business_id) {
    return <Onboarding />;
  }

  // Render the main app
  return (
    <PermissionProvider>
      <Routes>
        {/* Add your page Route elements here */}
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/ingresos" element={<Ingresos />} />
          <Route path="/egresos" element={<Egresos />} />
          <Route path="/nomina" element={<Nomina />} />
          <Route path="/consumos-equipo" element={<ConsumosEquipo />} />
          <Route path="/configuracion" element={<Configuracion />} />
          <Route path="/cuenta" element={<Cuenta />} />
          <Route path="/soporte" element={<Soporte />} />
        </Route>
        <Route path="*" element={<PageNotFound />} />
      </Routes>
    </PermissionProvider>
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