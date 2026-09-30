import test from "node:test";
import assert from "node:assert/strict";
import { needsEmailVerification, otpVerifyErrorMessage, otpResendErrorMessage } from "./emailVerification.js";

test("needsEmailVerification recognises the platform's unverified-account messages", () => {
  assert.equal(needsEmailVerification({ message: "Please verify your email before logging in" }), true);
  assert.equal(needsEmailVerification({ message: "Enter the verification code we sent" }), true);
  assert.equal(needsEmailVerification({ message: "Email not verified" }), true);
});

test("needsEmailVerification leaves other login errors alone", () => {
  assert.equal(needsEmailVerification({ message: "Invalid credentials" }), false);
  assert.equal(needsEmailVerification({}), false);
  assert.equal(needsEmailVerification(null), false);
});

test("otp errors are Spanish, never the raw platform text, and never contain em dashes", () => {
  const msgs = [
    otpVerifyErrorMessage({ message: "Invalid OTP" }),
    otpVerifyErrorMessage({ status: 429 }),
    otpVerifyErrorMessage({ status: 503 }),
    otpResendErrorMessage({ message: "boom" }),
    otpResendErrorMessage({ status: 429 }),
  ];
  for (const m of msgs) {
    assert.doesNotMatch(m, /OTP|invalid otp|boom/i);
    assert.doesNotMatch(m, /—/);
  }
  assert.match(otpVerifyErrorMessage({ status: 429 }), /Demasiados/);
});
