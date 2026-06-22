import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const UPLOAD_URL_TTL_SECONDS = 5 * 60; // 5 minutes
const DOWNLOAD_URL_TTL_SECONDS = 15 * 60; // 15 minutes

interface S3Config {
  client: S3Client;
  bucket: string;
}

// Lazily build the S3 client so the server can still boot (auth, jobs,
// applications, etc.) before AWS credentials are configured. The first call to
// an S3 helper validates the environment and throws if anything is missing.
let cached: S3Config | null = null;

function getS3(): S3Config {
  if (cached) return cached;

  const {
    AWS_REGION,
    AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY,
    AWS_S3_BUCKET_NAME,
  } = process.env;

  if (
    !AWS_REGION ||
    !AWS_ACCESS_KEY_ID ||
    !AWS_SECRET_ACCESS_KEY ||
    !AWS_S3_BUCKET_NAME
  ) {
    throw new Error(
      "Missing AWS S3 configuration. Set AWS_REGION, AWS_ACCESS_KEY_ID, " +
        "AWS_SECRET_ACCESS_KEY and AWS_S3_BUCKET_NAME in the server environment."
    );
  }

  cached = {
    client: new S3Client({
      region: AWS_REGION,
      credentials: {
        accessKeyId: AWS_ACCESS_KEY_ID,
        secretAccessKey: AWS_SECRET_ACCESS_KEY,
      },
    }),
    bucket: AWS_S3_BUCKET_NAME,
  };

  return cached;
}

/**
 * Returns a pre-signed PUT URL (valid for 5 minutes) so the frontend can upload
 * a file directly to S3 without routing the bytes through Express.
 */
export async function getUploadUrl(
  key: string,
  contentType: string
): Promise<string> {
  const { client, bucket } = getS3();
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(client, command, { expiresIn: UPLOAD_URL_TTL_SECONDS });
}

/**
 * Returns a pre-signed GET URL (valid for 15 minutes) so the frontend can
 * view/download a stored file.
 */
export async function getDownloadUrl(key: string): Promise<string> {
  const { client, bucket } = getS3();
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });
  return getSignedUrl(client, command, { expiresIn: DOWNLOAD_URL_TTL_SECONDS });
}
