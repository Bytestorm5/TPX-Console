import { SignUp } from "@clerk/react-router";
import type { Route } from "./+types/sign-up";
import { AuthPanel, FixtureAuthCard } from "../shell/components/AuthPanel.tsx";
import { cloudflareContext } from "../shell/context.ts";
import { isFixtureMode } from "../shell/env.ts";

export const meta: Route.MetaFunction = () => [{ title: "Create your account · Trusplex Console" }];

export function loader({ context }: Route.LoaderArgs) {
  return { fixture: isFixtureMode(context.get(cloudflareContext).env) };
}

export default function SignUpPage({ loaderData }: Route.ComponentProps) {
  return (
    <AuthPanel>
      {loaderData.fixture ? (
        <FixtureAuthCard title="Create your account" />
      ) : (
        <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" fallbackRedirectUrl="/" />
      )}
    </AuthPanel>
  );
}
