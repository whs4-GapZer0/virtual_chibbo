import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as accessanalyzer from "aws-cdk-lib/aws-accessanalyzer";
import * as cloudtrail from "aws-cdk-lib/aws-cloudtrail";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
import * as logs from "aws-cdk-lib/aws-logs";
import * as rds from "aws-cdk-lib/aws-rds";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps, Tags } from "aws-cdk-lib";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { Construct } from "constructs";

const TAGS = { Project: "virtual-chibbo", Owner: "ChibboCompany", DataClass: "synthetic", CostCenter: "Chibbo" } as const;
const tag = (scope: Construct, environmentName: string): void => Object.entries({ ...TAGS, Environment: environmentName }).forEach(([key, value]) => Tags.of(scope).add(key, value));
// EC2 caps user data at 16 KiB.  Every scanner runner is embedded
// gzip+base64 so the runners and their systemd units stay below that limit.
const gzipBase64Script = (name: string): string => gzipSync(readFileSync(fileURLToPath(new URL(`../scripts/${name}`, import.meta.url))), { level: 9 }).toString("base64");
export const prowlerS3RunnerGzipBase64 = gzipBase64Script("run-prowler-chibbo-s3.sh");
export const prowlerControlRunnerGzipBase64 = gzipBase64Script("run-prowler-chibbo-control.sh");
export const trivyRunnerGzipBase64 = gzipBase64Script("run-trivy-chibbo-platform.sh");
// Prowler 5.44 check IDs run by the shared control runner.  GapZer0 reads
// these exact IDs from exports/prowler/chibbo/ for each control.
export const PROWLER_CONTROL_CHECKS = {
  "tvm-c-01": ["ec2_instance_older_than_specific_days", "ec2_instance_with_outdated_ami", "rds_instance_no_public_access"],
  "inf-e-01": ["elbv2_ssl_listeners", "elbv2_insecure_ssl_ciphers", "cloudfront_distributions_https_enabled"],
} as const;

