import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { toast } from "@/components/ui/use-toast";
import { Loader2 } from "lucide-react";
import { otpVerifyErrorMessage, otpResendErrorMessage } from "@/lib/emailVerification";

// Paso de código de verificación (OTP), compartido por Register y Login.
// Register lo abre tras crear la cuenta; Login lo abre cuando el servidor
// rechaza el acceso porque el correo aún no está verificado.
//
// Tras verificar intenta entrar solo: usa el token de verifyOtp si lo trae y,
// si no, inicia sesión con la contraseña que el usuario ya escribió. Si eso
// falla avisa con onVerified({ needsLogin: true }) para mandarlo a /login.
export default function VerifyEmailStep({ email, password, onVerified, onCancel }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState("");

  const handleVerify = async () => {
    if (busy || code.length < 6) return;
    setError("");
    setBusy(true);
    let result;
    try {
      result = await base44.auth.verifyOtp({ email, otpCode: code });
    } catch (err) {
      setError(otpVerifyErrorMessage(err));
      setBusy(false);
      return;
    }
    try {
      if (result?.access_token) {
        base44.auth.setToken(result.access_token);
      } else {
        await base44.auth.loginViaEmailPassword(email, password);
      }
      toast({ title: "Correo verificado" });
      onVerified();
    } catch {
      toast({ title: "Correo verificado", description: "Inicia sesión para continuar." });
      onVerified({ needsLogin: true });
    } finally {
      setBusy(false);
    }
  };

  const handleResend = async () => {
    setError("");
    setResending(true);
    try {
      await base44.auth.resendOtp(email);
      toast({ title: "Código enviado", description: "Revisa tu correo para ver el nuevo código." });
    } catch (err) {
      setError(otpResendErrorMessage(err));
    } finally {
      setResending(false);
    }
  };

  return (
    <div>
      {error && (
        <div role="alert" className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
          {error}
        </div>
      )}
      <div className="flex justify-center mb-6">
        <InputOTP maxLength={6} value={code} onChange={setCode} autoFocus autoComplete="one-time-code">
          <InputOTPGroup>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <InputOTPSlot key={i} index={i} />
            ))}
          </InputOTPGroup>
        </InputOTP>
      </div>
      <Button className="w-full h-12 font-medium" onClick={handleVerify} disabled={busy || code.length < 6}>
        {busy ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Verificando...
          </>
        ) : (
          "Verificar"
        )}
      </Button>
      <div className="flex justify-between text-sm mt-4">
        <button type="button" onClick={handleResend} disabled={resending} className="text-primary font-medium hover:underline disabled:opacity-60">
          {resending ? "Enviando..." : "Reenviar código"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="text-muted-foreground hover:text-foreground">
            Usar otro correo
          </button>
        )}
      </div>
    </div>
  );
}
