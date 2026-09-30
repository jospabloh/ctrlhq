import React, { useState } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LogIn, Mail, Lock, Loader2 } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";
import GoogleIcon from "@/components/GoogleIcon";
import VerifyEmailStep from "@/components/VerifyEmailStep";
import { needsEmailVerification } from "@/lib/emailVerification";
import { safeReturnTo } from "@/lib/authReturnTo";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // Cuenta creada pero sin verificar: se abre el paso de código en vez de
  // mostrar el error crudo de la plataforma.
  const [verifying, setVerifying] = useState(false);
  // Post-login destination (e.g. the MCP OAuth consent page sends users here
  // with returnTo so the grant flow can resume). Same-origin paths only.
  const returnTo = safeReturnTo();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await base44.auth.loginViaEmailPassword(email.trim(), password);
      window.location.href = returnTo;
    } catch (err) {
      if (needsEmailVerification(err)) {
        // Reenviamos el código: el que recibió al registrarse puede haber vencido.
        try {
          await base44.auth.resendOtp(email.trim());
        } catch {
          /* el paso de código ofrece "Reenviar código" si falla */
        }
        setVerifying(true);
      } else {
        setError(err.message || "Correo o contraseña incorrectos");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = () => {
    base44.auth.loginWithProvider("google", returnTo);
  };

  if (verifying) {
    return (
      <AuthLayout
        icon={Mail}
        title="Verifica tu correo"
        subtitle={`Tu cuenta aún no está verificada. Escribe el código que enviamos a ${email.trim()}`}
      >
        <VerifyEmailStep
          email={email.trim()}
          password={password}
          onVerified={(r) => {
            if (r?.needsLogin) {
              setVerifying(false);
              setPassword("");
            } else {
              window.location.href = returnTo;
            }
          }}
          onCancel={() => {
            setVerifying(false);
            setPassword("");
          }}
        />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      icon={LogIn}
      title="Bienvenido a CtrlHQ"
      subtitle="Accede a tu cuenta para continuar"
      footer={
        <>
          ¿No tienes cuenta?{" "}
          <Link
            to={"/register" + (returnTo !== "/" ? "?returnTo=" + encodeURIComponent(returnTo) : "")}
            className="text-primary font-medium hover:underline"
          >
            Regístrate
          </Link>
        </>
      }
    >
      <Button
        variant="outline"
        className="w-full h-12 text-sm font-medium mb-6"
        onClick={handleGoogle}
      >
        <GoogleIcon className="w-5 h-5 mr-2" />
        Continuar con Google
      </Button>

      <div className="relative mb-6">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-card px-3 text-muted-foreground">o</span>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Correo electrónico</Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="email"
              type="email"
              autoComplete="email"
              autoFocus
              placeholder="tu@correo.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="pl-10 h-12"
              required
            />
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Contraseña</Label>
            <Link to="/forgot-password" className="text-xs text-primary hover:underline">
              ¿Olvidaste tu contraseña?
            </Link>
          </div>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="pl-10 h-12"
              required
            />
          </div>
        </div>
        <Button type="submit" className="w-full h-12 font-medium" disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Iniciando sesión...
            </>
          ) : (
            "Iniciar sesión"
          )}
        </Button>
      </form>

      {/* Module 10: no dead ends — a locked-out or prospective tenant always
          has somewhere to go from here. */}
      <p className="text-center text-xs text-muted-foreground mt-6">
        ¿Aún no tienes una cuenta de negocio?{" "}
        <a href="https://acaciaco.com.mx/apps/ctrlhq.html" className="text-primary hover:underline">
          Conoce CtrlHQ
        </a>
        {" · "}
        <a href="mailto:soporte@acaciaco.com.mx" className="text-primary hover:underline">
          ¿Problemas para entrar? Contacta soporte
        </a>
      </p>
    </AuthLayout>
  );
}