export interface ChibboBootstrapStackProps extends StackProps { environmentName: string; githubOidcProviderArn: string; githubOwnerId: string; githubRepositoryId: string; }
/** Deploy once with a human operator's existing AWS credentials, before GitHub can deploy anything. */
export class ChibboBootstrapStack extends Stack {
  public readonly githubDeployRole: iam.Role;
  public readonly cloudFormationExecutionRole: iam.Role;
  public readonly deploymentAssetsBucket: s3.Bucket;
  constructor(scope: Construct, id: string, props: ChibboBootstrapStackProps) {
    super(scope, id, props); tag(this, props.environmentName);
    const provider = iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(this, "GithubOidcProvider", props.githubOidcProviderArn);
    this.deploymentAssetsBucket = new s3.Bucket(this, "DeploymentAssetsBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      lifecycleRules: [{ noncurrentVersionExpiration: Duration.days(30) }],
      removalPolicy: RemovalPolicy.RETAIN,
    });
    this.cloudFormationExecutionRole = new iam.Role(this, "CloudFormationExecutionRole", { roleName: `chibbo-${props.environmentName}-cloudformation-execution`, assumedBy: new iam.ServicePrincipal("cloudformation.amazonaws.com") });
    // This role is assumable only by CloudFormation and passed only by the
    // repository/environment-bound GitHub role below. It deliberately excludes
    // account administration, billing, Organizations, Identity Center and all
    // secret-read permissions; the services listed are the Chibbo CDK surface.
    this.cloudFormationExecutionRole.addToPolicy(new iam.PolicyStatement({
      sid: "ProvisionChibboInfrastructure",
      actions: [
        "acm:DescribeCertificate",
        "access-analyzer:*",
        "cloudtrail:*",
        "ec2:*",
        "ecr:*",
        "ecs:*",
        "elasticloadbalancing:*",
        "kms:CreateAlias", "kms:CreateKey", "kms:DescribeKey", "kms:DisableKey", "kms:EnableKeyRotation", "kms:GetKeyPolicy", "kms:ListResourceTags", "kms:PutKeyPolicy", "kms:ScheduleKeyDeletion", "kms:TagResource", "kms:UntagResource",
        "logs:*",
        "rds:*",
        "s3:*",
        "secretsmanager:CreateSecret", "secretsmanager:DeleteSecret", "secretsmanager:DescribeSecret", "secretsmanager:GetResourcePolicy", "secretsmanager:ListSecretVersionIds", "secretsmanager:PutResourcePolicy", "secretsmanager:RestoreSecret", "secretsmanager:RotateSecret", "secretsmanager:TagResource", "secretsmanager:UntagResource", "secretsmanager:UpdateSecret",
        "iam:AddRoleToInstanceProfile", "iam:AttachRolePolicy", "iam:CreateInstanceProfile", "iam:CreateRole", "iam:DeleteInstanceProfile", "iam:DeleteRole", "iam:DeleteRolePolicy", "iam:DetachRolePolicy", "iam:GetInstanceProfile", "iam:GetRole", "iam:GetRolePolicy", "iam:PassRole", "iam:PutRolePolicy", "iam:RemoveRoleFromInstanceProfile", "iam:TagRole", "iam:UntagRole"
      ],
      resources: ["*"]
    }));
    // The isolated scanner uses the public AL2023 SSM image parameter. This
    // is an accountless AWS-owned parameter, not a Chibbo secret or arbitrary
    // Parameter Store read permission.
    this.cloudFormationExecutionRole.addToPolicy(new iam.PolicyStatement({
      sid: "ResolveApprovedScannerAmi",
      actions: ["ssm:GetParameters"],
      resources: [`arn:${this.partition}:ssm:${this.region}::parameter/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-6.1-x86_64`],
    }));
    // GitHub repositories created after 2026-07-15 use immutable OIDC
    // subject claims. AWS does not evaluate GitHub custom claims, so pin the
    // standard `sub` claim itself to this owner/repository ID pair and the
    // protected deployment environment.
    const githubDeploymentSubject = `repo:whs4-GapZer0@${props.githubOwnerId}/virtual_chibbo@${props.githubRepositoryId}:environment:chibbo-${props.environmentName}`;
    this.githubDeployRole = new iam.Role(this, "GithubDeployRole", {
      roleName: `chibbo-${props.environmentName}-github-deploy`,
      assumedBy: new iam.FederatedPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": githubDeploymentSubject,
        },
      }, "sts:AssumeRoleWithWebIdentity")
    });
    this.githubDeployRole.addToPolicy(new iam.PolicyStatement({ actions: ["cloudformation:CreateChangeSet", "cloudformation:DeleteChangeSet", "cloudformation:DescribeChangeSet", "cloudformation:DescribeStacks", "cloudformation:DescribeStackEvents", "cloudformation:ExecuteChangeSet", "cloudformation:GetTemplateSummary"], resources: [this.formatArn({ service: "cloudformation", resource: "stack", resourceName: "Chibbo*/*" })] }));
    this.githubDeployRole.addToPolicy(new iam.PolicyStatement({ actions: ["iam:PassRole"], resources: [this.cloudFormationExecutionRole.roleArn], conditions: { StringEquals: { "iam:PassedToService": "cloudformation.amazonaws.com" } } }));
    // AWS Config's recorder is configured after the Foundation stack exists.
    // CDK gives that service role a physical suffix, so constrain PassRole to
    // this stack's generated recorder role and the Config service only.
    const foundationStackName = `ChibboFoundation${props.environmentName.charAt(0).toUpperCase()}${props.environmentName.slice(1)}`;
    this.githubDeployRole.addToPolicy(new iam.PolicyStatement({
      actions: ["iam:PassRole"],
      resources: [`arn:${this.partition}:iam::${this.account}:role/${foundationStackName}-ConfigRecorderRole*`],
      conditions: { StringEquals: { "iam:PassedToService": "config.amazonaws.com" } },
    }));
    this.githubDeployRole.addToPolicy(new iam.PolicyStatement({ actions: ["ecr:GetAuthorizationToken"], resources: ["*"] }));
    this.githubDeployRole.addToPolicy(new iam.PolicyStatement({ actions: ["ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:CompleteLayerUpload", "ecr:DescribeImages", "ecr:GetDownloadUrlForLayer", "ecr:InitiateLayerUpload", "ecr:PutImage", "ecr:UploadLayerPart"], resources: [this.formatArn({ service: "ecr", resource: "repository", resourceName: `chibbo-platform-${props.environmentName}` })] }));
    // Release signing: push cosign signatures/SBOM attestations to the
    // signature repository and sign only with the image-signing key alias.
    this.githubDeployRole.addToPolicy(new iam.PolicyStatement({ sid: "PushImageSignatures", actions: ["ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:CompleteLayerUpload", "ecr:DescribeImages", "ecr:GetDownloadUrlForLayer", "ecr:InitiateLayerUpload", "ecr:ListImages", "ecr:PutImage", "ecr:UploadLayerPart"], resources: [this.formatArn({ service: "ecr", resource: "repository", resourceName: `chibbo-platform-${props.environmentName}-signatures` })] }));
    this.githubDeployRole.addToPolicy(new iam.PolicyStatement({
      sid: "SignAndVerifyReleaseImages",
      actions: ["kms:DescribeKey", "kms:GetPublicKey", "kms:Sign"],
      resources: [this.formatArn({ service: "kms", resource: "key", resourceName: "*" })],
      // The calls name the key by this alias; kms:RequestAlias applies at once,
      // unlike kms:ResourceAliases, which lags a new alias by minutes.
      conditions: { StringEquals: { "kms:RequestAlias": `alias/chibbo/${props.environmentName}/image-signing` } },
    }));
    this.githubDeployRole.addToPolicy(new iam.PolicyStatement({ actions: ["s3:GetBucketLocation", "s3:ListBucket"], resources: [this.deploymentAssetsBucket.bucketArn] }));
    this.githubDeployRole.addToPolicy(new iam.PolicyStatement({ actions: ["s3:GetObject", "s3:PutObject"], resources: [this.deploymentAssetsBucket.arnForObjects("cloudformation/*")] }));
    this.githubDeployRole.addToPolicy(new iam.PolicyStatement({ actions: ["config:Describe*", "config:PutConfigRule", "config:PutConfigurationRecorder", "config:PutDeliveryChannel", "config:StartConfigurationRecorder"], resources: ["*"] }));
    // The release gate verifies only that its required secrets exist.  It
    // never receives secret values, so retain DescribeSecret rather than a
    // value-read action and scope it to the four Chibbo deployment secrets.
    const chibboReleaseSecrets = ["runtime", "db-migrator", "db-app", "entra"].map((name) =>
      `arn:${this.partition}:secretsmanager:${this.region}:${this.account}:secret:chibbo/${props.environmentName}/${name}-*`
    );
    this.githubDeployRole.addToPolicy(new iam.PolicyStatement({ actions: ["secretsmanager:DescribeSecret"], resources: chibboReleaseSecrets }));
    // The workflow accepts the issued ACM certificate ARN as a protected
    // deployment input.  It reads certificate metadata only; ACM does not
    // expose private-key material through DescribeCertificate.
    this.githubDeployRole.addToPolicy(new iam.PolicyStatement({ actions: ["acm:DescribeCertificate"], resources: [`arn:${this.partition}:acm:${this.region}:${this.account}:certificate/*`] }));
    this.githubDeployRole.addToPolicy(new iam.PolicyStatement({ actions: ["budgets:ViewBudget"], resources: [`arn:${this.partition}:budgets::${this.account}:budget/Chibbo-${props.environmentName}`] }));
    // The initial expand migration runs as a one-off Fargate task after a
    // protected change record is supplied.  Limit task execution and task
    // inspection to the generated Chibbo migrator definition and Foundation
    // cluster; it cannot launch an arbitrary workload.
    const ecsArn = `arn:${this.partition}:ecs:${this.region}:${this.account}`;
    const migrationTaskDefinition = `${ecsArn}:task-definition/ChibboMigrator${props.environmentName.charAt(0).toUpperCase()}${props.environmentName.slice(1)}MigrationTask*`;
    const foundationCluster = `${ecsArn}:cluster/${foundationStackName}-Cluster*`;
    this.githubDeployRole.addToPolicy(new iam.PolicyStatement({
      actions: ["ecs:RunTask"], resources: [migrationTaskDefinition],
      conditions: { ArnLike: { "ecs:cluster": foundationCluster } },
    }));
    this.githubDeployRole.addToPolicy(new iam.PolicyStatement({
      actions: ["ecs:DescribeTasks"], resources: [`${ecsArn}:task/${foundationStackName}-Cluster*/*`],
      conditions: { ArnLike: { "ecs:cluster": foundationCluster } },
    }));
    this.githubDeployRole.addToPolicy(new iam.PolicyStatement({
      actions: ["iam:PassRole"],
      resources: [
        `arn:${this.partition}:iam::${this.account}:role/ChibboMigrator${props.environmentName.charAt(0).toUpperCase()}${props.environmentName.slice(1)}-MigrationTaskRole*`,
        `arn:${this.partition}:iam::${this.account}:role/ChibboMigrator${props.environmentName.charAt(0).toUpperCase()}${props.environmentName.slice(1)}-MigrationTaskExecutionRole*`,
      ],
      conditions: { StringEquals: { "iam:PassedToService": "ecs-tasks.amazonaws.com" } },
    }));
    new CfnOutput(this, "GithubDeployRoleArn", { value: this.githubDeployRole.roleArn });
    new CfnOutput(this, "CloudFormationExecutionRoleArn", { value: this.cloudFormationExecutionRole.roleArn });
    new CfnOutput(this, "DeploymentAssetsBucketName", { value: this.deploymentAssetsBucket.bucketName });
  }
}

