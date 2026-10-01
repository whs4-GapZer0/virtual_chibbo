import * as sso from "aws-cdk-lib/aws-sso";
import { Stack, type StackProps, Tags } from "aws-cdk-lib";
import { Construct } from "constructs";

export interface ChibboWorkforceResourceArns {
  cloudFormationStackArn: string;
  ecsServiceArn: string;
  ecrRepositoryArn: string;
  appLogGroupArn: string;
  auditLogGroupArn: string;
  auditBucketArn: string;
  auditObjectPrefixArn: string;
  auditKmsKeyArn: string;
  dataTrailArn: string;
  resourceExplorerViewArn: string;
}

export interface ChibboWorkforceStackProps extends StackProps {
  environmentName: string;
  identityCenterInstanceArn: string;
  targetAccountId: string;
  groupIds: Record<string, string>;
  resources: ChibboWorkforceResourceArns;
}

type PolicyStatement = { Effect: "Allow"; Action: string[]; Resource: string | string[]; Condition?: Record<string, Record<string, string | string[]>> };
function policy(statements: PolicyStatement[]): { Version: string; Statement: PolicyStatement[] } { return { Version: "2012-10-17", Statement: statements }; }

/** No users are created: an identity-source owner maps five pre-existing Chibbo groups after MFA preflight. */
export class ChibboWorkforceStack extends Stack {
  constructor(scope: Construct, id: string, props: ChibboWorkforceStackProps) {
    super(scope, id, props);
    Tags.of(this).add("Project", "virtual-chibbo"); Tags.of(this).add("Environment", props.environmentName); Tags.of(this).add("Owner", "ChibboCompany");
    const r = props.resources;
    const definitions: Array<[string, PolicyStatement[]]> = [
      ["Chibbo-Approval", [{ Effect: "Allow", Action: ["cloudformation:DescribeStacks"], Resource: r.cloudFormationStackArn }, { Effect: "Allow", Action: ["ecs:DescribeServices"], Resource: r.ecsServiceArn }]],
      ["Chibbo-Platform-Operator", [{ Effect: "Allow", Action: ["ecs:DescribeClusters", "ecs:DescribeServices"], Resource: r.ecsServiceArn }, { Effect: "Allow", Action: ["logs:DescribeLogStreams", "logs:GetLogEvents", "logs:FilterLogEvents"], Resource: `${r.appLogGroupArn}:*` }]],
      ["Chibbo-Release-Operator", [{ Effect: "Allow", Action: ["ecr:DescribeImages", "ecr:BatchGetImage"], Resource: r.ecrRepositoryArn }, { Effect: "Allow", Action: ["cloudformation:DescribeStacks", "cloudformation:DescribeStackEvents"], Resource: r.cloudFormationStackArn }, { Effect: "Allow", Action: ["ecs:DescribeServices"], Resource: r.ecsServiceArn }]],
      ["Chibbo-Security-Auditor", [{ Effect: "Allow", Action: ["s3:ListBucket"], Resource: r.auditBucketArn, Condition: { StringLike: { "s3:prefix": ["AWSLogs/*", "cloudtrail/chibbo/*"] } } }, { Effect: "Allow", Action: ["s3:GetObject"], Resource: r.auditObjectPrefixArn }, { Effect: "Allow", Action: ["kms:Decrypt"], Resource: r.auditKmsKeyArn }, { Effect: "Allow", Action: ["logs:GetLogEvents", "logs:FilterLogEvents"], Resource: `${r.auditLogGroupArn}:*` }, { Effect: "Allow", Action: ["cloudtrail:GetTrailStatus"], Resource: r.dataTrailArn }]],
      ["Chibbo-Asset-Viewer", [{ Effect: "Allow", Action: ["resource-explorer-2:Search"], Resource: r.resourceExplorerViewArn }]]
    ];
    for (const [name, statements] of definitions) {
      const permissionSet = new sso.CfnPermissionSet(this, `${name}PermissionSet`, { instanceArn: props.identityCenterInstanceArn, name, sessionDuration: "PT4H", inlinePolicy: policy(statements) });
      const groupId = props.groupIds[name];
      if (groupId) new sso.CfnAssignment(this, `${name}Assignment`, { instanceArn: props.identityCenterInstanceArn, permissionSetArn: permissionSet.attrPermissionSetArn, principalId: groupId, principalType: "GROUP", targetId: props.targetAccountId, targetType: "AWS_ACCOUNT" });
    }
  }
}
