import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { Db, StorageBucket } from "../src/db.js";
import type { LogFields } from "../src/log.js";
import { runMaintenance, type MaintenanceDeps } from "../src/maintenance.js";
import type { Embedding } from "../src/model.js";
import type { PageImage, PageImages } from "../src/pdf.js";
import {
  PHOTO_BACKFILL_BATCH,
  PHOTO_BACKFILL_CONCURRENCY,
  PHOTO_BACKFILL_PASSES,
  backfillOne,
  photoBackfillPass,
  primaryDocumentOf,
  unreadReasonOf,
  type PageImagesReader,
  type PhotoBackfillDeps,
  type PhotoDb,
} from "../src/photo-backfill.js";
import { PNG_SIGNATURE } from "../src/png.js";
import type { ExtractionMethod, PhotoCandidateRow, PhotoDocumentRow } from "../src/types.js";

const ORG = "11111111-1111-4111-8111-111111111111";
const NOW = "2026-10-15T10:00:00.000Z";
/** An A4 page's width in points, the unit of a PDF image's drawn width. */
const A4 = 595;

/** What a fake CV holds, and what the fake reader answers for it. */
const PORTRAIT_PDF = Buffer.from("a cv with a portrait on page 1");
const BLANK_PDF = Buffer.from("a cv with a logo and nothing else");
const BROKEN_PDF = Buffer.from("not a pdf at all");

function candidateId(index: number): string {
  return `44444444-4444-4444-8444-${String(index).padStart(12, "0")}`;
}

function documentId(index: number): string {
  return `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`;
}

/** One processed document of a candidate, as the listing answers it, with its bytes in the fake bucket. */
interface FakeDocument {
  bytes: Buffer;
  extraction_method?: ExtractionMethod | null;
  processed_at?: string;
  status?: PhotoDocumentRow["status"];
}

interface FakeCandidate {
  id: string;
  org_id: string;
  photo_path: string | null;
  checked_at: string | null;
  documents: PhotoDocumentRow[];
}

/** The five methods the pass uses, over a map of candidates and two fake buckets. */
class FakePhotoDb implements PhotoDb {
  readonly candidates = new Map<string, FakeCandidate>();
  /** The `cvs` bucket. */
  readonly objects = new Map<string, Buffer>();
  /** The `photos` bucket. */
  readonly photos = new Map<string, { bytes: Uint8Array; contentType: string }>();
  /** The limit of each listing asked. */
  readonly listings: number[] = [];
  /** How many times each candidate was listed. */
  readonly listed = new Map<string, number>();
  readonly downloads: string[] = [];
  /** Keys whose download fails. */
  readonly brokenKeys = new Set<string>();
  /** When true, every write to the `photos` bucket fails. */
  failUploads = false;
  /** When true, the database refuses both marks. */
  failMarks = false;
  private counter = 0;

  addCandidate(documents: FakeDocument[], photoPath: string | null = null): FakeCandidate {
    this.counter += 1;
    const id = candidateId(this.counter);
    const rows = documents.map((document, position) => {
      this.counter += 1;
      const row: PhotoDocumentRow = {
        id: documentId(this.counter),
        storage_path: `${ORG}/${documentId(this.counter)}.pdf`,
        status: document.status ?? "processed",
        extraction_method:
          document.extraction_method === undefined ? "pdf-text" : document.extraction_method,
        processed_at:
          document.processed_at ??
          `2026-10-${String(10 - position).padStart(2, "0")}T10:00:00.000Z`,
      };
      this.objects.set(row.storage_path, document.bytes);
      return row;
    });
    const candidate: FakeCandidate = {
      id,
      org_id: ORG,
      photo_path: photoPath,
      checked_at: null,
      documents: rows,
    };
    this.candidates.set(id, candidate);
    return candidate;
  }

  async listCandidatesForPhoto(limit: number): Promise<PhotoCandidateRow[]> {
    this.listings.push(limit);
    const out: PhotoCandidateRow[] = [];
    for (const candidate of this.candidates.values()) {
      if (out.length >= limit) break;
      if (candidate.photo_path !== null || candidate.checked_at !== null) continue;
      const documents = candidate.documents
        .filter((document) => document.status === "processed")
        .sort((a, b) => (b.processed_at ?? "").localeCompare(a.processed_at ?? ""));
      if (documents.length === 0) continue;
      this.listed.set(candidate.id, (this.listed.get(candidate.id) ?? 0) + 1);
      out.push({ id: candidate.id, org_id: candidate.org_id, documents });
    }
    return out;
  }