export interface ChibboRegistryStackProps extends StackProps { environmentName: string; }
export class ChibboRegistryStack extends Stack {
  public readonly repository: ecr.Repository;
  public readonly signatureRepository: ecr.Repository;
  public readonly imageSigningKey: kms.Key;
  constructor(scope: Construct, id: string, props: ChibboRegistryStackProps) {
    super(scope, id, props); tag(this, props.environmentName);
    this.repository = new ecr.Repository(this, "PlatformRepository", { repositoryName: `chibbo-platform-${props.environmentName}`, imageTagMutability: ecr.TagMutability.IMMUTABLE, imageScanOnPush: true, encryption: ecr.RepositoryEncryption.AES_256, lifecycleRules: [{ maxImageCount: 30 }], removalPolicy: RemovalPolicy.RETAIN });
    // The release signs each pushed digest and its image SBOM with this
    // non-exportable KMS key and verifies both before any task runs the
    // image (GRC TVM-E-03).  Signatures live in their own repository so the
    // immutable platform repository and its 30-image lifecycle hold images only.
    this.imageSigningKey = new kms.Key(this, "ImageSigningKey", {
      alias: `alias/chibbo/${props.environmentName}/image-signing`,
      description: "Signs Chibbo platform image digests and SBOM attestations (cosign).",
      keySpec: kms.KeySpec.ECC_NIST_P256,
      keyUsage: kms.KeyUsage.SIGN_VERIFY,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    this.signatureRepository = new ecr.Repository(this, "PlatformSignatureRepository", { repositoryName: `chibbo-platform-${props.environmentName}-signatures`, imageTagMutability: ecr.TagMutability.MUTABLE, encryption: ecr.RepositoryEncryption.AES_256, removalPolicy: RemovalPolicy.RETAIN });
    new CfnOutput(this, "PlatformRepositoryUri", { value: this.repository.repositoryUri });
    new CfnOutput(this, "PlatformSignatureRepositoryUri", { value: this.signatureRepository.repositoryUri });
    new CfnOutput(this, "ImageSigningKeyArn", { value: this.imageSigningKey.keyArn });
  }
}

export interface ChibboFoundationStackProps extends StackProps { environmentName: string; appOrigin?: string; }
export class ChibboFoundationStack extends Stack {
  public readonly vpc: ec2.Vpc;
  public readonly cluster: ecs.Cluster;
  public readonly appSecurityGroup: ec2.SecurityGroup;
  public readonly loadBalancerSecurityGroup: ec2.SecurityGroup;
  public readonly database: rds.DatabaseInstance;
  public readonly databaseSecret: secretsmanager.ISecret;
  public readonly resumeBucket: s3.Bucket;
  public readonly auditBucket: s3.Bucket;
  public readonly resumeKey: kms.Key;
  public readonly prowlerScannerRole: iam.Role;
  public readonly prowlerReadRole: iam.Role;
  public readonly appLogGroup: logs.LogGroup;
  public readonly runtimeSecret: secretsmanager.Secret;
  public readonly migratorDatabaseSecret: secretsmanager.Secret;
  public readonly applicationDatabaseSecret: secretsmanager.Secret;
  constructor(scope: Construct, id: string, props: ChibboFoundationStackProps) {
    super(scope, id, props); tag(this, props.environmentName);
    // Explicit zones keep CI synthesis offline; the selected zone names were
    // verified for this account and region before the initial deployment.
    this.vpc = new ec2.Vpc(this, "Vpc", { ipAddresses: ec2.IpAddresses.cidr("10.84.0.0/16"), availabilityZones: ["ap-northeast-2a", "ap-northeast-2c"], natGateways: 1, subnetConfiguration: [{ name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 }, { name: "app", subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 }, { name: "db", subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 }] });
    this.vpc.addGatewayEndpoint("S3GatewayEndpoint", { service: ec2.GatewayVpcEndpointAwsService.S3 });
    const auditKey = new kms.Key(this, "AuditKey", { enableKeyRotation: true, removalPolicy: RemovalPolicy.RETAIN, alias: `alias/chibbo/${props.environmentName}/audit` });
    this.auditBucket = new s3.Bucket(this, "AuditBucket", { blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, encryption: s3.BucketEncryption.KMS, encryptionKey: auditKey, enforceSSL: true, versioned: true, removalPolicy: RemovalPolicy.RETAIN });
    this.resumeKey = new kms.Key(this, "ResumeKey", { enableKeyRotation: true, removalPolicy: RemovalPolicy.RETAIN, alias: `alias/chibbo/${props.environmentName}/resume` });
    this.resumeBucket = new s3.Bucket(this, "ResumeBucket", { blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED, encryption: s3.BucketEncryption.KMS, encryptionKey: this.resumeKey, enforceSSL: true, versioned: true, cors: props.appOrigin ? [{ allowedOrigins: [props.appOrigin], allowedMethods: [s3.HttpMethods.POST], allowedHeaders: ["content-type", "x-amz-*"], maxAge: 300 }] : undefined, lifecycleRules: [{ prefix: "quarantine/", expiration: Duration.days(7) }], removalPolicy: RemovalPolicy.RETAIN });
    const flowLogGroup = new logs.LogGroup(this, "FlowLogs", { logGroupName: `/chibbo/${props.environmentName}/flow`, retention: logs.RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.RETAIN });
    new ec2.FlowLog(this, "VpcFlowLogs", { resourceType: ec2.FlowLogResourceType.fromVpc(this.vpc), destination: ec2.FlowLogDestination.toCloudWatchLogs(flowLogGroup) });
    this.appLogGroup = new logs.LogGroup(this, "AppLogs", { logGroupName: `/chibbo/${props.environmentName}/app`, retention: logs.RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.RETAIN });
    const auditLogGroup = new logs.LogGroup(this, "AuditLogs", { logGroupName: `/chibbo/${props.environmentName}/audit`, retention: logs.RetentionDays.THREE_MONTHS, removalPolicy: RemovalPolicy.RETAIN });
    const trail = new cloudtrail.Trail(this, "ResumeDataTrail", { bucket: this.auditBucket, includeGlobalServiceEvents: false, isMultiRegionTrail: false, managementEvents: cloudtrail.ReadWriteType.NONE, sendToCloudWatchLogs: true, cloudWatchLogGroup: auditLogGroup });
    trail.addS3EventSelector([{ bucket: this.resumeBucket }], { readWriteType: cloudtrail.ReadWriteType.ALL });
    const configBucket = new s3.Bucket(this, "ConfigHistoryBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      lifecycleRules: [{ noncurrentVersionExpiration: Duration.days(30) }],
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const configRole = new iam.Role(this, "ConfigRecorderRole", { assumedBy: new iam.ServicePrincipal("config.amazonaws.com") });
    configRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWS_ConfigRole"));
    configBucket.addToResourcePolicy(new iam.PolicyStatement({
      sid: "AllowConfigToReadBucketAcl",
      principals: [new iam.ServicePrincipal("config.amazonaws.com")],
      actions: ["s3:GetBucketAcl"],
      resources: [configBucket.bucketArn],
      conditions: { StringEquals: { "AWS:SourceAccount": this.account } },
    }));
    configBucket.addToResourcePolicy(new iam.PolicyStatement({
      sid: "AllowConfigToDeliverHistory",
      principals: [new iam.ServicePrincipal("config.amazonaws.com")],
      actions: ["s3:PutObject"],
      // The delivery channel uses the explicit `config` prefix, so Config
      // writes under `config/AWSLogs/<account>/...`, not the bucket root.
      resources: [configBucket.arnForObjects(`config/AWSLogs/${this.account}/*`)],
      conditions: { StringEquals: { "s3:x-amz-acl": "bucket-owner-full-control", "AWS:SourceAccount": this.account } },
    }));
    new accessanalyzer.CfnAnalyzer(this, "ExternalAccessAnalyzer", {
      analyzerName: `chibbo-${props.environmentName}-external-access`, type: "ACCOUNT",
      tags: Object.entries({ ...TAGS, Environment: props.environmentName }).map(([key, value]) => ({ key, value })),
    });
    const targetReadRole = new iam.Role(this, "GapZeroReadOnlyRole", {
      roleName: "GapZeroReadOnlyRole",
      assumedBy: new iam.ArnPrincipal(`arn:${this.partition}:iam::${this.account}:role/gapzero-ec2-runtime`).withConditions({ StringEquals: { "sts:ExternalId": "gapzero-chibbo-readonly-v1" } }),
    });
    targetReadRole.addToPolicy(new iam.PolicyStatement({
      sid: "ReadOnlyChibboPosture",
      actions: [
        "access-analyzer:Get*", "access-analyzer:List*", "cloudtrail:Describe*", "cloudtrail:Get*", "cloudtrail:LookupEvents",
        "config:Describe*", "config:Get*", "config:List*", "config:SelectResourceConfig",
        "ec2:Describe*", "ecr:Describe*", "ecs:Describe*", "ecs:List*",
        "iam:GenerateCredentialReport", "iam:GetCredentialReport", "iam:Get*", "iam:List*",
        "logs:Describe*", "logs:FilterLogEvents", "logs:GetLogEvents", "logs:GetQueryResults", "logs:StartQuery", "logs:StopQuery",
        // The S3 GetBucketEncryption API is authorized as
        // s3:GetEncryptionConfiguration, not as a GetBucket* action.
        // Keep this explicit so GapZer0 can evaluate encryption without
        // granting object reads or KMS decrypt permission.
        "rds:Describe*", "s3:GetBucket*", "s3:GetEncryptionConfiguration", "s3:ListAllMyBuckets", "tag:GetResources",
      ],
      resources: ["*"],
    }));
    targetReadRole.addToPolicy(new iam.PolicyStatement({
      sid: "ReadOnlyChibboTrivySourceReport",
      actions: ["s3:GetObject"],
      resources: [`arn:${this.partition}:s3:::gapzero-evidence-${this.account}-${this.region}/exports/trivy/chibbo/latest.json`],
    }));
    // The scheduled scanner is intentionally not a second GapZer0 web role.
    // It may assume this separate target role solely for the two Chibbo S3
    // buckets required by INF-C-01.  No application, database, GitHub or
    // Entra secret is available to this instance.
    this.prowlerScannerRole = new iam.Role(this, "ProwlerScannerRole", {
      roleName: `chibbo-${props.environmentName}-prowler-scanner`,
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      description: "Runs Chibbo's isolated scheduled Prowler source scan.",
    });
    this.prowlerScannerRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"));
    this.prowlerScannerRole.addToPolicy(new iam.PolicyStatement({
      sid: "AssumeOnlyChibboProwlerReadRole",
      actions: ["sts:AssumeRole"],
      resources: [`arn:${this.partition}:iam::${this.account}:role/ChibboProwlerReadOnlyRole`],
    }));
    this.prowlerScannerRole.addToPolicy(new iam.PolicyStatement({
      sid: "WriteOnlyProwlerSourceArtifacts",
      actions: ["s3:PutObject"],
      resources: [`arn:${this.partition}:s3:::gapzero-evidence-${this.account}-${this.region}/exports/prowler/chibbo/*`],
    }));
    this.prowlerScannerRole.addToPolicy(new iam.PolicyStatement({
      sid: "ReadOnlyChibboPlatformImageForTrivy",
      actions: ["ecr:GetAuthorizationToken"],
      resources: ["*"],
    }));
    this.prowlerScannerRole.addToPolicy(new iam.PolicyStatement({
      sid: "ReadOnlyChibboPlatformImageLayersForTrivy",
      actions: ["ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"],
      resources: [`arn:${this.partition}:ecr:${this.region}:${this.account}:repository/chibbo-platform-${props.environmentName}`],
    }));
    this.prowlerScannerRole.addToPolicy(new iam.PolicyStatement({
      sid: "DiscoverOnlyTheActiveChibboPlatformServiceForTrivy",
      actions: ["tag:GetResources", "ecs:DescribeServices", "ecs:DescribeTaskDefinition"],
      resources: ["*"],
    }));
    this.prowlerScannerRole.addToPolicy(new iam.PolicyStatement({
      sid: "WriteOnlyTrivySourceArtifacts",
      actions: ["s3:PutObject"],
      resources: [`arn:${this.partition}:s3:::gapzero-evidence-${this.account}-${this.region}/exports/trivy/chibbo/*`],
    }));
    this.prowlerReadRole = new iam.Role(this, "ChibboProwlerReadOnlyRole", {
      roleName: "ChibboProwlerReadOnlyRole",
      assumedBy: new iam.ArnPrincipal(this.prowlerScannerRole.roleArn).withConditions({ StringEquals: { "sts:ExternalId": "gapzero-chibbo-prowler-v1" } }),
      description: "Allows the Chibbo Scanner to inspect the two S3 posture targets, EC2/RDS inventory for TVM-C-01 and ELBv2/CloudFront TLS for INF-E-01.",
    });
    this.prowlerReadRole.addToPolicy(new iam.PolicyStatement({
      // Prowler's S3 provider first lists names to find the explicit
      // resource-ARN filters. It receives no bucket configuration or object
      // contents from that step; every subsequent configuration read remains
      // constrained to Chibbo's two S3 targets below.
      sid: "EnumerateBucketNamesForExplicitTargets",
      actions: ["s3:ListAllMyBuckets"],
      resources: ["*"],
    }));
    this.prowlerReadRole.addToPolicy(new iam.PolicyStatement({
      sid: "ReadOnlySelectedS3Posture",
      actions: [
        "s3:GetBucketAcl", "s3:GetBucketLocation", "s3:GetBucketLogging", "s3:GetBucketNotification",
        "s3:GetBucketOwnershipControls", "s3:GetBucketPolicy", "s3:GetBucketPolicyStatus", "s3:GetBucketPublicAccessBlock",
        "s3:GetBucketTagging", "s3:GetBucketVersioning", "s3:GetEncryptionConfiguration", "s3:GetLifecycleConfiguration",
        "s3:GetObjectLockConfiguration", "s3:GetReplicationConfiguration",
      ],
      resources: [this.resumeBucket.bucketArn, this.auditBucket.bucketArn],
    }));
    this.prowlerReadRole.addToPolicy(new iam.PolicyStatement({
      // TVM-C-01 Prowler checks (ec2_instance_older_than_specific_days,
      // ec2_instance_with_outdated_ami, rds_instance_no_public_access) only
      // need instance/AMI/DB metadata.  These Describe APIs do not support
      // resource-level scoping, so "*" is required; there is no data access.
      sid: "ReadOnlyTvmEc2AndRdsInventory",
      actions: ["ec2:DescribeInstances", "ec2:DescribeImages", "rds:DescribeDBInstances"],
      resources: ["*"],
    }));
    this.prowlerReadRole.addToPolicy(new iam.PolicyStatement({
      // INF-E-01 Prowler checks (elbv2_ssl_listeners, elbv2_insecure_ssl_ciphers,
      // cloudfront_distributions_https_enabled) read load balancer, listener
      // and distribution configuration only.  These Describe/List APIs do not
      // support resource-level scoping; none of them returns traffic or data.
      sid: "ReadOnlyInfE01TlsConfiguration",
      actions: [
        "elasticloadbalancing:DescribeLoadBalancers", "elasticloadbalancing:DescribeListeners",
        "elasticloadbalancing:DescribeLoadBalancerAttributes", "elasticloadbalancing:DescribeRules",
        "elasticloadbalancing:DescribeTags", "elasticloadbalancing:DescribeSSLPolicies",
        "cloudfront:ListDistributions", "cloudfront:GetDistributionConfig", "cloudfront:ListTagsForResource",
      ],
      resources: ["*"],
    }));
    const dbSg = new ec2.SecurityGroup(this, "DatabaseSecurityGroup", { vpc: this.vpc, allowAllOutbound: false });
    this.appSecurityGroup = new ec2.SecurityGroup(this, "AppSecurityGroup", { vpc: this.vpc, allowAllOutbound: false });
    this.loadBalancerSecurityGroup = new ec2.SecurityGroup(this, "LoadBalancerSecurityGroup", { vpc: this.vpc, allowAllOutbound: false });
    dbSg.addIngressRule(this.appSecurityGroup, ec2.Port.tcp(5432), "ECS tasks to RDS");
    this.appSecurityGroup.addEgressRule(dbSg, ec2.Port.tcp(5432), "RDS");
    this.appSecurityGroup.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "Entra and AWS APIs via NAT");
    this.loadBalancerSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "HTTPS only");
    this.loadBalancerSecurityGroup.addEgressRule(this.appSecurityGroup, ec2.Port.tcp(3000), "ALB to platform");
    this.appSecurityGroup.addIngressRule(this.loadBalancerSecurityGroup, ec2.Port.tcp(3000), "ALB to platform");
    // Use a version which the deployment region currently offers. CDK 2.177
    // predates this minor, so represent the supported PostgreSQL 16.15 engine
    // explicitly instead of pinning its removed 16.4 constant.
    this.database = new rds.DatabaseInstance(this, "Postgres", { vpc: this.vpc, vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED }, securityGroups: [dbSg], engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.of("16.15", "16") }), instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO), databaseName: "chibbo", credentials: rds.Credentials.fromGeneratedSecret("chibbo_db_admin"), allocatedStorage: 20, maxAllocatedStorage: 100, storageEncrypted: true, backupRetention: Duration.days(7), deletionProtection: true, publiclyAccessible: false, removalPolicy: RemovalPolicy.SNAPSHOT });
    this.databaseSecret = this.database.secret!;
    this.runtimeSecret = new secretsmanager.Secret(this, "RuntimeConfig", { secretName: `chibbo/${props.environmentName}/runtime`, generateSecretString: { secretStringTemplate: "{}", generateStringKey: "CHIBBO_DELETION_PEPPER", passwordLength: 48, excludePunctuation: true }, removalPolicy: RemovalPolicy.RETAIN });
    this.migratorDatabaseSecret = new secretsmanager.Secret(this, "MigratorDatabaseCredentials", { secretName: `chibbo/${props.environmentName}/db-migrator`, generateSecretString: { secretStringTemplate: JSON.stringify({ username: "chibbo_migrator" }), generateStringKey: "password", passwordLength: 40, excludePunctuation: true }, removalPolicy: RemovalPolicy.RETAIN });
    this.applicationDatabaseSecret = new secretsmanager.Secret(this, "ApplicationDatabaseCredentials", { secretName: `chibbo/${props.environmentName}/db-app`, generateSecretString: { secretStringTemplate: JSON.stringify({ username: "chibbo_app" }), generateStringKey: "password", passwordLength: 40, excludePunctuation: true }, removalPolicy: RemovalPolicy.RETAIN });
    this.cluster = new ecs.Cluster(this, "Cluster", { vpc: this.vpc, containerInsightsV2: ecs.ContainerInsights.ENABLED });
    new CfnOutput(this, "DatabaseEndpoint", { value: this.database.dbInstanceEndpointAddress });
    new CfnOutput(this, "ResumeBucketName", { value: this.resumeBucket.bucketName });
    new CfnOutput(this, "ClusterName", { value: this.cluster.clusterName });
    new CfnOutput(this, "AppSecurityGroupId", { value: this.appSecurityGroup.securityGroupId });
    new CfnOutput(this, "AppSubnetIds", { value: this.vpc.privateSubnets.map((subnet) => subnet.subnetId).join(",") });
    new CfnOutput(this, "RuntimeConfigSecretName", { value: this.runtimeSecret.secretName });
    new CfnOutput(this, "MigratorDatabaseSecretName", { value: this.migratorDatabaseSecret.secretName });
    new CfnOutput(this, "ApplicationDatabaseSecretName", { value: this.applicationDatabaseSecret.secretName });
    new CfnOutput(this, "CloudTrailScope", { value: "resume S3 object data events only; management events excluded" });
    new CfnOutput(this, "ConfigurationRecorderName", { value: `chibbo-${props.environmentName}-recorder` });
    new CfnOutput(this, "ConfigurationHistoryBucketName", { value: configBucket.bucketName });
    new CfnOutput(this, "ConfigurationRecorderRoleArn", { value: configRole.roleArn });
    new CfnOutput(this, "GapZeroReadOnlyRoleArn", { value: targetReadRole.roleArn });
    new CfnOutput(this, "ProwlerScannerRoleArn", { value: this.prowlerScannerRole.roleArn });
    new CfnOutput(this, "ChibboProwlerReadOnlyRoleArn", { value: this.prowlerReadRole.roleArn });
  }
}

