// Cache sederhana untuk menyimpan access token, refresh token, & antrean (queue) di memori server
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

