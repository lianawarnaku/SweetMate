import { Redirect } from "expo-router";

// PasswordRecoveryBoundary handles the link before ordinary household/auth
// navigation mounts. Once finished/cancelled, discard this navigation entry.
export default function ResetPasswordRoute() {
  return <Redirect href="/" />;
}
