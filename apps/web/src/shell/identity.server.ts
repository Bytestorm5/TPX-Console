/**
 * Ingress identity. tpx-web is the only place a session is validated: Clerk
 * verifies the session, this module turns it into a `SessionIdentity` — who
 * the user is, never which tenant they are in. Tenancy is tpx-auth's.
 *
 * In development with TPX_DEV_FIXTURE=1 a fixture identity stands in for
 * Clerk so the whole console runs without keys; the branch is guarded by
 * `import.meta.env.DEV` and does not exist in production builds.
 */
import { clerkClient, clerkMiddleware, getAuth } from "@clerk/react-router/server";
import type { LoaderFunctionArgs, MiddlewareFunction } from "react-router";
import { redirect } from "react-router";
import type { ProfileInput } from "@tpx/contracts/auth";
import type { SessionIdentity } from "@tpx/identity";
import { cloudflareContext, identityContext, type SignedInIdentity } from "./context.ts";
import { isFixtureMode, type WebEnv } from "./env.ts";

export const FIXTURE_IDENTITY: SignedInIdentity = {
  userId: "user_fixture",
  displayName: "Ada Fixture",
  email: "ada@example.test",
  imageUrl: null,
};

export function clerkOptions(env: WebEnv) {
  return {
    ...(env.CLERK_SECRET_KEY ? { secretKey: env.CLERK_SECRET_KEY } : {}),
    ...(env.CLERK_PUBLISHABLE_KEY ? { publishableKey: env.CLERK_PUBLISHABLE_KEY } : {}),
    signInUrl: "/sign-in",
    signUpUrl: "/sign-up",
    signInFallbackRedirectUrl: "/",
    signUpFallbackRedirectUrl: "/",
  };
}

export const identityMiddleware: MiddlewareFunction<Response> = async (args, next) => {
  const { env } = args.context.get(cloudflareContext);
  if (isFixtureMode(env)) {
    args.context.set(identityContext, FIXTURE_IDENTITY);
    return next();
  }
  return clerkMiddleware(clerkOptions(env))(args, next);
};

export async function getIdentity(
  args: Pick<LoaderFunctionArgs, "request" | "context" | "params">,
): Promise<SessionIdentity> {
  const { env } = args.context.get(cloudflareContext);
  if (isFixtureMode(env)) return args.context.get(identityContext) ?? FIXTURE_IDENTITY;
  const auth = await getAuth(args as LoaderFunctionArgs);
  return { userId: auth.userId ?? "", displayName: null, email: null, imageUrl: null };
}

/** Redirects to sign-in (remembering where the user was going) when there is no session. */
export async function requireSignedIn(
  args: Pick<LoaderFunctionArgs, "request" | "context" | "params">,
): Promise<SignedInIdentity> {
  const identity = await getIdentity(args);
  if (!identity.userId) {
    const url = new URL(args.request.url);
    const back = url.pathname + url.search;
    throw redirect(`/sign-in?redirect_url=${encodeURIComponent(back)}`);
  }
  return identity as SignedInIdentity;
}

/** The profile from the identity provider — fetched only when tpx-auth's copy is missing or stale. */
export async function fetchProfile(
  args: Pick<LoaderFunctionArgs, "request" | "context" | "params">,
  identity: SignedInIdentity,
): Promise<ProfileInput> {
  const { env } = args.context.get(cloudflareContext);
  if (isFixtureMode(env)) {
    return { email: identity.email, displayName: identity.displayName, imageUrl: identity.imageUrl };
  }
  const user = await clerkClient(args as LoaderFunctionArgs).users.getUser(identity.userId);
  return {
    email: user.primaryEmailAddress?.emailAddress ?? null,
    displayName: user.fullName ?? user.firstName ?? user.username ?? null,
    imageUrl: user.imageUrl ?? null,
  };
}
