#!/usr/bin/env bash
set -euo pipefail
: "${CHIBBO_EXPAND_MIGRATION_APPROVAL_ID:?approved change record ID is required}"
case "$CHIBBO_EXPAND_MIGRATION_APPROVAL_ID" in *[!A-Za-z0-9._-]*|"") exit 1;; esac

stack_output() {
  aws cloudformation describe-stacks --stack-name "$1" \
    --query "Stacks[0].Outputs[?OutputKey==\`$2\`].OutputValue" --output text
}
task_definition="${CHIBBO_MIGRATION_TASK_DEFINITION_ARN:-$(stack_output ChibboMigratorDev MigrationTaskDefinitionArn)}"
cluster="${CHIBBO_CLUSTER_NAME:-$(stack_output ChibboFoundationDev ClusterName)}"
subnets="${CHIBBO_APP_SUBNET_IDS:-$(stack_output ChibboFoundationDev AppSubnetIds)}"
security_group="${CHIBBO_APP_SECURITY_GROUP_ID:-$(stack_output ChibboFoundationDev AppSecurityGroupId)}"
: "${task_definition:?migration task definition is required}"
: "${cluster:?foundation ECS cluster is required}"
: "${subnets:?private application subnets are required}"
: "${security_group:?application security group is required}"

overrides='{}'
if [[ "${CHIBBO_SEED_SYNTHETIC:-false}" == "true" ]]; then
  overrides='{"containerOverrides":[{"name":"Migrator","environment":[{"name":"CHIBBO_SEED_SYNTHETIC","value":"true"}]}]}'
fi
echo "Approved expand migration gate: $CHIBBO_EXPAND_MIGRATION_APPROVAL_ID"
task_arn="$(aws ecs run-task --cluster "$cluster" --launch-type FARGATE --task-definition "$task_definition" \
  --network-configuration "awsvpcConfiguration={subnets=[$subnets],securityGroups=[$security_group],assignPublicIp=DISABLED}" \
  --overrides "$overrides" --query 'tasks[0].taskArn' --output text)"
test -n "$task_arn" && test "$task_arn" != "None"
aws ecs wait tasks-stopped --cluster "$cluster" --tasks "$task_arn"
exit_code="$(aws ecs describe-tasks --cluster "$cluster" --tasks "$task_arn" --query 'tasks[0].containers[?name==`Migrator`].exitCode | [0]' --output text)"
test "$exit_code" = "0"
