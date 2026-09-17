import { ClerkProvider } from "@clerk/react-router";
import { rootAuthLoader } from "@clerk/react-router/server";
import { fontFamily, radius, themes } from "@tpx/tokens";
import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import type { Route } from "./+types/root";
import "./app.css";
import { cloudflareContext } from "./shell/context.ts";
import { isFixtureMode } from "./shell/env.ts";
import { identityMiddleware } from "./shell/identity.server.ts";
import { readThemeCookie } from "./shell/session.server.ts";

export const middleware: Route.MiddlewareFunction[] = [identityMiddleware];

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
];

export const meta: Route.MetaFunction = () => [{ title: "Trusplex Console" }, { name: "robots", content: "noindex" }];

export async function loader(args: Route.LoaderArgs) {
  const { env } = args.context.get(cloudflareContext);
  const theme = readThemeCookie(args.request);
  if (isFixtureMode(env)) return { mode: "fixture" as const, theme };
  return rootAuthLoader(args, () => ({ mode: "clerk" as const, theme }));
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

const clerkAppearance = {
  variables: {
    colorPrimary: themes.light.accent,
    colorBackground: themes.light.surface,
    colorText: themes.light.ink,
    colorTextSecondary: themes.light.inkMuted,
    colorInputBackground: themes.light.surface,
    colorInputText: themes.light.ink,
    colorDanger: themes.light.danger,
    borderRadius: radius.sm,
    fontFamily: fontFamily.sans,
  },
  elements: {
    card: "shadow-none border border-border-subtle",
    formButtonPrimary: "font-semibold",
  },
};

export default function App({ loaderData }: Route.ComponentProps) {
  const theme = (loaderData as { theme: "light" | "dark" | null }).theme;
  // The theme attribute is applied before paint so there is no flash.
  const themeScript = theme ? `document.documentElement.dataset.theme=${JSON.stringify(theme)};` : "";
  const content = (
    <>
      {themeScript ? <script dangerouslySetInnerHTML={{ __html: themeScript }} /> : null}
      <Outlet />
    </>
  );
  if ((loaderData as { mode: string }).mode === "fixture") return content;
  return (
    <ClerkProvider loaderData={loaderData} appearance={clerkAppearance} signInUrl="/sign-in" signUpUrl="/sign-up">
      {content}
    </ClerkProvider>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Something went wrong";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;
  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "Not found" : `Error ${error.status}`;
    const body = error.data as { error?: string } | string | undefined;
    details = typeof body === "string" ? body : (body?.error ?? error.statusText ?? details);
  } else if (import.meta.env.DEV && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }
  return (
    <main className="mx-auto max-w-2xl px-6 py-24">
      <h1 className="text-3xl font-bold tracking-tight text-ink">{message}</h1>
      <p className="mt-3 text-ink-muted">{details}</p>
      {stack ? (
        <pre className="mt-6 overflow-x-auto rounded-md bg-surface-raised p-4 text-xs text-ink">
          <code>{stack}</code>
        </pre>
      ) : null}
      <a href="/" className="mt-8 inline-block text-accent underline-offset-4 hover:underline">
        Back to the console
      </a>
    </main>
  );
}
