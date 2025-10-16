#!/bin/bash

set -e  # Exit on error

BUCKET_NAME="hub.robotick.org"
REGION="eu-west-2"
SOURCE_DIR="./dist"  # Vite default output folder
CLOUDFRONT_DISTRIBUTION_ID="E19373VJYX7Q5H"

echo "Building project with Vite..."
npm run build

echo "Syncing $SOURCE_DIR to s3://$BUCKET_NAME..."
aws s3 sync "$SOURCE_DIR" "s3://$BUCKET_NAME" --delete

echo "Invalidating CloudFront cache..."
aws cloudfront create-invalidation \
  --distribution-id "$CLOUDFRONT_DISTRIBUTION_ID" \
  --paths "/*"

echo "✅ Deployed Robotick-Hub to S3 + CloudFront successfully!"
