import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";
import { productRoutes } from "./registry.routes.ts";

export default [
  route("sign-in/*", "routes/sign-in.tsx"),
  route("sign-up/*", "routes/sign-up.tsx"),
  route("onboarding", "routes/onboarding.tsx"),
  route("webhooks/clerk", "routes/webhooks.clerk.tsx"),
  route("api/:product/*", "routes/api.tsx"),
  route("healthz", "routes/healthz.tsx"),
  index("routes/home.tsx"),
  layout("routes/org.tsx", [
    route("org", "routes/org/index.tsx"),
    route("org/projects", "routes/org/projects.tsx"),
    route("org/environments", "routes/org/environments.tsx"),
    route("org/members", "routes/org/members.tsx"),
    route("org/access", "routes/org/access.tsx"),
    route("org/audit", "routes/org/audit.tsx"),
  ]),
  route(":project", "routes/project.tsx"),
  route(":project/:environment", "routes/scope.tsx", [index("routes/overview.tsx"), ...productRoutes]),
] satisfies RouteConfig;
