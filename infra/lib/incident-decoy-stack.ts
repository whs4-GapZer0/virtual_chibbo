import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import { CfnOutput, Stack, type StackProps, Tags } from "aws-cdk-lib";
import { Construct } from "constructs";

/**
 * Incident-replica decoys for the GapZer0 GRC PoC (docs/incident-decoys.md).
 *
 * Each resource reproduces the *management failure* behind a 2025 Korean
 * breach at an ISMS-P certified company, so GapZer0 can be shown judging the
 * same failure from the live AWS account.  None of them is reachable or
 * usable:
 *
 * - LOTTE: a dormant "payment gateway" instance running outside the asset
 *   register.  Isolated subnet, no ingress, no egress, no public IP, no key
 *   pair, no instance role, no user data.
 * - KT (registration system without a firewall): an *unattached* security
 *   group that opens SSH to the internet.  Nothing is behind it.
 * - KT (one credential shared by every device, no owner): an IAM user with no
 *   password, no access key and no policy, owned by nobody.
 *
 * The VPC and subnet are passed in as plain IDs instead of cross-stack
 * imports, so the Foundation stack never gains an export that this optional
 * stack would pin.  Deploy with `-c incidentDecoys=true`; remove by deleting
 * the stack.  Every resource carries `gapzero:decoy`.
 */
export interface ChibboIncidentDecoyStackProps extends StackProps {
  environmentName: string;
  vpcId: string;
  /** A PRIVATE_ISOLATED (db) subnet of the Chibbo VPC: no route out. */
  isolatedSubnetId: string;
  /** The value GapZer0 reads from AWS_ASSET_SCOPE for AST-E-01. */
  assetScope: string;
}

export const DECOY_TAG_KEY = "gapzero:decoy";
export const DECOY_IAM_PATH = "/chibbo-decoy/";
// CDK's own "no egress" placeholder: an ICMP rule to a broadcast address that
// matches nothing, which stops EC2 from adding its default allow-all egress.
const NO_EGRESS: ec2.CfnSecurityGroup.EgressProperty[] = [{ ipProtocol: "icmp", fromPort: 252, toPort: 86, cidrIp: "255.255.255.255/32", description: "Disallow all traffic" }];

export class ChibboIncidentDecoyStack extends Stack {
  constructor(scope: Construct, id: string, props: ChibboIncidentDecoyStackProps) {
    super(scope, id, props);
    if (!/^vpc-[0-9a-f]+$/.test(props.vpcId) || !/^subnet-[0-9a-f]+$/.test(props.isolatedSubnetId)) {
      throw new Error("incident decoys need a vpc-… ID and an isolated subnet-… ID");
    }
    Object.entries({
      Project: "virtual-chibbo", Owner: "ChibboCompany", DataClass: "synthetic", CostCenter: "Chibbo",
      Environment: props.environmentName, [DECOY_TAG_KEY]: "incident-replica",
    }).forEach(([key, value]) => Tags.of(this).add(key, value));
    const name = (suffix: string): string => `chibbo-${props.environmentName}-decoy-${suffix}`;

    // --- LOTTE CARD 2025: a payment server left outside monitoring --------
    // Lotte's breached server had seen no card transactions since 2022, was
    // still running, and was excluded from monitoring and regular evaluation.
    // This instance is tagged into the GapZer0 asset scope but deliberately not
    // registered in the NetBox asset register that AST-E-01 compares against.
    const dormantGroup = new ec2.CfnSecurityGroup(this, "DecoyDormantPayGatewaySecurityGroup", {
      vpcId: props.vpcId,
      groupDescription: "DECOY lotte-card-2025: no ingress and no egress",
      securityGroupEgress: NO_EGRESS,
    });
    const dormant = new ec2.CfnInstance(this, "DecoyDormantPayGateway", {
      // The already-approved x86_64 AL2023 parameter; no new SSM permission.
      imageId: ec2.MachineImage.latestAmazonLinux2023().getImage(this).imageId,
      instanceType: "t3.nano",
      subnetId: props.isolatedSubnetId,
      securityGroupIds: [dormantGroup.attrGroupId],
      blockDeviceMappings: [{ deviceName: "/dev/xvda", ebs: { volumeSize: 8, volumeType: "gp3", encrypted: true, deleteOnTermination: true } }],
      tags: [
        { key: "Name", value: name("dormant-pay-gateway") },
        { key: "gapzero:asset-scope", value: props.assetScope },
      ],
    });
    // IMDSv2 only, one hop: the same override the scanner instance uses.
    dormant.addPropertyOverride("MetadataOptions", { HttpTokens: "required", HttpEndpoint: "enabled", HttpPutResponseHopLimit: 1 });
    Tags.of(dormantGroup).add("gapzero:decoy-scenario", "lotte-card-2025");
    Tags.of(dormant).add("gapzero:decoy-scenario", "lotte-card-2025");

    // --- KT 2025: registration system run without a firewall ---------------
    // Unattached on purpose: the finding is the rule itself.
    const registrationGroup = new ec2.CfnSecurityGroup(this, "DecoyFemtoRegistrationSecurityGroup", {
      vpcId: props.vpcId,
      groupName: name("femto-registration"),
      groupDescription: "DECOY kt-2025: unattached, opens SSH to the internet",
      securityGroupIngress: [{ ipProtocol: "tcp", fromPort: 22, toPort: 22, cidrIp: "0.0.0.0/0", description: "DECOY kt-2025: registration host without a firewall" }],
      securityGroupEgress: NO_EGRESS,
    });
    Tags.of(registrationGroup).add("gapzero:decoy-scenario", "kt-2025");

    // --- KT 2025: one credential shared by every device, owned by nobody ----
    // No password, no access key, no policy: the account exists, nobody owns it.
    const sharedDevice = new iam.User(this, "DecoySharedDeviceUser", { userName: name("shared-device"), path: DECOY_IAM_PATH });
    Tags.of(sharedDevice).add("gapzero:decoy-scenario", "kt-2025");

    new CfnOutput(this, "DecoyDormantPayGatewayInstanceId", { value: dormant.ref });
    new CfnOutput(this, "DecoyFemtoRegistrationSecurityGroupId", { value: registrationGroup.attrGroupId });
    new CfnOutput(this, "DecoySharedDeviceUserName", { value: sharedDevice.userName });
  }
}
