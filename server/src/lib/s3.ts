import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";

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

/** DeleteObjects accepts at most 1000 keys per call; chunk anything larger. */
const DELETE_BATCH_SIZE = 1000;

/**
 * Permanently deletes the given keys. Used by account deletion to remove a
 * user's resume PDFs and their Markdown conversions.
 *
 * Throws if S3 reports any key as failed, rather than reporting a partial
 * success as done — the caller deletes the database rows next, and those rows
 * hold the only record of which keys exist. A silent failure here would strand
 * the objects with nothing left pointing at them: resume PDFs, full of exactly
 * the personal data the deletion was meant to erase, unreachable and therefore
 * unremovable. Loud failure means the request can simply be retried.
 *
 * Note the bucket has versioning disabled, so this is a real delete and not a
 * delete marker. If versioning is ever turned on, this needs to delete
 * versions too.
 */
export async function deleteObjects(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const { client, bucket } = getS3();

  for (let i = 0; i < keys.length; i += DELETE_BATCH_SIZE) {
    const batch = keys.slice(i, i + DELETE_BATCH_SIZE);
    const response = await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
      })
    );

    // Quiet mode still returns per-key errors; only successes are suppressed.
    if (response.Errors && response.Errors.length > 0) {
      throw new Error(
        `S3 failed to delete ${response.Errors.length} of ${batch.length} objects ` +
          `(first: ${response.Errors[0].Code ?? "unknown"}).`
      );
    }
  }
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
