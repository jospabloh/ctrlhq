// Helpers for the email-verification (OTP) step shared by Login and Register.
// Kept apart from the component so react-refresh stays happy and so the
// message rules can be unit-tested with `npm test`.

// Base44 answers a login for an unverified account with an English message
// ("Please verify your email" / "...verification code..."). Sin este paso el
// usuario veia ese texto crudo y no habia donde escribir el codigo.
export const needsEmailVerification = (error) =>
  /verify your email|verification code|email (is )?not verified/i.test(error?.message || "");

const isRateLimited = (error) =>
  error?.status === 429 || /too many|rate limit/i.test(error?.message || "");

// Spanish message for a failed verifyOtp. The platform's own text is English
// and generic, so map by cause instead of echoing it.
export const otpVerifyErrorMessage = (error) => {
  if (isRateLimited(error)) return "Demasiados intentos. Espera un momento y vuelve a intentarlo.";
  if (error?.status >= 500) return "No pudimos verificar el código. Intenta de nuevo en unos minutos.";
  return "Código inválido o vencido. Revísalo o pide uno nuevo.";
};

export const otpResendErrorMessage = (error) => {
  if (isRateLimited(error)) return "Ya te enviamos un código hace poco. Espera un momento antes de pedir otro.";
  return "No se pudo reenviar el código. Intenta de nuevo.";
};
