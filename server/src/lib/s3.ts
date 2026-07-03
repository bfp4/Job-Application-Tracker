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

// Lazily build the S3 client so the server can still boot before AWS
// credentials are configured. The first call to an S3 helper validates the
// environment and throws if anything is missing.
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
 * Uploads a buffer to S3 from the server. Used for resume PDFs uploaded via
 * multipart form data and processed server-side.
 */
export async function uploadBuffer(
  key: string,
  body: Buffer,
  contentType: string
): Promise<void> {
  const { client, bucket } = getS3();
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
  });
  await client.send(command);
}

/**
 * Returns a pre-signed GET URL so the frontend can view/download a stored
 * file without routing the bytes through Express.
 */
export async function getDownloadUrl(
  key: string,
  options?: { downloadFilename?: string }
): Promise<string> {
  const { client, bucket } = getS3();
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
    ...(options?.downloadFilename
      ? {
          ResponseContentDisposition: `attachment; filename="${options.downloadFilename}"`,
        }
      : {}),
  });
  return getSignedUrl(client, command, { expiresIn: DOWNLOAD_URL_TTL_SECONDS });
}
