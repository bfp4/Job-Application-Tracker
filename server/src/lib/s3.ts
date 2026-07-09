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
// configuration exists. The first call to an S3 helper validates the region
// and bucket; credentials are validated only as a pair — when absent, the
// SDK's default provider chain (EC2 instance role, ~/.aws) supplies them,
// and a missing chain surfaces as a CredentialsProviderError at request time.
let cached: S3Config | null = null;

function getS3(): S3Config {
  if (cached) return cached;

  const {
    AWS_REGION,
    AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY,
    AWS_S3_BUCKET_NAME,
  } = process.env;

  if (!AWS_REGION || !AWS_S3_BUCKET_NAME) {
    throw new Error(
      "Missing AWS S3 configuration. Set AWS_REGION and AWS_S3_BUCKET_NAME " +
        "in the server environment."
    );
  }

  // A lone key id or secret is always a config mistake (half-pasted .env);
  // fail fast instead of silently falling through to the provider chain.
  if (Boolean(AWS_ACCESS_KEY_ID) !== Boolean(AWS_SECRET_ACCESS_KEY)) {
    throw new Error(
      "Set both AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, or neither " +
        "(on EC2 the instance role supplies credentials)."
    );
  }

  // Explicit credentials are only used when both keys are present (local
  // dev). Otherwise the SDK's default provider chain resolves them — on EC2
  // that's the instance role via IMDS, so no static keys live on the box.
  const credentials =
    AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY
      ? {
          accessKeyId: AWS_ACCESS_KEY_ID,
          secretAccessKey: AWS_SECRET_ACCESS_KEY,
        }
      : undefined;

  cached = {
    client: new S3Client({ region: AWS_REGION, credentials }),
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
 * Downloads an S3 object and returns its contents as a UTF-8 string. Used to
 * pull the stored resume markdown into an agent prompt server-side.
 */
export async function getObjectText(key: string): Promise<string> {
  const { client, bucket } = getS3();
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  const response = await client.send(command);
  const body = response.Body;
  if (!body) {
    throw new Error(`S3 object ${key} has no body.`);
  }
  return body.transformToString("utf-8");
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
