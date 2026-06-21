import type { JobSource } from "./types";
import { adzunaSource } from "./adzuna";

/**
 * Registry of every available job board source.
 *
 * To add a new source (e.g. JSearch), implement the {@link JobSource} interface
 * in its own file and append it to this array. Nothing else in the system needs
 * to change — ingestion iterates over whatever is registered here.
 */
export const jobSources: JobSource[] = [adzunaSource];

export * from "./types";
