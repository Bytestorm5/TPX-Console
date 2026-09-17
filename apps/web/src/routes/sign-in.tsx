import { SignIn } from "@clerk/react-router";
import type { Route } from "./+types/sign-in";
import { AuthPanel, FixtureAuthCard } from "../shell/components/AuthPanel.tsx";
import { cloudflareContext } from "../shell/context.ts";
import { isFixtureMode } from "../shell/env.ts";

export const meta: Route.MetaFunction = () => [{ title: "Sign in · Trusplex Console" }];

export function loader({ context }: Route.LoaderArgs) {
  return { fixture: isFixtureMode(context.get(cloudflareContext).env) };
}

export default function SignInPage({ loaderData }: Route.ComponentProps) {
  return (
    <AuthPanel>
      {loaderData.fixture ? (
        <FixtureAuthCard title="Sign in" />
      ) : (
        <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" fallbackRedirectUrl="/" />
      )}
    </AuthPanel>
  );
}