  async markPhotoChecked(id: string): Promise<void> {
    if (this.failMarks) throw new Error("database down");
    const candidate = this.candidates.get(id);
    if (!candidate) throw new Error(`candidate ${id} missing`);
    candidate.checked_at = NOW;
  }

  async setPhotoPath(id: string, path: string): Promise<void> {
    if (this.failMarks) throw new Error("database down");
    const candidate = this.candidates.get(id);
    if (!candidate) throw new Error(`candidate ${id} missing`);
    candidate.photo_path = path;
    candidate.checked_at = NOW;
  }

  async downloadObject(path: string): Promise<Buffer> {
    this.downloads.push(path);
    if (this.brokenKeys.has(path)) throw new Error("storage down");
    const bytes = this.objects.get(path);
    if (!bytes) throw new Error(`object ${path} missing`);
    return bytes;
  }

  async uploadObject(
    bucket: StorageBucket,
    path: string,
    bytes: Uint8Array,
    contentType: string,
  ): Promise<void> {
    if (bucket !== "photos") throw new Error(`unexpected upload to ${bucket}`);
    if (this.failUploads) throw new Error("bucket refused the file");
    this.photos.set(path, { bytes, contentType });
  }

  /** The candidates with a photo. */
  withPhoto(): FakeCandidate[] {
    return [...this.candidates.values()].filter((candidate) => candidate.photo_path !== null);
  }

  /** The candidates the pass has not settled. */
  unchecked(): FakeCandidate[] {
    return [...this.candidates.values()].filter((candidate) => candidate.checked_at === null);
  }
}

/** A flat image of one colour. */
function image(width: number, height: number, key: string): PageImage {
  return { key, width, height, channels: 3, data: new Uint8Array(width * height * 3).fill(90) };
}

const PORTRAIT = image(120, 160, "portrait");
const LOGO = image(600, 120, "logo");

function pageOf(images: PageImage[]): PageImages {
  return { pageWidth: A4, images };
}

