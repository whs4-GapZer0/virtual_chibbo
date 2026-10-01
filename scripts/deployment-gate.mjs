import { existsSync, readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const required = ["APP_ORIGIN", "CERTIFICATE_ARN", "CHIBBO_MONTHLY_BUDGET_USD", "RUNTIME_CONFIG_SECRET_NAME", "CHIBBO_MIGRATOR_DB_SECRET_NAME", "CHIBBO_APP_DB_SECRET_NAME", "ENTRA_CLIENT_SECRET_NAME", "ENTRA_TENANT_ID", "ENTRA_CLIENT_ID", "ENTRA_ISSUER", "CHIBBO_CFN_EXECUTION_ROLE_ARN"];
const absent = required.filter((name) => !process.env[name] || process.env[name]?.includes("REQUIRED_AT_DEPLOY"));
if (absent.length > 0) throw new Error(`missing deployment values: ${absent.join(", ")}`);
if (!process.env.APP_ORIGIN?.startsWith("https://")) throw new Error("APP_ORIGIN must be an HTTPS origin");
if (!process.env.CERTIFICATE_ARN?.includes(":certificate/")) throw new Error("CERTIFICATE_ARN is not an ACM certificate ARN");
if (!(Number(process.env.CHIBBO_MONTHLY_BUDGET_USD) > 0)) throw new Error("CHIBBO_MONTHLY_BUDGET_USD must be positive");
if (!existsSync("docs/cost") || !readdirSync("docs/cost").some((file) => file.endsWith(".json")) || !readFileSync("config/cost-assumptions.dev.yaml", "utf8").includes("monthlyUsd:")) throw new Error("dated Pricing API/Calculator JSON evidence and cost assumptions are required");
const aws = (...args) => execFileSync("aws", [...args, "--region", process.env.AWS_REGION ?? "ap-northeast-2", "--output", "json"], { encoding: "utf8" });
const accountId = JSON.parse(aws("sts", "get-caller-identity")).Account;
if (accountId !== "992764023398") throw new Error(`expected Chibbo AWS account 992764023398, received ${accountId}`);
if (!process.env.CHIBBO_CFN_EXECUTION_ROLE_ARN?.startsWith(`arn:aws:iam::${accountId}:role/chibbo-dev-`)) throw new Error("CloudFormation execution role must be the Chibbo Bootstrap output");
for (const name of [process.env.RUNTIME_CONFIG_SECRET_NAME, process.env.CHIBBO_MIGRATOR_DB_SECRET_NAME, process.env.CHIBBO_APP_DB_SECRET_NAME, process.env.ENTRA_CLIENT_SECRET_NAME]) aws("secretsmanager", "describe-secret", "--secret-id", name);
aws("acm", "describe-certificate", "--certificate-arn", process.env.CERTIFICATE_ARN);
aws("budgets", "describe-budget", "--account-id", accountId, "--budget-name", "Chibbo-dev");
console.log(`deployment gate passed for account ${accountId}; protected environment approval still records human verification of the Bootstrap OIDC trust and Identity Center MFA.`);
