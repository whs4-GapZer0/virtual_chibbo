import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { ChibboApplicationStack, ChibboBootstrapStack, ChibboFoundationStack, ChibboMigratorStack, ChibboRegistryStack } from "../lib/platform-stack.js";

function foundations(): { app: cdk.App; foundation: ChibboFoundationStack; registry: ChibboRegistryStack } {
  const app = new cdk.App({ defaultStackSynthesizer: new cdk.LegacyStackSynthesizer() });
  const env = { account: "992764023398", region: "ap-northeast-2" };
  const registry = new ChibboRegistryStack(app, "ChibboRegistryTest", { env, environmentName: "test" });
  const foundation = new ChibboFoundationStack(app, "ChibboFoundationTest", { env, environmentName: "test" });
  return { app, foundation, registry };
}

describe("Chibbo staged infrastructure", () => {
  it("uses an asset-free synthesizer and isolates the foundation network/data plane", () => {
    const { foundation } = foundations();
    const template = Template.fromStack(foundation);
    template.resourceCountIs("AWS::EC2::FlowLog", 1);
    template.resourceCountIs("AWS::ECS::Service", 0);
    template.hasResourceProperties("AWS::RDS::DBInstance", { DBName: "chibbo", DBInstanceClass: "db.t4g.micro", StorageEncrypted: true, PubliclyAccessible: false });
    const json = JSON.stringify(template.toJSON());
    expect(json).toContain("10.84.0.0/16");
    expect(json).toContain("chibbo_db_admin");
    expect(json).toContain("AWS::S3::Object");
    expect(json).toContain("ConfigHistoryBucket");
    expect(json).toContain("ConfigRecorderRole");
    expect(json).toContain("GapZeroReadOnlyRole");
    expect(json).toContain("gapzero-ec2-runtime");
    expect(json).toContain("s3:GetEncryptionConfiguration");
    expect(json).toContain("rds.force_ssl");
  });

  it("makes a bootstrap-only GitHub role and CloudFormation execution role", () => {
    const app = new cdk.App({ defaultStackSynthesizer: new cdk.LegacyStackSynthesizer() });
    const stack = new ChibboBootstrapStack(app, "ChibboBootstrapTest", { env: { account: "992764023398", region: "ap-northeast-2" }, environmentName: "test", githubOidcProviderArn: "arn:aws:iam::992764023398:oidc-provider/token.actions.githubusercontent.com", githubOwnerId: "331039235", githubRepositoryId: "1398534215" });
    const json = JSON.stringify(Template.fromStack(stack).toJSON());
    expect(json).toContain("repository_owner_id");
    expect(json).toContain("repository_id");
    expect(json).toContain("environment:chibbo-test");
    expect(json).toContain("CloudFormationExecutionRole");
    expect(json).toContain("DeploymentAssetsBucket");
    expect(json).toContain("cloudformation/*");
    expect(json).toContain("iam:PassRole");
    expect(json).not.toContain("AdministratorAccess");
  });

  it("pins the migration task to a digest and supplies only migration credentials", () => {
    const { app, foundation, registry } = foundations();
    const stack = new ChibboMigratorStack(app, "ChibboMigratorTest", { env: { account: "992764023398", region: "ap-northeast-2" }, environmentName: "test", foundation, repository: registry.repository, imageDigest: "sha256:0123456789abcdef", runtimeConfigSecretName: "chibbo/test/runtime", migratorDbSecretName: "chibbo/test/migrator", appDbSecretName: "chibbo/test/app" });
    const json = JSON.stringify(Template.fromStack(stack).toJSON());
    expect(json).toContain("@sha256:0123456789abcdef");
    expect(json).toContain("CHIBBO_DB_ADMIN_HOST");
    expect(json).toContain("CHIBBO_MIGRATOR_DB_PASSWORD");
    expect(json).toContain("CHIBBO_APP_DB_PASSWORD");
    expect(json).toContain("AmazonECSTaskExecutionRolePolicy");
    expect(json).toContain("secretsmanager:GetSecretValue");
    expect(json).toContain("ARM64");
    expect(json).not.toContain("AWS::ECS::Service");
  });

  it("creates the desired ECS service only in the application stack and uses the health endpoint", () => {
    const { app, foundation, registry } = foundations();
    const stack = new ChibboApplicationStack(app, "ChibboApplicationTest", { env: { account: "992764023398", region: "ap-northeast-2" }, environmentName: "test", foundation, repository: registry.repository, imageDigest: "sha256:0123456789abcdef", runtimeConfigSecretName: "chibbo/test/runtime", migratorDbSecretName: "chibbo/test/migrator", appDbSecretName: "chibbo/test/app", appOrigin: "https://careers.example.test", certificateArn: "arn:aws:acm:ap-northeast-2:992764023398:certificate/example", entraClientSecretName: "chibbo/test/entra", entraTenantId: "tenant", entraClientId: "client", entraIssuer: "https://login.microsoftonline.com/tenant/v2.0" });
    const json = JSON.stringify(Template.fromStack(stack).toJSON());
    expect(json).toContain("AWS::ECS::Service");
    expect(json).toContain("/api/health");
    expect(json).toContain("PGHOST");
    expect(json).toContain("CHIBBO_DELETION_PEPPER");
    expect(json).toContain("ENTRA_CLIENT_SECRET");
    expect(json).toContain("secretsmanager:GetSecretValue");
    expect(json).toContain("ARM64");
    expect(json).toContain("quarantine/*");
    expect(json).toContain("accepted/*");
  });
});
