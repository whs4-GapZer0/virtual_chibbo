#!/usr/bin/env bash
set -euo pipefail

# AWS Config allows one customer-managed recorder and delivery channel in each
# account/Region.  Refuse to replace an unrelated deployment; this PoC only
# manages its explicit Chibbo names and its own tagged rule scope.
stack_output() {
  aws cloudformation describe-stacks --stack-name ChibboFoundationDev \
    --query "Stacks[0].Outputs[?OutputKey==\`$1\`].OutputValue" --output text
}

recorder_name="$(stack_output ConfigurationRecorderName)"
bucket_name="$(stack_output ConfigurationHistoryBucketName)"
role_arn="$(stack_output ConfigurationRecorderRoleArn)"
channel_name="${recorder_name%-recorder}-delivery"
for required in "$recorder_name" "$bucket_name" "$role_arn"; do test -n "$required" && test "$required" != "None"; done

existing_recorder="$(aws configservice describe-configuration-recorders --query 'ConfigurationRecorders[0].name' --output text)"
if [[ "$existing_recorder" != "None" && "$existing_recorder" != "$recorder_name" ]]; then
  echo "Refusing to replace non-Chibbo AWS Config recorder: $existing_recorder" >&2
  exit 1
fi
existing_channel="$(aws configservice describe-delivery-channels --query 'DeliveryChannels[0].name' --output text)"
if [[ "$existing_channel" != "None" && "$existing_channel" != "$channel_name" ]]; then
  echo "Refusing to replace non-Chibbo AWS Config delivery channel: $existing_channel" >&2
  exit 1
fi

aws configservice put-configuration-recorder --configuration-recorder "$(jq -cn \
  --arg name "$recorder_name" --arg role "$role_arn" \
  '{name:$name,roleARN:$role,recordingMode:{recordingFrequency:"DAILY"},recordingGroup:{allSupported:false,includeGlobalResourceTypes:false,recordingStrategy:{useOnly:"INCLUSION_BY_RESOURCE_TYPES"},resourceTypes:["AWS::CloudTrail::Trail","AWS::EC2::FlowLog","AWS::EC2::NetworkAcl","AWS::EC2::RouteTable","AWS::EC2::SecurityGroup","AWS::EC2::Subnet","AWS::EC2::VPC","AWS::ECR::Repository","AWS::ECS::Cluster","AWS::ECS::Service","AWS::RDS::DBInstance","AWS::S3::Bucket"]}}')"
aws configservice put-delivery-channel --delivery-channel "$(jq -cn \
  --arg name "$channel_name" --arg bucket "$bucket_name" \
  '{name:$name,s3BucketName:$bucket,s3KeyPrefix:"config",configSnapshotDeliveryProperties:{deliveryFrequency:"TwentyFour_Hours"}}')"
aws configservice start-configuration-recorder --configuration-recorder-name "$recorder_name"

put_rule() {
  local name="$1" identifier="$2"
  aws configservice put-config-rule --config-rule "$(jq -cn \
    --arg name "$name" --arg identifier "$identifier" \
    '{ConfigRuleName:$name,Scope:{TagKey:"Project",TagValue:"virtual-chibbo"},Source:{Owner:"AWS",SourceIdentifier:$identifier}}')"
}
put_rule "chibbo-dev-s3-public-read" "S3_BUCKET_PUBLIC_READ_PROHIBITED"
put_rule "chibbo-dev-s3-public-write" "S3_BUCKET_PUBLIC_WRITE_PROHIBITED"
put_rule "chibbo-dev-rds-storage-encrypted" "RDS_STORAGE_ENCRYPTED"
put_rule "chibbo-dev-rds-not-public" "RDS_INSTANCE_PUBLIC_ACCESS_CHECK"
put_rule "chibbo-dev-vpc-flow-logs" "VPC_FLOW_LOGS_ENABLED"

for _ in 1 2 3 4 5; do
  recording="$(aws configservice describe-configuration-recorder-status --configuration-recorder-names "$recorder_name" --query 'ConfigurationRecordersStatus[0].recording' --output text)"
  if [[ "$recording" == "True" ]]; then
    echo "AWS Config recorder is running: $recorder_name"
    exit 0
  fi
  sleep 2
done
echo "AWS Config recorder did not reach running state: $recorder_name" >&2
exit 1
