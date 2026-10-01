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
import { Construct } from "constructs";

const TAGS = { Project: "virtual-chibbo", Owner: "ChibboCompany", DataClass: "synthetic", CostCenter: "Chibbo" } as const;
const tag = (scope: Construct, environmentName: string): void => Object.entries({ ...TAGS, Environment: environmentName }).forEach(([key, value]) => Tags.of(scope).add(key, value));

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
        "iam:AttachRolePolicy", "iam:CreateRole", "iam:DeleteRole", "iam:DeleteRolePolicy", "iam:DetachRolePolicy", "iam:GetRole", "iam:GetRolePolicy", "iam:PassRole", "iam:PutRolePolicy", "iam:TagRole", "iam:UntagRole"
      ],
      resources: ["*"]
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
    this.githubDeployRole.addToPolicy(new iam.PolicyStatement({ actions: ["ecr:BatchCheckLayerAvailability", "ecr:CompleteLayerUpload", "ecr:DescribeImages", "ecr:InitiateLayerUpload", "ecr:PutImage", "ecr:UploadLayerPart"], resources: [this.formatArn({ service: "ecr", resource: "repository", resourceName: `chibbo-platform-${props.environmentName}` })] }));
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
    new CfnOutput(this, "GithubDeployRoleArn", { value: this.githubDeployRole.roleArn });
    new CfnOutput(this, "CloudFormationExecutionRoleArn", { value: this.cloudFormationExecutionRole.roleArn });
    new CfnOutput(this, "DeploymentAssetsBucketName", { value: this.deploymentAssetsBucket.bucketName });
  }
}

export interface ChibboRegistryStackProps extends StackProps { environmentName: string; }
export class ChibboRegistryStack extends Stack {
  public readonly repository: ecr.Repository;
  constructor(scope: Construct, id: string, props: ChibboRegistryStackProps) {
    super(scope, id, props); tag(this, props.environmentName);
    this.repository = new ecr.Repository(this, "PlatformRepository", { repositoryName: `chibbo-platform-${props.environmentName}`, imageTagMutability: ecr.TagMutability.IMMUTABLE, imageScanOnPush: true, encryption: ecr.RepositoryEncryption.AES_256, lifecycleRules: [{ maxImageCount: 30 }], removalPolicy: RemovalPolicy.RETAIN });
    new CfnOutput(this, "PlatformRepositoryUri", { value: this.repository.repositoryUri });
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
  public readonly resumeKey: kms.Key;
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
    const auditBucket = new s3.Bucket(this, "AuditBucket", { blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, encryption: s3.BucketEncryption.KMS, encryptionKey: auditKey, enforceSSL: true, versioned: true, removalPolicy: RemovalPolicy.RETAIN });
    this.resumeKey = new kms.Key(this, "ResumeKey", { enableKeyRotation: true, removalPolicy: RemovalPolicy.RETAIN, alias: `alias/chibbo/${props.environmentName}/resume` });
    this.resumeBucket = new s3.Bucket(this, "ResumeBucket", { blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED, encryption: s3.BucketEncryption.KMS, encryptionKey: this.resumeKey, enforceSSL: true, versioned: true, cors: props.appOrigin ? [{ allowedOrigins: [props.appOrigin], allowedMethods: [s3.HttpMethods.POST], allowedHeaders: ["content-type", "x-amz-*"], maxAge: 300 }] : undefined, lifecycleRules: [{ prefix: "quarantine/", expiration: Duration.days(7) }], removalPolicy: RemovalPolicy.RETAIN });
    const flowLogGroup = new logs.LogGroup(this, "FlowLogs", { logGroupName: `/chibbo/${props.environmentName}/flow`, retention: logs.RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.RETAIN });
    new ec2.FlowLog(this, "VpcFlowLogs", { resourceType: ec2.FlowLogResourceType.fromVpc(this.vpc), destination: ec2.FlowLogDestination.toCloudWatchLogs(flowLogGroup) });
    this.appLogGroup = new logs.LogGroup(this, "AppLogs", { logGroupName: `/chibbo/${props.environmentName}/app`, retention: logs.RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.RETAIN });
    const auditLogGroup = new logs.LogGroup(this, "AuditLogs", { logGroupName: `/chibbo/${props.environmentName}/audit`, retention: logs.RetentionDays.THREE_MONTHS, removalPolicy: RemovalPolicy.RETAIN });
    const trail = new cloudtrail.Trail(this, "ResumeDataTrail", { bucket: auditBucket, includeGlobalServiceEvents: false, isMultiRegionTrail: false, managementEvents: cloudtrail.ReadWriteType.NONE, sendToCloudWatchLogs: true, cloudWatchLogGroup: auditLogGroup });
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