export interface ChibboProwlerScannerStackProps extends StackProps { environmentName: string; foundation: ChibboFoundationStack; }
/**
 * A deliberately separate compute plane for long-running posture collection.
 * It has no inbound rules or public IPv4 address; it emits only source reports
 * to the limited GapZer0 exports prefix and is managed through SSM.
 */
export class ChibboProwlerScannerStack extends Stack {
  constructor(scope: Construct, id: string, props: ChibboProwlerScannerStackProps) {
    super(scope, id, props); tag(this, props.environmentName);
    const securityGroup = new ec2.SecurityGroup(this, "ProwlerScannerSecurityGroup", {
      vpc: props.foundation.vpc,
      allowAllOutbound: false,
      description: "No ingress; HTTPS egress only for the isolated Prowler scanner.",
    });
    securityGroup.addEgressRule(ec2.Peer.ipv4("10.84.0.2/32"), ec2.Port.udp(53), "VPC DNS resolver");
    securityGroup.addEgressRule(ec2.Peer.ipv4("10.84.0.2/32"), ec2.Port.tcp(53), "VPC DNS resolver");
    securityGroup.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "AWS APIs and image registry through the existing NAT");

    const userData = ec2.UserData.forLinux();
    const environmentLines = (entries: string[]): string => entries.map((entry) => `Environment=${entry}`).join("\n");
    const targetRoleEnvironment = [
      `AWS_REGION=${this.region}`,
      `EVIDENCE_BUCKET=gapzero-evidence-${this.account}-${this.region}`,
      `TARGET_ROLE_ARN=${props.foundation.prowlerReadRole.roleArn}`,
      "TARGET_ROLE_EXTERNAL_ID=gapzero-chibbo-prowler-v1",
      "PROWLER_IMAGE=prowlercloud/prowler:5.44.0",
    ];
    const runnerEnvironment = environmentLines([
      ...targetRoleEnvironment,
      `"CHIBBO_PROWLER_RESOURCE_ARNS=${props.foundation.resumeBucket.bucketArn} ${props.foundation.auditBucket.bucketArn}"`,
    ]);
    const trivyRunnerEnvironment = environmentLines([
      `AWS_REGION=${this.region}`,
      `EVIDENCE_BUCKET=gapzero-evidence-${this.account}-${this.region}`,
      `CHIBBO_ENVIRONMENT=${props.environmentName}`,
      `CHIBBO_PLATFORM_IMAGE_URI=${this.account}.dkr.ecr.${this.region}.amazonaws.com/chibbo-platform-${props.environmentName}`,
      "TRIVY_IMAGE=public.ecr.aws/aquasecurity/trivy@sha256:af6acf9a6b85dfe389a1941505c0ce9efef52a4719635e1a962f022a3d855daa",
    ]);
    const installRunner = (name: string, gzipBase64: string): string[] => [
      `base64 --decode <<'CHIBBO_RUNNER' | gzip --decompress > /usr/local/libexec/${name}\n${gzipBase64}\nCHIBBO_RUNNER`,
      `chmod 750 /usr/local/libexec/${name}`,
    ];
    const unit = (path: string, body: string): string => `cat > /etc/systemd/system/${path} <<'CHIBBO_UNIT'\n${body}\nCHIBBO_UNIT`;
    const service = (name: string, description: string, environment: string, execStart: string, marker: string): string =>
      unit(`${name}.service`, `[Unit]\nDescription=${description}\nAfter=docker.service network-online.target\nWants=network-online.target\n\n[Service]\nType=oneshot\nTimeoutStartSec=45min\nStandardOutput=journal\nStandardError=journal\nSyslogIdentifier=${name}\n${environment}\nExecStart=${execStart}\nExecStartPost=/usr/bin/touch ${marker}\n\n[Install]\nWantedBy=multi-user.target`);
    // OnCalendar is explicit UTC so the host timezone cannot shift a run.
    // GapZer0 expires exports/ after one day, so every run stays daily.
    const timer = (name: string, description: string, kstComment: string, utc: string): string =>
      unit(`${name}.timer`, `[Unit]\nDescription=${description}\n\n[Timer]\n# ${kstComment}\nOnCalendar=*-*-* ${utc} UTC\nPersistent=true\nRandomizedDelaySec=5m\nUnit=${name}.service\n\n[Install]\nWantedBy=timers.target`);
    // Controls whose checks need no resource filter share one runner; the
    // target role grants only the Describe/List calls those checks need.
    const controlRuns = [
      { control: "tvm-c-01", name: "chibbo-prowler-tvm", label: "TVM-C-01 EC2/RDS", marker: ".initial-tvm-run-complete", kst: "03:45 Asia/Seoul, after the S3 and Trivy runs", utc: "18:45:00" },
      { control: "inf-e-01", name: "chibbo-prowler-inf-e-01", label: "INF-E-01 ELBv2/CloudFront TLS", marker: ".initial-inf-e-01-run-complete", kst: "04:00 Asia/Seoul, after the TVM-C-01 run", utc: "19:00:00" },
    ] as const;
    const units = ["chibbo-prowler-s3.service", "chibbo-prowler-s3.timer", "chibbo-trivy-platform.service", "chibbo-trivy-platform.timer", ...controlRuns.flatMap((run) => [`${run.name}.service`, `${run.name}.timer`])];
    userData.addCommands(
      "dnf install -y docker",
      "systemctl enable --now docker",
      "install -d -m 755 /usr/local/libexec",
      "install -d -m 700 /var/lib/chibbo-prowler",
      "install -d -m 700 /var/lib/chibbo-trivy",
      ...installRunner("chibbo-run-prowler-s3", prowlerS3RunnerGzipBase64),
      ...installRunner("chibbo-run-prowler-control", prowlerControlRunnerGzipBase64),
      ...installRunner("chibbo-run-trivy-platform", trivyRunnerGzipBase64),
      service("chibbo-prowler-s3", "Chibbo scheduled S3 Prowler source scan", runnerEnvironment, "/usr/local/libexec/chibbo-run-prowler-s3", "/var/lib/chibbo-prowler/.initial-run-complete"),
      service("chibbo-trivy-platform", "Chibbo scheduled platform-image Trivy source scan", trivyRunnerEnvironment, "/usr/local/libexec/chibbo-run-trivy-platform", "/var/lib/chibbo-trivy/.initial-run-complete"),
      ...controlRuns.map((run) => service(run.name, `Chibbo scheduled ${run.label} Prowler source scan`, environmentLines([...targetRoleEnvironment, `CHIBBO_PROWLER_CONTROL=${run.control}`, `"CHIBBO_PROWLER_CHECKS=${PROWLER_CONTROL_CHECKS[run.control].join(" ")}"`]), "/usr/local/libexec/chibbo-run-prowler-control", `/var/lib/chibbo-prowler/${run.marker}`)),
      timer("chibbo-prowler-s3", "Run the Chibbo S3 Prowler source scan daily", "03:15 Asia/Seoul", "18:15:00"),
      timer("chibbo-trivy-platform", "Run the Chibbo platform-image Trivy source scan daily", "03:30 Asia/Seoul", "18:30:00"),
      ...controlRuns.map((run) => timer(run.name, `Run the Chibbo ${run.label} Prowler source scan daily`, run.kst, run.utc)),
      `chmod 644 ${units.map((name) => `/etc/systemd/system/${name}`).join(" ")}`,
      "systemctl daemon-reload",
      ...["chibbo-prowler-s3", "chibbo-trivy-platform", ...controlRuns.map((run) => run.name)].map((name) => `systemctl enable --now ${name}.timer`),
      "if [ ! -e /var/lib/chibbo-prowler/.initial-run-complete ]; then systemctl start --no-block chibbo-prowler-s3.service; fi",
      "if [ ! -e /var/lib/chibbo-trivy/.initial-run-complete ]; then systemctl start --no-block chibbo-trivy-platform.service; fi",
      ...controlRuns.map((run) => `if [ ! -e /var/lib/chibbo-prowler/${run.marker} ]; then systemctl start --no-block ${run.name}.service; fi`),
    );
    const instance = new ec2.Instance(this, "ProwlerScanner", {
      vpc: props.foundation.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      role: props.foundation.prowlerScannerRole,
      securityGroup,
      instanceName: `chibbo-${props.environmentName}-prowler-scanner`,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.SMALL),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      requireImdsv2: true,
      blockDevices: [{ deviceName: "/dev/xvda", volume: ec2.BlockDeviceVolume.ebs(30, { encrypted: true, volumeType: ec2.EbsDeviceVolumeType.GP3, deleteOnTermination: true }) }],
      userData,
      // User data runs only on an instance's first boot, so an in-place
      // update would restart the scanner without installing a changed runner.
      // The scanner keeps no state (reports go to S3), so replace it instead.
      userDataCausesReplacement: true,
    });
    // Docker containers require two hops to retrieve the instance's IMDSv2
    // token.  IMDS itself remains mandatory and never exposes IMDSv1.
    const cfnInstance = instance.node.defaultChild as ec2.CfnInstance;
    cfnInstance.addPropertyOverride("MetadataOptions.HttpTokens", "required");
    cfnInstance.addPropertyOverride("MetadataOptions.HttpPutResponseHopLimit", 2);
    new CfnOutput(this, "ProwlerScannerInstanceId", { value: instance.instanceId });
    new CfnOutput(this, "ProwlerSourceArtifactPrefix", { value: `s3://gapzero-evidence-${this.account}-${this.region}/exports/prowler/chibbo/` });
    new CfnOutput(this, "TrivySourceArtifactUri", { value: `s3://gapzero-evidence-${this.account}-${this.region}/exports/trivy/chibbo/latest.json` });
  }
}