/** Lets the other worker run, so the reads in flight can be counted. */
function tick(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

/** The fake reader: a portrait for PORTRAIT_PDF, a logo alone for BLANK_PDF, an error for BROKEN_PDF; counts what is in flight. */
function readerOf(): { read: PageImagesReader; inFlight: () => number; maxInFlight: () => number } {
  let inFlight = 0;
  let max = 0;
  const read: PageImagesReader = async (buffer, _context) => {
    inFlight += 1;
    max = Math.max(max, inFlight);
    try {
      await tick();
      if (buffer.equals(BROKEN_PDF)) throw new Error("Invalid PDF structure");
      return pageOf(buffer.equals(PORTRAIT_PDF) ? [LOGO, PORTRAIT] : [LOGO]);
    } finally {
      inFlight -= 1;
    }
  };
  return { read, inFlight: () => inFlight, maxInFlight: () => max };
}

function depsOf(db: FakePhotoDb, overrides: Partial<PhotoBackfillDeps> = {}): PhotoBackfillDeps {
  return { db, pageImages: readerOf().read, ...overrides };
}

/** 120 candidates without a photo: 40 with a portrait, 60 without, 20 scanned CVs. */
function pool(db: FakePhotoDb): { portraits: string[]; blanks: string[]; scans: string[] } {
  const portraits: string[] = [];
  const blanks: string[] = [];
  const scans: string[] = [];
  for (let i = 0; i < 120; i++) {
    if (i % 3 === 0) {
      portraits.push(db.addCandidate([{ bytes: PORTRAIT_PDF }]).id);
    } else if (i % 6 === 2 || i % 6 === 4) {
      blanks.push(db.addCandidate([{ bytes: BLANK_PDF }]).id);
    } else if (i % 6 === 1) {
      blanks.push(db.addCandidate([{ bytes: BLANK_PDF }]).id);
    } else {
      scans.push(db.addCandidate([{ bytes: BLANK_PDF, extraction_method: "ocr" }]).id);
    }
  }
  return { portraits, blanks, scans };
}

/** The photo pass's row for a candidate of the fake. */
function rowOf(candidate: FakeCandidate): PhotoCandidateRow {
  return { id: candidate.id, org_id: candidate.org_id, documents: candidate.documents };
}

function pngSize(bytes: Uint8Array): [number, number] {
  const buffer = Buffer.from(bytes);
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
}

beforeAll(() => {
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe("primaryDocumentOf and unreadReasonOf", () => {
  it("takes the newest document read from its text layer, whatever the listing's order", () => {
    const db = new FakePhotoDb();
    const candidate = db.addCandidate([
      { bytes: BLANK_PDF, processed_at: "2026-10-01T10:00:00.000Z" },
      { bytes: PORTRAIT_PDF, processed_at: "2026-10-09T10:00:00.000Z" },
      { bytes: BLANK_PDF, extraction_method: "ocr", processed_at: "2026-10-12T10:00:00.000Z" },
      { bytes: BLANK_PDF, extraction_method: "none", processed_at: "2026-10-14T10:00:00.000Z" },
    ]);
    const [oldest, newest] = [candidate.documents[0], candidate.documents[1]];
    expect(primaryDocumentOf(rowOf(candidate))?.id).toBe(newest?.id);
    expect(
      primaryDocumentOf({ ...rowOf(candidate), documents: [...candidate.documents].reverse() })?.id,
    ).toBe(newest?.id);
    // A method never written (a row older than the column) is read: pdf.js will say.
    const unknown: PhotoDocumentRow[] = oldest ? [{ ...oldest, extraction_method: null }] : [];
    expect(primaryDocumentOf({ ...rowOf(candidate), documents: unknown })?.id).toBe(oldest?.id);
  });

  it("answers null, and why, when the CVs are scans or copies read under another row", () => {
    const db = new FakePhotoDb();
    const scanned = db.addCandidate([
      { bytes: BLANK_PDF, extraction_method: "ocr" },
      { bytes: BLANK_PDF, extraction_method: "none" },
    ]);
    expect(primaryDocumentOf(rowOf(scanned))).toBeNull();
    expect(unreadReasonOf(rowOf(scanned))).toBe("scanned");
    const copy = db.addCandidate([{ bytes: BLANK_PDF, extraction_method: "none" }]);
    expect(primaryDocumentOf(rowOf(copy))).toBeNull();
    expect(unreadReasonOf(rowOf(copy))).toBe("unread");
    // A document that is not processed is never read, whatever its method.
    const failed = db.addCandidate([{ bytes: PORTRAIT_PDF, status: "failed" }]);
    expect(primaryDocumentOf(rowOf(failed))).toBeNull();
  });
});

describe("backfillOne", () => {
  it("writes the portrait of page 1 as a PNG and names it on the row, with no name in the reader's context", async () => {
    const db = new FakePhotoDb();
    const candidate = db.addCandidate([{ bytes: PORTRAIT_PDF }]);
    const document = candidate.documents[0];
    const reader = readerOf();
    const read = vi.fn(reader.read);
    expect(await backfillOne(depsOf(db, { pageImages: read }), rowOf(candidate))).toBe("found");
    const path = `${ORG}/${candidate.id}.png`;
    expect(candidate.photo_path).toBe(path);
    expect(candidate.checked_at).toBe(NOW);
    const stored = db.photos.get(path);
    expect(stored?.contentType).toBe("image/png");
    expect(Array.from((stored?.bytes ?? new Uint8Array()).subarray(0, 8))).toEqual(
      Array.from(PNG_SIGNATURE),
    );
    expect(pngSize(stored?.bytes ?? new Uint8Array())).toEqual([120, 160]);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0]?.[0]).toBe(PORTRAIT_PDF);
    expect(read.mock.calls[0]?.[1]).toEqual({
      candidateId: candidate.id,
      orgId: ORG,
      documentId: document?.id,
    });
  });

  it("marks a CV without a portrait checked, and a scan without even a download", async () => {
    const db = new FakePhotoDb();
    const blank = db.addCandidate([{ bytes: BLANK_PDF }]);
    const scan = db.addCandidate([{ bytes: BLANK_PDF, extraction_method: "ocr" }]);
    expect(await backfillOne(depsOf(db), rowOf(blank))).toBe("none");
    expect(await backfillOne(depsOf(db), rowOf(scan))).toBe("none");
    expect(blank.checked_at).toBe(NOW);
    expect(scan.checked_at).toBe(NOW);
    expect(db.withPhoto()).toEqual([]);
    expect(db.downloads).toEqual([blank.documents[0]?.storage_path]);
    expect(db.photos.size).toBe(0);
  });

  it("settles a failed download, a failed read and a failed upload as checked, so none is read again", async () => {
    const db = new FakePhotoDb();
    const missing = db.addCandidate([{ bytes: PORTRAIT_PDF }]);
    db.brokenKeys.add(missing.documents[0]?.storage_path ?? "");
    const broken = db.addCandidate([{ bytes: BROKEN_PDF }]);
    const refused = db.addCandidate([{ bytes: PORTRAIT_PDF }]);
    expect(await backfillOne(depsOf(db), rowOf(missing))).toBe("failed");
    expect(await backfillOne(depsOf(db), rowOf(broken))).toBe("failed");
    db.failUploads = true;
    expect(await backfillOne(depsOf(db), rowOf(refused))).toBe("failed");
    for (const candidate of [missing, broken, refused]) {
      expect(candidate.checked_at).toBe(NOW);
      expect(candidate.photo_path).toBeNull();
    }
    expect(db.photos.size).toBe(0);
    expect(await db.listCandidatesForPhoto(10)).toEqual([]);
  });

  it("leaves a row the database refused to mark for the next pass, the file already in the bucket", async () => {
    const db = new FakePhotoDb();
    const candidate = db.addCandidate([{ bytes: PORTRAIT_PDF }]);
    const blank = db.addCandidate([{ bytes: BLANK_PDF }]);
    db.failMarks = true;
    expect(await backfillOne(depsOf(db), rowOf(candidate))).toBe("unsettled");
    expect(await backfillOne(depsOf(db), rowOf(blank))).toBe("unsettled");
    expect(candidate.photo_path).toBeNull();
    expect(candidate.checked_at).toBeNull();
    expect(db.photos.has(`${ORG}/${candidate.id}.png`)).toBe(true);
    expect((await db.listCandidatesForPhoto(10)).map((row) => row.id)).toEqual([
      candidate.id,
      blank.id,
    ]);
    // The next pass reads the CV again and writes the key.
    db.failMarks = false;
    expect(await backfillOne(depsOf(db), rowOf(candidate))).toBe("found");
    expect(candidate.photo_path).toBe(`${ORG}/${candidate.id}.png`);
  });
});

describe("photoBackfillPass", () => {
  it("checks 50 candidates a batch, two CVs at a time, settles the 120 in three batches and never lists a checked row again", async () => {
    const db = new FakePhotoDb();
    const { portraits, blanks, scans } = pool(db);
    expect([portraits.length, blanks.length, scans.length]).toEqual([40, 60, 20]);
    const reader = readerOf();
    const report = await photoBackfillPass(depsOf(db, { pageImages: reader.read }));
    expect(report).toEqual({ photosChecked: 120, photosFound: 40, photosFailed: 0 });
    expect(db.listings).toEqual([PHOTO_BACKFILL_BATCH, PHOTO_BACKFILL_BATCH, PHOTO_BACKFILL_BATCH]);
    expect(PHOTO_BACKFILL_BATCH).toBe(50);
    expect(db.unchecked()).toEqual([]);
    expect([...db.listed.values()].every((count) => count === 1)).toBe(true);
    expect(db.listed.size).toBe(120);
    // Every portrait is in the bucket under the candidate's key, and nothing else is.
    expect(
      db
        .withPhoto()
        .map((candidate) => candidate.id)
        .sort(),
    ).toEqual([...portraits].sort());
    expect([...db.photos.keys()].sort()).toEqual(portraits.map((id) => `${ORG}/${id}.png`).sort());
    for (const { bytes, contentType } of db.photos.values()) {
      expect(contentType).toBe("image/png");
      expect(Array.from(bytes.subarray(0, 8))).toEqual(Array.from(PNG_SIGNATURE));
    }
    // The scans were settled without a download: 100 CVs read, two in flight, never three.
    expect(db.downloads).toHaveLength(100);
    expect(reader.maxInFlight()).toBe(PHOTO_BACKFILL_CONCURRENCY);
    expect(PHOTO_BACKFILL_CONCURRENCY).toBe(2);
    expect(reader.inFlight()).toBe(0);
  });

  it("survives a download failure and a broken file, counts them and goes on with the others", async () => {
    const db = new FakePhotoDb();
    const first = db.addCandidate([{ bytes: PORTRAIT_PDF }]);
    const missing = db.addCandidate([{ bytes: PORTRAIT_PDF }]);
    db.brokenKeys.add(missing.documents[0]?.storage_path ?? "");
    const broken = db.addCandidate([{ bytes: BROKEN_PDF }]);
    const last = db.addCandidate([{ bytes: PORTRAIT_PDF }]);
    const blank = db.addCandidate([{ bytes: BLANK_PDF }]);
    const report = await photoBackfillPass(depsOf(db));
    expect(report).toEqual({ photosChecked: 5, photosFound: 2, photosFailed: 2 });
    expect(db.withPhoto().map((candidate) => candidate.id)).toEqual([first.id, last.id]);
    expect(db.unchecked()).toEqual([]);
    expect([missing, broken, blank].every((candidate) => candidate.photo_path === null)).toBe(true);
    expect(db.listings).toEqual([PHOTO_BACKFILL_BATCH]);
  });

  it("lists at most `passes` batches a run and takes the rest up next run", async () => {
    const db = new FakePhotoDb();
    pool(db);
    const one = await photoBackfillPass(depsOf(db, { passes: 1 }));
    expect(one.photosChecked).toBe(50);
    expect(db.listings).toEqual([50]);
    expect(db.unchecked()).toHaveLength(70);
    const two = await photoBackfillPass(depsOf(db, { passes: 1 }));
    expect(two.photosChecked).toBe(50);
    expect(db.unchecked()).toHaveLength(20);
    const three = await photoBackfillPass(depsOf(db, { passes: 1 }));
    expect(three.photosChecked).toBe(20);
    expect(db.unchecked()).toHaveLength(0);
    // Nothing left: one empty listing, nothing read, nothing counted.
    const downloads = db.downloads.length;
    const four = await photoBackfillPass(depsOf(db, { passes: 1 }));
    expect(four).toEqual({ photosChecked: 0, photosFound: 0, photosFailed: 0 });
    expect(db.listings).toHaveLength(4);
    expect(db.downloads).toHaveLength(downloads);
    expect([...db.listed.values()].every((count) => count === 1)).toBe(true);
    expect(PHOTO_BACKFILL_PASSES).toBe(25);
  });

  it("stops rather than spin when the database refuses every mark, and settles the rows next run", async () => {
    const db = new FakePhotoDb();
    for (let i = 0; i < 60; i++) db.addCandidate([{ bytes: BLANK_PDF }]);
    db.failMarks = true;
    const refused = await photoBackfillPass(depsOf(db));
    expect(refused).toEqual({ photosChecked: 0, photosFound: 0, photosFailed: 50 });
    expect(db.listings).toEqual([50]);
    expect(db.unchecked()).toHaveLength(60);
    db.failMarks = false;
    const settled = await photoBackfillPass(depsOf(db));
    expect(settled).toEqual({ photosChecked: 60, photosFound: 0, photosFailed: 0 });
    expect(db.listings).toEqual([50, 50, 50]);
    expect(db.unchecked()).toHaveLength(0);
  });

  it("gives up the run, with nothing counted, when the listing itself fails", async () => {
    const db = new FakePhotoDb();
    db.addCandidate([{ bytes: PORTRAIT_PDF }]);
    db.listCandidatesForPhoto = async () => {
      throw new Error("database down");
    };
    expect(await photoBackfillPass(depsOf(db))).toEqual({
      photosChecked: 0,
      photosFound: 0,
      photosFailed: 0,
    });
    expect(db.downloads).toEqual([]);
  });
});

/** A Db for runMaintenance: the photo pass's methods over the fake, the purge's over one expired candidate, the rest unused. */
function fullDb(photos: FakePhotoDb, expired: string[]): Db & { deleted: string[] } {
  const unused = (): Promise<never> => Promise.reject(new Error("not a method of the photo pass"));
  const deleted: string[] = [];
  return {
    deleted,
    claimDocument: unused,
    listQueued: unused,
    countQueued: unused,
    resetStale: async () => ({ requeued: 0, failed: 0 }),
    getDocument: unused,
    updateDocument: unused,
    findDocumentBySha256: unused,
    findCandidateByFingerprint: unused,
    findCandidateByEmail: unused,
    findCandidateByPhoneDigits: unused,
    getCandidateById: async () => null,
    listCandidatesWithoutEmbedding: async () => [],
    insertCandidate: unused,
    updateCandidate: unused,
    getOrganization: unused,
    cvsProcessedThisMonth: unused,
    expiredCandidates: async () =>
      expired.map((candidate_id) => ({ candidate_id, org_id: ORG, reason: "retention" })),
    listDocumentsOfCandidate: async () => [],
    deleteCandidate: async (id) => {
      deleted.push(id);
      photos.candidates.delete(id);
    },
    recordUsage: unused,
    downloadObject: (path) => photos.downloadObject(path),
    uploadObject: (bucket, path, bytes, contentType) =>
      photos.uploadObject(bucket, path, bytes, contentType),
    removeObjects: async () => undefined,
    claimAnalyses: unused,
    getSearch: unused,
    patchSearch: unused,
    getBrief: unused,
    patchBrief: unused,
    startTriage: unused,
    listTriage: unused,
    countTriage: unused,
    recordTriage: unused,
    recordScreen: unused,
    bumpAttempts: unused,
    loadProfiles: unused,
    mergeResults: unused,
    getResults: unused,
    listShortlistItemsFor: unused,
    patchShortlistItemMatch: unused,
    listCandidatesForPhoto: (limit) => photos.listCandidatesForPhoto(limit),
    markPhotoChecked: (id) => photos.markPhotoChecked(id),
    setPhotoPath: (id, path) => photos.setPhotoPath(id, path),
  };
}

describe("runMaintenance with the photo pass", () => {
  it("runs the pass after the purge, reports its counts, and touches no model and no usage row", async () => {
    const photos = new FakePhotoDb();
    const kept = photos.addCandidate([{ bytes: PORTRAIT_PDF }]);
    const leaving = photos.addCandidate([{ bytes: PORTRAIT_PDF }]);
    const blank = photos.addCandidate([{ bytes: BLANK_PDF }]);
    const scan = photos.addCandidate([{ bytes: BLANK_PDF, extraction_method: "ocr" }]);
    const db = fullDb(photos, [leaving.id]);
    const embed = vi.fn(async (_text: string): Promise<Embedding> => {
      throw new Error("the photo pass must not embed");
    });
    const recordUsage = vi.fn(async (): Promise<void> => undefined);
    const read = vi.fn(readerOf().read);
    const deps: MaintenanceDeps = {
      db,
      now: () => new Date(NOW),
      embed,
      recordUsage,
      embeddingModel: "mistral-embed",
      pageImages: read,
    };
    const report = await runMaintenance(deps);
    expect(report).toMatchObject({
      ranAt: NOW,
      purged: 1,
      reembedded: 0,
      photosChecked: 3,
      photosFound: 1,
      photosFailed: 0,
    });
    // The person who left was never read: their CV is not among the downloads.
    expect(db.deleted).toEqual([leaving.id]);
    expect(photos.downloads).toEqual([
      kept.documents[0]?.storage_path,
      blank.documents[0]?.storage_path,
    ]);
    expect(kept.photo_path).toBe(`${ORG}/${kept.id}.png`);
    expect([blank.checked_at, scan.checked_at]).toEqual([NOW, NOW]);
    expect(embed).not.toHaveBeenCalled();
    expect(recordUsage).not.toHaveBeenCalled();
    // The reader sees bytes and ids, never a name, a contact or a model.
    for (const call of read.mock.calls) {
      expect(Object.keys(call[1] as LogFields).sort()).toEqual([
        "candidateId",
        "documentId",
        "orgId",
      ]);
    }
  });

  it("answers zero counts when nothing is pending", async () => {
    const photos = new FakePhotoDb();
    photos.addCandidate([{ bytes: PORTRAIT_PDF }], `${ORG}/already.png`);
    const report = await runMaintenance({
      db: fullDb(photos, []),
      now: () => new Date(NOW),
      embed: null,
      recordUsage: async () => undefined,
      pageImages: readerOf().read,
    });
    expect(report).toMatchObject({ photosChecked: 0, photosFound: 0, photosFailed: 0 });
    expect(photos.downloads).toEqual([]);
  });
});
