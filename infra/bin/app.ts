import "source-map-support/register.js";
import * as cdk from "aws-cdk-lib";
import { ChibboApplicationStack, ChibboBootstrapStack, ChibboFoundationStack, ChibboMigratorStack, ChibboRegistryStack } from "../lib/platform-stack.js";

// CDK's CliCredentialsStackSynthesizer still requires the account-wide
// hnb659fds bootstrap asset bucket.  This project deliberately does not use
// that shared bootstrap surface; it builds and pushes its own application
// image to ChibboRegistryDev.  The legacy synthesizer keeps templates inline
// and uses the caller's credentials, which is sufficient because the stacks
// have no CDK-managed file or Docker assets.
const app = new cdk.App({ defaultStackSynthesizer: new cdk.LegacyStackSynthesizer() });
const environmentName = app.node.tryGetContext("environment") ?? "dev";
const env = { account: process.env.CDK_DEFAULT_ACCOUNT ?? "992764023398", region: process.env.CDK_DEFAULT_REGION ?? "ap-northeast-2" };
new ChibboBootstrapStack(app, `ChibboBootstrap${capitalize(environmentName)}`, {
  env, environmentName,
  githubOidcProviderArn: `arn:aws:iam::${env.account}:oidc-provider/token.actions.githubusercontent.com`,
  githubOwnerId: "331039235", githubRepositoryId: "1398534215"
});
const registry = new ChibboRegistryStack(app, `ChibboRegistry${capitalize(environmentName)}`, { env, environmentName });
const foundation = new ChibboFoundationStack(app, `ChibboFoundation${capitalize(environmentName)}`, { env, environmentName, appOrigin: app.node.tryGetContext("appOrigin") });

const releaseMigrator = app.node.tryGetContext("releaseMigrator") === "true";
const releaseApplication = app.node.tryGetContext("releaseApplication") === "true";
if (releaseMigrator || releaseApplication) {
  const imageDigest = required(app, "imageDigest");
  const runtimeConfigSecretName = required(app, "runtimeConfigSecretName");
  const migratorDbSecretName = required(app, "migratorDbSecretName");
  const appDbSecretName = required(app, "appDbSecretName");
  const common = { env, environmentName, foundation, repository: registry.repository, imageDigest, runtimeConfigSecretName, migratorDbSecretName, appDbSecretName };
  if (releaseMigrator) new ChibboMigratorStack(app, `ChibboMigrator${capitalize(environmentName)}`, common);
  if (releaseApplication) new ChibboApplicationStack(app, `ChibboApplication${capitalize(environmentName)}`, {
      ...common,
      appOrigin: required(app, "appOrigin"), certificateArn: required(app, "certificateArn"),
      entraClientSecretName: required(app, "entraClientSecretName"), entraTenantId: required(app, "entraTenantId"), entraClientId: required(app, "entraClientId"), entraIssuer: required(app, "entraIssuer")
    });
}

function required(app: cdk.App, key: string): string {
  const value = app.node.tryGetContext(key);
  if (typeof value !== "string" || value.trim() === "" || value.includes("REQUIRED")) throw new Error(`-c ${key}=... is required when -c release=true`);
  return value;
}
function capitalize(value: string): string { return value.charAt(0).toUpperCase() + value.slice(1); }