interface ChibboRuntimeProps extends StackProps { environmentName: string; foundation: ChibboFoundationStack; repository: ecr.IRepository; imageDigest: string; runtimeConfigSecretName: string; entraClientSecretName?: string; entraTenantId?: string; entraClientId?: string; entraIssuer?: string; migratorDbSecretName: string; appDbSecretName: string; }
const imageFor = (repository: ecr.IRepository, digest: string): ecs.ContainerImage => ecs.ContainerImage.fromRegistry(`${repository.repositoryUri}@${digest}`);
const addDatabaseEnvironment = (container: ecs.ContainerDefinition, foundation: ChibboFoundationStack, secret: secretsmanager.ISecret): void => {
  container.addEnvironment("PGHOST", foundation.database.dbInstanceEndpointAddress);
  container.addEnvironment("PGPORT", foundation.database.dbInstanceEndpointPort);
  container.addEnvironment("PGDATABASE", "chibbo");
  container.addEnvironment("PGUSER", "chibbo_app");
  container.addSecret("PGPASSWORD", ecs.Secret.fromSecretsManager(secret, "password"));
};

export class ChibboMigratorStack extends Stack {
  public readonly taskDefinition: ecs.FargateTaskDefinition;
  constructor(scope: Construct, id: string, props: ChibboRuntimeProps) {
    super(scope, id, props); tag(this, props.environmentName);
    const runtimeSecret = secretsmanager.Secret.fromSecretNameV2(this, "RuntimeConfig", props.runtimeConfigSecretName);
    const migratorDbSecret = secretsmanager.Secret.fromSecretNameV2(this, "MigratorDbSecret", props.migratorDbSecretName);
    const appDbSecret = secretsmanager.Secret.fromSecretNameV2(this, "AppDbSecret", props.appDbSecretName);
    const role = new iam.Role(this, "MigrationTaskRole", { assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com") });
    const executionRole = new iam.Role(this, "MigrationTaskExecutionRole", { assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com") });
    executionRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AmazonECSTaskExecutionRolePolicy"));
    // ECS retrieves the private image and injects container secrets before the
    // task process starts, so these grants belong to the execution role.
    for (const secret of [runtimeSecret, props.foundation.databaseSecret, migratorDbSecret, appDbSecret]) secret.grantRead(executionRole);
    this.taskDefinition = new ecs.FargateTaskDefinition(this, "MigrationTask", {
      cpu: 512, memoryLimitMiB: 1024, taskRole: role, executionRole,
      runtimePlatform: { cpuArchitecture: ecs.CpuArchitecture.ARM64, operatingSystemFamily: ecs.OperatingSystemFamily.LINUX }
    });
    const container = this.taskDefinition.addContainer("Migrator", { image: imageFor(props.repository, props.imageDigest), logging: ecs.LogDrivers.awsLogs({ logGroup: props.foundation.appLogGroup, streamPrefix: "migrator" }), command: ["node", "apps/platform/scripts/migrate-db.mjs"] });
    container.addEnvironment("CHIBBO_DB_ADMIN_HOST", props.foundation.database.dbInstanceEndpointAddress);
    container.addEnvironment("CHIBBO_DB_ADMIN_PORT", props.foundation.database.dbInstanceEndpointPort);
    container.addEnvironment("CHIBBO_DATABASE_NAME", "chibbo");
    container.addEnvironment("PGSSLMODE", "require");
    container.addSecret("CHIBBO_DB_ADMIN_USER", ecs.Secret.fromSecretsManager(props.foundation.databaseSecret, "username"));
    container.addSecret("CHIBBO_DB_ADMIN_PASSWORD", ecs.Secret.fromSecretsManager(props.foundation.databaseSecret, "password"));
    container.addSecret("CHIBBO_MIGRATOR_DB_PASSWORD", ecs.Secret.fromSecretsManager(migratorDbSecret, "password"));
    container.addSecret("CHIBBO_APP_DB_PASSWORD", ecs.Secret.fromSecretsManager(appDbSecret, "password"));
    container.addSecret("CHIBBO_DELETION_PEPPER", ecs.Secret.fromSecretsManager(runtimeSecret, "CHIBBO_DELETION_PEPPER"));
    new CfnOutput(this, "MigrationTaskDefinitionArn", { value: this.taskDefinition.taskDefinitionArn });
  }
}

export class ChibboApplicationStack extends Stack {
  constructor(scope: Construct, id: string, props: ChibboRuntimeProps & { appOrigin: string; certificateArn: string; entraClientSecretName: string; entraTenantId: string; entraClientId: string; entraIssuer: string }) {
    super(scope, id, props); tag(this, props.environmentName);
    const runtimeSecret = secretsmanager.Secret.fromSecretNameV2(this, "RuntimeConfig", props.runtimeConfigSecretName);
    const appDbSecret = secretsmanager.Secret.fromSecretNameV2(this, "AppDbSecret", props.appDbSecretName);
    const entraSecret = secretsmanager.Secret.fromSecretNameV2(this, "EntraClientSecret", props.entraClientSecretName);
    const executionRole = new iam.Role(this, "TaskExecutionRole", { assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com") });
    executionRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AmazonECSTaskExecutionRolePolicy"));
    const taskRole = new iam.Role(this, "ApplicationTaskRole", { assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com") });
    // Secrets are injected by ECS; the application process itself only needs
    // its narrowly scoped S3/KMS permissions below.
    for (const secret of [runtimeSecret, appDbSecret, entraSecret]) secret.grantRead(executionRole);
    taskRole.addToPolicy(new iam.PolicyStatement({ actions: ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject", "s3:DeleteObject", "s3:DeleteObjectVersion"], resources: [props.foundation.resumeBucket.arnForObjects("quarantine/*"), props.foundation.resumeBucket.arnForObjects("accepted/*")] }));
    taskRole.addToPolicy(new iam.PolicyStatement({ actions: ["s3:ListBucket"], resources: [props.foundation.resumeBucket.bucketArn], conditions: { StringLike: { "s3:prefix": ["quarantine/*", "accepted/*"] } } }));
    props.foundation.resumeKey.grantEncryptDecrypt(taskRole);
    const task = new ecs.FargateTaskDefinition(this, "Task", {
      cpu: 512, memoryLimitMiB: 1024, taskRole, executionRole,
      runtimePlatform: { cpuArchitecture: ecs.CpuArchitecture.ARM64, operatingSystemFamily: ecs.OperatingSystemFamily.LINUX }
    });
    const container = task.addContainer("Platform", { image: imageFor(props.repository, props.imageDigest), logging: ecs.LogDrivers.awsLogs({ logGroup: props.foundation.appLogGroup, streamPrefix: "platform" }), portMappings: [{ containerPort: 3000 }], environment: { NODE_ENV: "production", NEXT_PUBLIC_APP_ORIGIN: props.appOrigin, CHIBBO_STORAGE_MODE: "s3", CHIBBO_RESUME_BUCKET: props.foundation.resumeBucket.bucketName, CHIBBO_RESUME_KMS_KEY_ID: props.foundation.resumeKey.keyArn, ENTRA_TENANT_ID: props.entraTenantId, ENTRA_CLIENT_ID: props.entraClientId, ENTRA_ISSUER: props.entraIssuer }, secrets: { CHIBBO_DELETION_PEPPER: ecs.Secret.fromSecretsManager(runtimeSecret, "CHIBBO_DELETION_PEPPER"), ENTRA_CLIENT_SECRET: ecs.Secret.fromSecretsManager(entraSecret, "ENTRA_CLIENT_SECRET") } });
    addDatabaseEnvironment(container, props.foundation, appDbSecret);
    container.addEnvironment("PGSSLMODE", "require");
    const service = new ecs.FargateService(this, "Service", { cluster: props.foundation.cluster, taskDefinition: task, desiredCount: 1, minHealthyPercent: 100, maxHealthyPercent: 200, assignPublicIp: false, securityGroups: [props.foundation.appSecurityGroup], vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS } });
    const alb = new elbv2.ApplicationLoadBalancer(this, "Alb", { vpc: props.foundation.vpc, internetFacing: true, securityGroup: props.foundation.loadBalancerSecurityGroup });
    const listener = alb.addListener("Https", { port: 443, open: false, protocol: elbv2.ApplicationProtocol.HTTPS, certificates: [acm.Certificate.fromCertificateArn(this, "Certificate", props.certificateArn)] });
    listener.addTargets("Platform", { port: 3000, protocol: elbv2.ApplicationProtocol.HTTP, targets: [service], healthCheck: { path: "/api/health" } });
    new CfnOutput(this, "ApplicationUrl", { value: props.appOrigin });
    new CfnOutput(this, "LoadBalancerDnsName", { value: alb.loadBalancerDnsName });
  }
}
