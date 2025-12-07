#!/bin/bash

set -euo pipefail

BUCKET_NAME="hub.robotick.org"
REGION="eu-west-2"
SOURCE_DIR="./dist/renderer"
CLOUDFRONT_DISTRIBUTION_ID="E19373VJYX7Q5H"
DRY_RUN=false

usage() {
  cat <<EOF
Usage: $0 [--dry-run|-n]

Options:
  --dry-run, -n   Run all local checks (npm audit/test/build) without pushing to AWS.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run|-n)
      DRY_RUN=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

run_stage() {
  local description="$1"
  shift
  echo "$description"
  if ! "$@"; then
    echo "ERROR: $description failed" >&2
    exit 1
  fi
}

run_stage "Running npm audit before deploy..." npm audit

run_stage "Running npm test suite before build..." npm test
run_stage "Building project with Vite..." npm run build

if [[ "$DRY_RUN" == true ]]; then
  echo "[dry-run] Skipping sync of $SOURCE_DIR to s3://$BUCKET_NAME"
else
  run_stage "Syncing $SOURCE_DIR to s3://$BUCKET_NAME..." \
    aws s3 sync "$SOURCE_DIR" "s3://$BUCKET_NAME" --delete --size-only
fi

if [[ "$DRY_RUN" == true ]]; then
  echo "[dry-run] Skipping CloudFront cache invalidation for $CLOUDFRONT_DISTRIBUTION_ID"
else
  run_stage "Invalidating CloudFront cache..." \
    aws cloudfront create-invalidation \
    --distribution-id "$CLOUDFRONT_DISTRIBUTION_ID" \
    --paths "/*"
fi

if [[ "$DRY_RUN" == true ]]; then
  echo "✅ Dry run complete. AWS deploy steps were skipped."
else
  echo "✅ Deployed Robotick-Hub to S3 + CloudFront successfully!"
fi
