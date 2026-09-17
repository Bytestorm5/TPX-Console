/**
 * The provider registry: what the marketplace lists, what a connection can be
 * created from, and the small set of live calls each provider supports.
 * Providers are code, reviewed like code; a new one is a pull request.
 */
import type { ProviderDescriptor } from "@tpx/contracts/connections";
import { probe, type ProviderImpl } from "./types.ts";

const cloudflare: ProviderImpl = {
  descriptor: {
    id: "cloudflare",
    name: "Cloudflare",
    description: "DNS zones and CDN configuration through the Cloudflare API.",
    capabilities: ["dns", "cdn"],
    credentialFields: [
      {
        key: "api_token",
        label: "API token",
        secret: true,
        required: true,
        help: "A scoped token; never a global API key.",
      },
    ],
    configFields: [
      { key: "account_id", label: "Account ID", secret: false, required: true },
      {
        key: "zone_id",
        label: "Zone ID",
        secret: false,
        required: false,
        help: "Optional; per-environment zones go on the environment default.",
      },
    ],
    docsUrl: "https://developers.cloudflare.com/fundamentals/api/get-started/create-token/",
    icon: "cloud",
    testable: true,
  },
  test: ({ credential, fetch }) =>
    probe(
      fetch,
      "https://api.cloudflare.com/client/v4/user/tokens/verify",
      { headers: { authorization: `Bearer ${credential.api_token ?? ""}` } },
      "Token verified",
    ),
};

const github: ProviderImpl = {
  descriptor: {
    id: "github",
    name: "GitHub",
    description: "Repositories, issues and pull requests through the GitHub API.",
    capabilities: ["scm", "tickets"],
    credentialFields: [{ key: "token", label: "Personal access token", secret: true, required: true }],
    configFields: [
      { key: "owner", label: "Owner", secret: false, required: true },
      { key: "repository", label: "Repository", secret: false, required: false },
    ],
    docsUrl: "https://docs.github.com/en/authentication",
    icon: "github",
    testable: true,
  },
  test: ({ credential, fetch }) =>
    probe(
      fetch,
      "https://api.github.com/user",
      { headers: { authorization: `Bearer ${credential.token ?? ""}`, "user-agent": "trusplex-console" } },
      "Token accepted",
    ),
};

const awsS3: ProviderImpl = {
  descriptor: {
    id: "aws-s3",
    name: "Amazon S3",
    description: "Object storage buckets on AWS.",
    capabilities: ["storage"],
    credentialFields: [
      { key: "access_key_id", label: "Access key ID", secret: false, required: true },
      { key: "secret_access_key", label: "Secret access key", secret: true, required: true },
    ],
    configFields: [
      { key: "region", label: "Region", secret: false, required: true, placeholder: "eu-central-1" },
      { key: "bucket", label: "Bucket", secret: false, required: true },
    ],
    docsUrl: "https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html",
    icon: "database",
    testable: false,
  },
};

const linear: ProviderImpl = {
  descriptor: {
    id: "linear",
    name: "Linear",
    description: "Issues and projects through the Linear GraphQL API.",
    capabilities: ["tickets"],
    credentialFields: [{ key: "api_key", label: "API key", secret: true, required: true }],
    configFields: [{ key: "team_key", label: "Team key", secret: false, required: false, placeholder: "ENG" }],
    docsUrl: "https://developers.linear.app/docs/graphql/working-with-the-graphql-api",
    icon: "kanban",
    testable: true,
  },
  test: ({ credential, fetch }) =>
    probe(
      fetch,
      "https://api.linear.app/graphql",
      {
        method: "POST",
        headers: { authorization: credential.api_key ?? "", "content-type": "application/json" },
        body: JSON.stringify({ query: "{ viewer { id } }" }),
      },
      "API key accepted",
    ),
};

const resend: ProviderImpl = {
  descriptor: {
    id: "resend",
    name: "Resend",
    description: "Transactional email.",
    capabilities: ["email"],
    credentialFields: [{ key: "api_key", label: "API key", secret: true, required: true }],
    configFields: [
      { key: "from_address", label: "From address", secret: false, required: true, placeholder: "noreply@example.com" },
    ],
    docsUrl: "https://resend.com/docs/api-reference/api-keys",
    icon: "mail",
    testable: true,
  },
  test: ({ credential, fetch }) =>
    probe(
      fetch,
      "https://api.resend.com/domains",
      { headers: { authorization: `Bearer ${credential.api_key ?? ""}` } },
      "API key accepted",
    ),
};

const openai: ProviderImpl = {
  descriptor: {
    id: "openai",
    name: "OpenAI",
    description: "Language models through the OpenAI API.",
    capabilities: ["llm"],
    credentialFields: [{ key: "api_key", label: "API key", secret: true, required: true }],
    configFields: [{ key: "model", label: "Default model", secret: false, required: false }],
    docsUrl: "https://platform.openai.com/docs/api-reference/authentication",
    icon: "sparkles",
    testable: true,
  },
  test: ({ credential, fetch }) =>
    probe(
      fetch,
      "https://api.openai.com/v1/models",
      { headers: { authorization: `Bearer ${credential.api_key ?? ""}` } },
      "API key accepted",
    ),
};

const anthropic: ProviderImpl = {
  descriptor: {
    id: "anthropic",
    name: "Anthropic",
    description: "Claude models through the Anthropic API.",
    capabilities: ["llm"],
    credentialFields: [{ key: "api_key", label: "API key", secret: true, required: true }],
    configFields: [{ key: "model", label: "Default model", secret: false, required: false }],
    docsUrl: "https://docs.claude.com/en/api/overview",
    icon: "sparkles",
    testable: true,
  },
  test: ({ credential, fetch }) =>
    probe(
      fetch,
      "https://api.anthropic.com/v1/models",
      { headers: { "x-api-key": credential.api_key ?? "", "anthropic-version": "2023-06-01" } },
      "API key accepted",
    ),
};

const webhook: ProviderImpl = {
  descriptor: {
    id: "webhook",
    name: "Webhook",
    description: "Deliver signed events to any HTTPS endpoint.",
    capabilities: ["webhook"],
    credentialFields: [{ key: "signing_secret", label: "Signing secret", secret: true, required: true }],
    configFields: [
      {
        key: "url",
        label: "Endpoint URL",
        secret: false,
        required: true,
        placeholder: "https://example.com/hooks/trusplex",
      },
    ],
    icon: "webhook",
    testable: false,
  },
};

const REGISTRY: readonly ProviderImpl[] = [cloudflare, github, awsS3, linear, resend, openai, anthropic, webhook];

export function listProviders(): ProviderDescriptor[] {
  return REGISTRY.map((p) => p.descriptor);
}

export function getProvider(id: string): ProviderImpl | null {
  return REGISTRY.find((p) => p.descriptor.id === id) ?? null;
}
