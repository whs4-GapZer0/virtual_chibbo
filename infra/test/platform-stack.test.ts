import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { ChibboApplicationStack, ChibboBootstrapStack, ChibboFoundationStack, ChibboMigratorStack, ChibboProwlerScannerStack, ChibboRegistryStack, prowlerControlRunnerGzipBase64, prowlerS3RunnerGzipBase64, trivyRunnerGzipBase64 } from "../lib/platform-stack.js";

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
    expect(json).toContain("ProwlerScannerRole");
    expect(json).toContain("ChibboProwlerReadOnlyRole");
    expect(json).toContain("s3:GetBucketPublicAccessBlock");
    expect(json).toContain("s3:ListAllMyBuckets");
    expect(json).toContain("ReadOnlyTvmEc2AndRdsInventory");
    expect(json).toContain("ec2:DescribeImages");
    expect(json).toContain("rds:DescribeDBInstances");
    expect(json).toContain("ReadOnlyInfE01TlsConfiguration");
    expect(json).toContain("elasticloadbalancing:DescribeListeners");
    expect(json).toContain("elasticloadbalancing:DescribeSSLPolicies");
    expect(json).toContain("cloudfront:GetDistributionConfig");
    expect(json).toContain("gapzero-ec2-runtime");
    expect(json).toContain("s3:GetEncryptionConfiguration");
    expect(json).toContain("ReadOnlyChibboTrivySourceReport");
    expect(json).toContain("exports/trivy/chibbo/latest.json");
    expect(json).toContain("ReadOnlyChibboPlatformImageForTrivy");
    expect(json).toContain("ecr:GetAuthorizationToken");
    expect(json).toContain("DiscoverOnlyTheActiveChibboPlatformServiceForTrivy");
    expect(json).toContain("ecs:DescribeTaskDefinition");
    expect(json).toContain("chibbo-platform-test");
  });

  it("separates scheduled Prowler and Trivy collection from the application and exposes no ingress", () => {
    const { app, foundation } = foundations();
    const stack = new ChibboProwlerScannerStack(app, "ChibboProwlerScannerTest", { env: { account: "992764023398", region: "ap-northeast-2" }, environmentName: "test", foundation });
    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::EC2::Instance", 1);
    template.resourceCountIs("AWS::EC2::SecurityGroupIngress", 0);
    const json = JSON.stringify(template.toJSON());
    expect(json).toContain("chibbo-test-prowler-scanner");
    expect(json).toContain("HttpTokens");
    expect(json).toContain("required");
    expect(json).toContain("HttpPutResponseHopLimit");
    expect(json).toContain("gapzero-evidence-992764023398-ap-northeast-2");
    expect(json).toContain("exports/prowler/chibbo/");
    expect(json).toContain("exports/trivy/chibbo/latest.json");
    expect(json).toContain("ChibboProwlerReadOnlyRole");
    expect(json).toContain("Environment=\\\"CHIBBO_PROWLER_RESOURCE_ARNS=");
    const gunzip = (value: string): string => gunzipSync(Buffer.from(value, "base64")).toString("utf8");
    for (const runner of [prowlerS3RunnerGzipBase64, prowlerControlRunnerGzipBase64, trivyRunnerGzipBase64]) {
      expect(json).toContain(runner);
      expect(gunzip(runner)).toContain("--log-driver none");
    }
    expect(gunzip(prowlerS3RunnerGzipBase64)).toContain("s3_bucket_secure_transport_policy");
    expect(gunzip(prowlerControlRunnerGzipBase64)).toContain("CHIBBO_PROWLER_CHECKS");
    expect(json).toContain("chibbo-run-prowler-control");
    // TVM-C-01 keeps its unit, schedule and object names.
    expect(json).toContain("chibbo-prowler-tvm.timer");
    expect(json).toContain("OnCalendar=*-*-* 18:45:00 UTC");
    expect(json).toContain("CHIBBO_PROWLER_CONTROL=tvm-c-01");
    expect(json).toContain("Environment=\\\"CHIBBO_PROWLER_CHECKS=ec2_instance_older_than_specific_days ec2_instance_with_outdated_ami rds_instance_no_public_access\\\"");
    // INF-E-01 runs daily after TVM-C-01 and once on a new scanner.
    expect(json).toContain("chibbo-prowler-inf-e-01.timer");
    expect(json).toContain("OnCalendar=*-*-* 19:00:00 UTC");
    expect(json).toContain("CHIBBO_PROWLER_CONTROL=inf-e-01");
    expect(json).toContain("Environment=\\\"CHIBBO_PROWLER_CHECKS=elbv2_ssl_listeners elbv2_insecure_ssl_ciphers cloudfront_distributions_https_enabled\\\"");
    expect(json).toContain("systemctl start --no-block chibbo-prowler-inf-e-01.service");
    expect(json).toContain("chibbo-run-trivy-platform");
    expect(json).toContain("chibbo-trivy-platform.timer");
    expect(json).toContain("public.ecr.aws/aquasecurity/trivy@sha256:af6acf9a6b85dfe389a1941505c0ce9efef52a4719635e1a962f022a3d855daa");
    const instance = Object.values(template.toJSON().Resources as Record<string, { Type: string; Properties: { UserData: { "Fn::Base64": { "Fn::Join": [string, unknown[]] } } } }>).find((resource) => resource.Type === "AWS::EC2::Instance")!;
    // EC2 rejects user data over 16 KiB; role ARN tokens resolve to < 100 bytes.
    const userData = instance.Properties.UserData["Fn::Base64"]["Fn::Join"][1].map((part) => (typeof part === "string" ? part : "x".repeat(100))).join("");
    expect(Buffer.byteLength(userData)).toBeLessThan(16 * 1024);
    // Every unit the script writes is also made world-readable.
    for (const unit of userData.matchAll(/cat > (\/etc\/systemd\/system\/\S+) <</g)) {
      expect(userData).toMatch(new RegExp(`chmod 644 .*${unit[1].replaceAll(".", "\\.")}( |\n)`));
    }
    execFileSync("bash", ["-n"], { input: userData });
  });

  it("makes a bootstrap-only GitHub role and CloudFormation execution role", () => {
    const app = new cdk.App({ defaultStackSynthesizer: new cdk.LegacyStackSynthesizer() });
    const stack = new ChibboBootstrapStack(app, "ChibboBootstrapTest", { env: { account: "992764023398", region: "ap-northeast-2" }, environmentName: "test", githubOidcProviderArn: "arn:aws:iam::992764023398:oidc-provider/token.actions.githubusercontent.com", githubOwnerId: "331039235", githubRepositoryId: "1398534215" });
    const json = JSON.stringify(Template.fromStack(stack).toJSON());
    expect(json).toContain("repo:whs4-GapZer0@331039235/virtual_chibbo@1398534215:environment:chibbo-test");
    expect(json).toContain("token.actions.githubusercontent.com:sub");
    expect(json).toContain("CloudFormationExecutionRole");
    expect(json).toContain("DeploymentAssetsBucket");
    expect(json).toContain("cloudformation/*");
    expect(json).toContain("cloudformation:GetTemplateSummary");
    expect(json).toContain("iam:PassRole");
    expect(json).toContain("iam:CreateInstanceProfile");
    expect(json).toContain("iam:AddRoleToInstanceProfile");
    expect(json).toContain("ssm:GetParameters");
    expect(json).toContain("ami-amazon-linux-latest/al2023-ami-kernel-6.1-x86_64");
    expect(json).toContain("ChibboFoundationTest-ConfigRecorderRole");
    expect(json).toContain("config.amazonaws.com");
    expect(json).toContain("secretsmanager:DescribeSecret");
    expect(json).toContain("chibbo/test/entra-*");
    expect(json).toContain("acm:DescribeCertificate");
    expect(json).toContain("budgets:ViewBudget");
    expect(json).toContain("ecs:RunTask");
    expect(json).toContain("ChibboMigratorTestMigrationTask");
    expect(json).toContain("ecs-tasks.amazonaws.com");
    expect(json).toContain("ecr:BatchGetImage");
    expect(json).not.toContain("AdministratorAccess");
  });

  it("signs release images with a non-exportable KMS key into a separate signature repository", () => {
    const { registry } = foundations();
    const template = Template.fromStack(registry);
    template.hasResourceProperties("AWS::KMS::Key", { KeySpec: "ECC_NIST_P256", KeyUsage: "SIGN_VERIFY" });
    template.hasResourceProperties("AWS::KMS::Alias", { AliasName: "alias/chibbo/test/image-signing" });
    template.hasResourceProperties("AWS::ECR::Repository", { RepositoryName: "chibbo-platform-test", ImageTagMutability: "IMMUTABLE" });
    template.hasResourceProperties("AWS::ECR::Repository", { RepositoryName: "chibbo-platform-test-signatures", ImageTagMutability: "MUTABLE" });
    const app = new cdk.App({ defaultStackSynthesizer: new cdk.LegacyStackSynthesizer() });
    const bootstrap = new ChibboBootstrapStack(app, "ChibboBootstrapTest", { env: { account: "992764023398", region: "ap-northeast-2" }, environmentName: "test", githubOidcProviderArn: "arn:aws:iam::992764023398:oidc-provider/token.actions.githubusercontent.com", githubOwnerId: "331039235", githubRepositoryId: "1398534215" });
    const json = JSON.stringify(Template.fromStack(bootstrap).toJSON());
    expect(json).toContain("kms:Sign");
    expect(json).toContain("kms:ResourceAliases");
    expect(json).toContain("alias/chibbo/test/image-signing");
    expect(json).toContain("chibbo-platform-test-signatures");
    expect(json).toContain("ecr:GetDownloadUrlForLayer");
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

    // Foundation is updated before the application stack in the release
    // workflow. Its synthesized template must therefore retain every
    // cross-stack export consumed by the application template.
    const foundationJson = JSON.stringify(Template.fromStack(foundation).toJSON());
    expect(foundationJson).toContain("Export");
    expect(foundationJson).toContain("AppSecurityGroup");
  });
});
