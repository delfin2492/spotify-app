import fs from "fs";
import path from "path";

// Cache untuk menyimpan access token, refresh token, & antrean (queue)
export interface QueuedTrackItem {
  queueId: string;
  id: string;
  uri: string;
  name: string;
  artists: { name: string }[];
  album: {
    name: string;
    images: { url: string }[];
  };
  duration_ms: number;
}

export const tokenCache = {
  accessToken: null as string | null,
  refreshToken: null as string | null,
  expiresAt: 0,
  customQueue: [] as QueuedTrackItem[],
  customQueueInitialized: false,
};

const TMP_QUEUE_FILE = "/tmp/.vantara-queue.json";
const LOCAL_QUEUE_FILE = path.join(process.cwd(), ".vantara-queue.json");

export function loadPersistedQueue(): {
  queue: QueuedTrackItem[];
  initialized: boolean;
} {
  try {
    const fileToRead = fs.existsSync(TMP_QUEUE_FILE)
      ? TMP_QUEUE_FILE
      : fs.existsSync(LOCAL_QUEUE_FILE)
      ? LOCAL_QUEUE_FILE
      : null;

    if (fileToRead) {
      const raw = fs.readFileSync(fileToRead, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.queue)) {
        tokenCache.customQueue = parsed.queue;
        tokenCache.customQueueInitialized = Boolean(parsed.initialized);
        return {
          queue: tokenCache.customQueue,
          initialized: tokenCache.customQueueInitialized,
        };
      }
    }
  } catch {}

  return {
    queue: tokenCache.customQueue,
    initialized: tokenCache.customQueueInitialized,
  };
}

export function savePersistedQueue(queue: QueuedTrackItem[], initialized = true) {
  tokenCache.customQueue = queue;
  tokenCache.customQueueInitialized = initialized;
  const payload = JSON.stringify({ queue, initialized });
  try {
    fs.writeFileSync(TMP_QUEUE_FILE, payload, "utf8");
  } catch {}
  try {
    fs.writeFileSync(LOCAL_QUEUE_FILE, payload, "utf8");
  } catch {}
}
