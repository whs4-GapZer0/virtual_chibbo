import { execFileSync } from "node:child_process";

const region = process.env.AWS_REGION ?? "ap-northeast-2";
const output = execFileSync("aws", ["sso-admin", "list-instances", "--region", region, "--output", "json"], { encoding: "utf8" });
const instances = JSON.parse(output).Instances ?? [];
if (instances.length === 0) throw new Error("IAM Identity Center instance not found; do not create IAM users as a fallback");
console.log(JSON.stringify(instances.map(({ InstanceArn, IdentityStoreId }) => ({ InstanceArn, IdentityStoreId })), null, 2));
console.log("Verify the identity source, MFA policy, team-owned email aliases, and five distinct groups before applying the workforce stack. This script does not invite, create, or modify users.");
