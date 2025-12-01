#!/bin/bash

set -euo pipefail

BUCKET_NAME="hub.robotick.org"
REGION="eu-west-2"
SOURCE_DIR="./dist/renderer"
CLOUDFRONT_DISTRIBUTION_ID="E19373VJYX7Q5H"

run_stage() {
  local description="$1"
  shift
  echo "$description"
  if ! "$@"; then
    echo "ERROR: $description failed" >&2
    exit 1
  fi
}

run_stage "Running npm test suite before build..." npm test
run_stage "Building project with Vite..." npm run build

run_stage "Syncing $SOURCE_DIR to s3://$BUCKET_NAME..." \
  aws s3 sync "$SOURCE_DIR" "s3://$BUCKET_NAME" --delete --size-only

run_stage "Invalidating CloudFront cache..." \
  aws cloudfront create-invalidation \
  --distribution-id "$CLOUDFRONT_DISTRIBUTION_ID" \
  --paths "/*"

echo "✅ Deployed Robotick-Hub to S3 + CloudFront successfully!"
