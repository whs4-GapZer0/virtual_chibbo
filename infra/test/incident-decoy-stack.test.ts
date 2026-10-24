import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { ChibboIncidentDecoyStack } from "../lib/incident-decoy-stack.js";
import { ChibboBootstrapStack } from "../lib/platform-stack.js";

const env = { account: "992764023398", region: "ap-northeast-2" };

function decoys(): Template {
  const app = new cdk.App({ defaultStackSynthesizer: new cdk.LegacyStackSynthesizer() });
  const stack = new ChibboIncidentDecoyStack(app, "ChibboIncidentDecoyTest", {
    env, environmentName: "test", vpcId: "vpc-0123abcd", isolatedSubnetId: "subnet-0456ef01", assetScope: "virtual-chibbo",
  });
  return Template.fromStack(stack);
}

describe("incident-replica decoys", () => {
  it("creates exactly the three decoys and nothing that grants access", () => {
    const template = decoys();
    template.resourceCountIs("AWS::EC2::Instance", 1);
    template.resourceCountIs("AWS::EC2::SecurityGroup", 2);
    template.resourceCountIs("AWS::IAM::User", 1);
    for (const type of ["AWS::IAM::AccessKey", "AWS::IAM::Policy", "AWS::IAM::ManagedPolicy", "AWS::IAM::Role", "AWS::IAM::InstanceProfile", "AWS::EC2::EIP", "AWS::EC2::NetworkInterface"]) {
      template.resourceCountIs(type, 0);
    }
    expect(JSON.stringify(template.toJSON())).not.toContain("Fn::ImportValue");
  });

  it("keeps the Lotte dormant server unreachable: isolated subnet, no ingress, no egress, no key, no role", () => {
    const template = decoys();
    template.hasResourceProperties("AWS::EC2::Instance", {
      InstanceType: "t3.nano",
      SubnetId: "subnet-0456ef01",
      MetadataOptions: { HttpTokens: "required", HttpPutResponseHopLimit: 1 },
      BlockDeviceMappings: [{ DeviceName: "/dev/xvda", Ebs: Match.objectLike({ Encrypted: true }) }],
      Tags: Match.arrayWith([{ Key: "gapzero:asset-scope", Value: "virtual-chibbo" }, { Key: "gapzero:decoy", Value: "incident-replica" }]),
    });
    const instance = Object.values(template.findResources("AWS::EC2::Instance"))[0] as { Properties: Record<string, unknown> };
    for (const absent of ["KeyName", "IamInstanceProfile", "UserData", "NetworkInterfaces"]) expect(instance.Properties[absent]).toBeUndefined();
    template.hasResourceProperties("AWS::EC2::SecurityGroup", {
      GroupDescription: Match.stringLikeRegexp("lotte-card-2025"),
      SecurityGroupIngress: Match.absent(),
      SecurityGroupEgress: [{ CidrIp: "255.255.255.255/32", IpProtocol: "icmp", FromPort: 252, ToPort: 86, Description: "Disallow all traffic" }],
    });
  });

  it("opens SSH only on an unattached KT security group", () => {
    const template = decoys();
    template.hasResourceProperties("AWS::EC2::SecurityGroup", {
      GroupName: "chibbo-test-decoy-femto-registration",
      SecurityGroupIngress: [Match.objectLike({ CidrIp: "0.0.0.0/0", IpProtocol: "tcp", FromPort: 22, ToPort: 22 })],
    });
    const registration = Object.entries(template.findResources("AWS::EC2::SecurityGroup")).find(([, value]) => JSON.stringify(value).includes("kt-2025"))![0];
    const instance = JSON.stringify(template.findResources("AWS::EC2::Instance"));
    expect(instance).not.toContain(registration);
  });

  it("gives the KT shared-device user no credential and no permission", () => {
    const template = decoys();
    template.hasResourceProperties("AWS::IAM::User", {
      UserName: "chibbo-test-decoy-shared-device",
      Path: "/chibbo-decoy/",
      LoginProfile: Match.absent(),
      Policies: Match.absent(),
      ManagedPolicyArns: Match.absent(),
      Groups: Match.absent(),
    });
  });

  it("brings its own unreachable network in standalone mode", () => {
    const app = new cdk.App({ defaultStackSynthesizer: new cdk.LegacyStackSynthesizer() });
    const template = Template.fromStack(new ChibboIncidentDecoyStack(app, "ChibboIncidentDecoyStandalone", {
      env: { account: "302795276649", region: "ap-northeast-2" }, environmentName: "dev", assetScope: "chibbo",
    }));
    template.resourceCountIs("AWS::EC2::VPC", 1);
    template.resourceCountIs("AWS::EC2::Subnet", 1);
    for (const type of ["AWS::EC2::InternetGateway", "AWS::EC2::NatGateway", "AWS::EC2::VPCGatewayAttachment", "AWS::EC2::Route", "AWS::EC2::EIP", "AWS::EC2::VPCPeeringConnection", "AWS::EC2::TransitGatewayAttachment", "AWS::IAM::AccessKey"]) {
      template.resourceCountIs(type, 0);
    }
    template.hasResourceProperties("AWS::EC2::Subnet", { MapPublicIpOnLaunch: false });
    // The default NACL denies everything before AWS's allow-all rule 100.
    for (const egress of [false, true]) {
      template.hasResourceProperties("AWS::EC2::NetworkAclEntry", {
        NetworkAclId: { "Fn::GetAtt": [Match.anyValue(), "DefaultNetworkAcl"] }, RuleNumber: 1, Protocol: -1, RuleAction: "deny", Egress: egress, CidrBlock: "0.0.0.0/0",
      });
    }
    template.hasResourceProperties("AWS::EC2::FlowLog", { ResourceType: "VPC", TrafficType: "ALL", LogDestinationType: "cloud-watch-logs" });
    template.hasResourceProperties("AWS::Logs::LogGroup", { LogGroupName: "/chibbo/dev/decoy-flow", RetentionInDays: 365 });
    // The only role is the Flow Log delivery role, trusted by that service alone.
    template.resourceCountIs("AWS::IAM::Role", 1);
    template.hasResourceProperties("AWS::IAM::Role", {
      AssumeRolePolicyDocument: { Statement: [Match.objectLike({ Principal: { Service: "vpc-flow-logs.amazonaws.com" } })] },
    });
    template.hasResourceProperties("AWS::EC2::Instance", {
      Tags: Match.arrayWith([{ Key: "gapzero:asset-scope", Value: "chibbo" }]),
    });
    template.hasResourceProperties("AWS::EC2::SecurityGroup", { GroupName: "chibbo-dev-decoy-femto-registration" });
    template.resourceCountIs("AWS::IAM::User", 1);
  });

  it("rejects network IDs that are not plain VPC and subnet IDs", () => {
    const app = new cdk.App({ defaultStackSynthesizer: new cdk.LegacyStackSynthesizer() });
    expect(() => new ChibboIncidentDecoyStack(app, "Bad", { env, environmentName: "test", vpcId: "REQUIRED", isolatedSubnetId: "subnet-1", assetScope: "x" })).toThrow();
    expect(() => new ChibboIncidentDecoyStack(app, "Half", { env, environmentName: "test", vpcId: "vpc-0123abcd", assetScope: "x" })).toThrow();
    expect(() => new ChibboIncidentDecoyStack(app, "Scope", { env, environmentName: "test", assetScope: "has space" })).toThrow();
  });

  it("limits the Bootstrap decoy permissions to the decoy path and stack", () => {
    const app = new cdk.App({ defaultStackSynthesizer: new cdk.LegacyStackSynthesizer() });
    const bootstrap = Template.fromStack(new ChibboBootstrapStack(app, "ChibboBootstrapTest", {
      env, environmentName: "test", githubOidcProviderArn: "arn:aws:iam::992764023398:oidc-provider/token.actions.githubusercontent.com", githubOwnerId: "1", githubRepositoryId: "2",
    }));
    const json = JSON.stringify(bootstrap.toJSON());
    expect(json).toContain("ManageIncidentDecoyUsersOnly");
    expect(json).toContain(":user/chibbo-decoy/*");
    expect(json).toContain("RemoveIncidentDecoysOnly");
    expect(json).toContain("ChibboIncidentDecoy*/*");
    // User management never reaches any other IAM user.
    const statements = Object.values(bootstrap.findResources("AWS::IAM::Policy"))
      .flatMap((policy) => (policy as { Properties: { PolicyDocument: { Statement: { Action: string | string[]; Resource: unknown }[] } } }).Properties.PolicyDocument.Statement);
    for (const statement of statements) {
      const actions = ([] as string[]).concat(statement.Action);
      if (actions.some((action) => action === "iam:CreateUser" || action === "iam:DeleteUser")) {
        expect(JSON.stringify(statement.Resource)).toContain(":user/chibbo-decoy/*");
        expect(JSON.stringify(statement.Resource)).not.toContain("\"*\"");
      }
    }
  });
});
