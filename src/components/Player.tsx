"use client";
import { useEffect, useState, useRef, useCallback } from "react";
import { useSession, signIn, signOut } from "next-auth/react";

interface SpotifyDevice {
  id: string;
  is_active: boolean;
  is_private_session: boolean;
  is_restricted: boolean;
  name: string;
  type: string;
  volume_percent: number;
}

interface NowPlaying {
  trackId?: string;
  trackUri?: string;
  album: string;
  albumId?: string;
  albumImageUrl: string;
  artist: string;
  artistId?: string;
  artists?: { id: string; name: string }[];
  isPlaying: boolean;
  songUrl: string;
  title: string;
  progressMs: number;
  durationMs: number;
  shuffleState?: boolean;
  repeatState?: "off" | "track" | "context";
  device?: SpotifyDevice | null;
}

interface SyncedLyricLine {
  timeMs: number;
  text: string;
}

interface LyricsData {
  found: boolean;
  instrumental: boolean;
  syncedLyrics: SyncedLyricLine[];
  plainLyrics: string;
  source?: string;
}

type ActiveTab = "home" | "search" | "liked" | "queue" | "playlist" | "album" | "artist" | "focus" | "lyrics";

export default function Player() {
  const { data: session, status } = useSession();

  // PIN Auth State (PIN: 2016 -> Mode GeoLab)
  const [pinAuthenticated, setPinAuthenticated] = useState<boolean>(false);
  const [authMode, setAuthMode] = useState<"geolab" | "admin">("geolab");
  const [pinInput, setPinInput] = useState<string>("");
  const [pinError, setPinError] = useState<string>("");
  const [checkingPinStorage, setCheckingPinStorage] = useState<boolean>(true);

  // Playback State
  const [data, setData] = useState<NowPlaying | null>(null);
  const [localProgress, setLocalProgress] = useState<number>(0);
  const [isSeeking, setIsSeeking] = useState<boolean>(false);
  const [volume, setVolume] = useState<number>(70);

  // Navigation & View State
  const [activeTab, setActiveTab] = useState<ActiveTab>("home");
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);

  // Browse / Home Data
  const [topTracks, setTopTracks] = useState<any[]>([]);
  const [topArtists, setTopArtists] = useState<any[]>([]);
  const [recentTracks, setRecentTracks] = useState<any[]>([]);
  const [playlists, setPlaylists] = useState<any[]>([]);
  const [likedTracks, setLikedTracks] = useState<any[]>([]);
  const [queueData, setQueueData] = useState<{
    currently_playing: any;
    queue: any[];
    spotify_queue?: any[];
  }>({
    currently_playing: null,
    queue: [],
    spotify_queue: [],
  });
  const [devices, setDevices] = useState<SpotifyDevice[]>([]);
  const [showDevicesMenu, setShowDevicesMenu] = useState<boolean>(false);

  // Selected Playlist / Album / Artist Detail + Right Panel
  const [selectedPlaylist, setSelectedPlaylist] = useState<any | null>(null);
  const [selectedAlbum, setSelectedAlbum] = useState<any | null>(null);
  const [selectedArtist, setSelectedArtist] = useState<{
    artist: any;
    topTracks: any[];
    albums: any[];
  } | null>(null);
  const [loadingDetail, setLoadingDetail] = useState<boolean>(false);
  const [playlistFilter, setPlaylistFilter] = useState<string>("");
  const [playlistSort, setPlaylistSort] = useState<"default" | "title" | "artist" | "duration">("default");
  const [rightSidebarMode, setRightSidebarMode] = useState<"now-playing" | "queue" | "lyrics" | "closed">("now-playing");
  const [previousVolume, setPreviousVolume] = useState<number>(70);

  // Search State
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [searchFilter, setSearchFilter] = useState<"all" | "tracks" | "albums" | "artists" | "playlists">("all");
  const [searchResults, setSearchResults] = useState<{
    tracks: any[];
    artists: any[];
    albums: any[];
    playlists: any[];
  }>({ tracks: [], artists: [], albums: [], playlists: [] });
  const [isSearching, setIsSearching] = useState<boolean>(false);

  // Modals (Create Playlist & Add Track to Playlist)
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [newPlaylistName, setNewPlaylistName] = useState<string>("");
  const [newPlaylistDesc, setNewPlaylistDesc] = useState<string>("");
  const [trackToAdd, setTrackToAdd] = useState<any | null>(null);

  // Web Playback SDK State
  const [webPlayerDeviceId, setWebPlayerDeviceId] = useState<string | null>(null);
  const [webPlayerReady, setWebPlayerReady] = useState<boolean>(false);
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);
  const playerRef = useRef<any>(null);

  // Lyrics State
  const [lyrics, setLyrics] = useState<LyricsData | null>(null);
  const [loadingLyrics, setLoadingLyrics] = useState<boolean>(false);
  const [autoScrollLyrics, setAutoScrollLyrics] = useState<boolean>(true);
  const [focusShowLyrics, setFocusShowLyrics] = useState<boolean>(true);
  const lyricsContainerRef = useRef<HTMLDivElement | null>(null);
  const activeLyricRef = useRef<HTMLDivElement | null>(null);
  const lastFetchedTrackKeyRef = useRef<string>("");

  // Toast Notification
  const [toast, setToast] = useState<{ message: string; type?: "success" | "error" | "info" } | null>(null);

  const showToast = useCallback((message: string, type: "success" | "error" | "info" = "success") => {
    setToast({ message, type });
    setTimeout(() => {
      setToast((prev) => (prev?.message === message ? null : prev));
    }, 3500);
  }, []);

  // Fetch Now Playing
  const fetchNowPlaying = useCallback(async () => {
    try {
      const res = await fetch("/api/spotify/now-playing");
      if (res.ok) {
        const json = await res.json();
        setData(json);
        if (!isSeeking && typeof json.progressMs === "number") {
          setLocalProgress(json.progressMs);
        }
        if (json.device?.volume_percent !== undefined) {
          setVolume(json.device.volume_percent);
        }
      }
    } catch (e) {
      console.error("Failed to fetch now playing", e);
    }
  }, [isSeeking]);

  // Fetch User Playlists (Filtered to GeoLab only when in PIN / GeoLab mode)
  const fetchPlaylists = useCallback(async () => {
    try {
      const query = authMode === "geolab" ? "?mode=geolab" : "";
      const res = await fetch(`/api/spotify/playlists${query}`);
      if (res.ok) {
        const json = await res.json();
        const rawList = json.items || [];
        if (authMode === "geolab") {
          setPlaylists(
            rawList.filter((pl: any) => (pl.name || "").toLowerCase().includes("geolab"))
          );
        } else {
          setPlaylists(rawList);
        }
      }
    } catch (e) {
      console.error("Failed to fetch playlists", e);
    }
  }, [authMode]);

  // Fetch Home Data & Initialize Web Playback SDK
  const fetchHomeAndInitSdk = useCallback(async () => {
    try {
      const res = await fetch("/api/spotify/browse?section=home");
      if (res.ok) {
        const json = await res.json();
        setTopTracks(json.topTracks || []);
        setTopArtists(json.topArtists || []);
        setRecentTracks(json.recentTracks || []);

        if (json.accessToken && typeof window !== "undefined" && !playerRef.current) {
          initWebPlaybackSDK(json.accessToken);
        }
      }
    } catch (e) {
      console.error("Failed to fetch home data", e);
    }
  }, []);

  // Fetch Queue (Uses localStorage as the authoritative source of truth in the browser to prevent multi-container/serverless desync)
  const saveLocalQueue = useCallback((queueList: any[]) => {
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("vantara_custom_queue", JSON.stringify(queueList));
      } catch {}
    }
  }, []);

  const fetchQueue = useCallback(async () => {
    try {
      const res = await fetch("/api/spotify/queue");
      if (res.ok) {
        const json = await res.json();
        const serverQueue = Array.isArray(json.queue) ? json.queue : [];
        const spotifyNativeQueue = Array.isArray(json.spotify_queue) ? json.spotify_queue : [];

        let authoritativeQueue = serverQueue;
        if (typeof window !== "undefined") {
          const savedRaw = localStorage.getItem("vantara_custom_queue");
          if (savedRaw !== null) {
            try {
              const parsedLocal = JSON.parse(savedRaw);
              if (Array.isArray(parsedLocal)) {
                authoritativeQueue = parsedLocal;
              }
            } catch {}
          } else if (serverQueue.length > 0) {
            saveLocalQueue(serverQueue);
          }
        }

        // If the song that just started playing on Spotify is the first item in our authoritativeQueue, pop it automatically!
        const currentUri = json.currently_playing?.uri;
        if (
          currentUri &&
          authoritativeQueue.length > 0 &&
          authoritativeQueue[0]?.uri === currentUri
        ) {
          authoritativeQueue = authoritativeQueue.slice(1);
          saveLocalQueue(authoritativeQueue);
          fetch("/api/spotify/queue", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "replace", queue: authoritativeQueue }),
          }).catch(() => {});
        }

        setQueueData({
          currently_playing: json.currently_playing || null,
          queue: authoritativeQueue,
          spotify_queue: spotifyNativeQueue,
        });
      }
    } catch (e) {}
  }, [saveLocalQueue]);

  // Fetch Devices
  const fetchDevices = useCallback(async () => {
    try {
      const res = await fetch("/api/spotify/devices");
      if (res.ok) {
        const json = await res.json();
        setDevices(json.devices || []);
      }
    } catch (e) {}
  }, []);

  // Fetch Liked Songs
  const fetchLikedSongs = useCallback(async () => {
    try {
      const res = await fetch("/api/spotify/browse?section=liked");
      if (res.ok) {
        const json = await res.json();
        setLikedTracks(json.items || []);
      }
    } catch (e) {}
  }, []);

  // Initialize Spotify Web Playback SDK in Browser
  const initWebPlaybackSDK = (token: string) => {
    if ((window as any).Spotify) {
      createWebPlayer(token);
      return;
    }

    const scriptTag = document.getElementById("spotify-player-sdk");
    if (!scriptTag) {
      const script = document.createElement("script");
      script.id = "spotify-player-sdk";
      script.src = "https://sdk.scdn.co/spotify-player.js";
      script.async = true;
      document.body.appendChild(script);
    }

    (window as any).onSpotifyWebPlaybackSDKReady = () => {
      createWebPlayer(token);
    };
  };

  const createWebPlayer = (token: string) => {
    if (playerRef.current) return;
    const Spotify = (window as any).Spotify;
    if (!Spotify) return;

    const player = new Spotify.Player({
      name: "Vantara Web Player",
      getOAuthToken: async (cb: (t: string) => void) => {
        try {
          const res = await fetch("/api/spotify/browse?section=home");
          if (res.ok) {
            const j = await res.json();
            if (j.accessToken) {
              cb(j.accessToken);
              return;
            }
          }
        } catch {}
        cb(token);
      },
      volume: 0.7,
    });

    player.addListener("ready", ({ device_id }: { device_id: string }) => {
      setWebPlayerDeviceId(device_id);
      setWebPlayerReady(true);
      fetchDevices();
    });

    player.addListener("not_ready", () => {
      setWebPlayerReady(false);
    });

    player.addListener("player_state_changed", (state: any) => {
      if (!state) return;
      const currentTrack = state.track_window?.current_track;
      if (currentTrack) {
        setData((prev) => ({
          ...prev,
          trackId: currentTrack.id,
          trackUri: currentTrack.uri,
          title: currentTrack.name,
          artist: currentTrack.artists.map((a: any) => a.name).join(", "),
          album: currentTrack.album.name,
          albumImageUrl: currentTrack.album.images?.[0]?.url || "",
          songUrl: `https://open.spotify.com/track/${currentTrack.id}`,
          isPlaying: !state.paused,
          progressMs: state.position,
          durationMs: state.duration,
          shuffleState: state.shuffle,
          repeatState: state.repeat_mode === 2 ? "track" : state.repeat_mode === 1 ? "context" : "off",
        }));
        setLocalProgress(state.position);
      }
    });

    player.connect();
    playerRef.current = player;
  };

  // Check stored PIN session on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedPin = localStorage.getItem("vantara_pin_auth");
      const savedMode = localStorage.getItem("vantara_auth_mode");
      if (savedPin === "2016") {
        setPinAuthenticated(true);
        setAuthMode("geolab");
      } else if (savedMode === "admin") {
        setAuthMode("admin");
      }
      setCheckingPinStorage(false);
    }
  }, []);

  // Initial Load & Polling (works with PIN login OR Spotify session)
  useEffect(() => {
    if (session && (session as any).refreshToken) {
      fetch("/api/spotify/register-token", {
        method: "POST",
        body: JSON.stringify({ refreshToken: (session as any).refreshToken }),
      });
    }

    if (!pinAuthenticated && !session) return;

    fetchNowPlaying();
    fetchPlaylists();
    fetchHomeAndInitSdk();
    fetchDevices();
    fetchQueue();

    const interval = setInterval(fetchNowPlaying, 3000);
    return () => clearInterval(interval);
  }, [pinAuthenticated, session, fetchNowPlaying, fetchPlaylists, fetchHomeAndInitSdk, fetchDevices, fetchQueue]);

  // Smooth 250ms local progress bar timer when playing (for responsive synced lyrics & seek bar)
  useEffect(() => {
    if (!data?.isPlaying || isSeeking) return;
    const timer = setInterval(() => {
      setLocalProgress((prev) => {
        if (prev + 250 <= (data.durationMs || 0)) {
          return prev + 250;
        }
        return prev;
      });
    }, 250);
    return () => clearInterval(timer);
  }, [data?.isPlaying, data?.durationMs, isSeeking]);

  // Fetch Lyrics automatically whenever the current song changes
  const fetchLyricsForTrack = useCallback(
    async (title?: string, artist?: string, album?: string, durationMs?: number) => {
      if (!title) {
        setLyrics(null);
        return;
      }
      setLoadingLyrics(true);
      try {
        const params = new URLSearchParams({
          title,
          artist: artist || "",
          album: album || "",
          durationMs: String(durationMs || 0),
        });
        const res = await fetch(`/api/spotify/lyrics?${params.toString()}`);
        if (res.ok) {
          const json: LyricsData = await res.json();
          setLyrics(json);
        } else {
          setLyrics({ found: false, instrumental: false, syncedLyrics: [], plainLyrics: "" });
        }
      } catch (e) {
        console.error("Failed to fetch lyrics", e);
        setLyrics({ found: false, instrumental: false, syncedLyrics: [], plainLyrics: "" });
      } finally {
        setLoadingLyrics(false);
      }
    },
    []
  );

  useEffect(() => {
    if (!data?.title) return;
    const trackKey = `${data.trackId || ""}|${data.title}|${data.artist || ""}`;
    if (lastFetchedTrackKeyRef.current === trackKey) return;
    lastFetchedTrackKeyRef.current = trackKey;
    fetchLyricsForTrack(data.title, data.artist, data.album, data.durationMs);
    fetchQueue();
  }, [data?.trackId, data?.title, data?.artist, data?.album, data?.durationMs, fetchLyricsForTrack, fetchQueue]);

  // Calculate active synced lyric line index based on localProgress
  const activeLyricIndex = (() => {
    if (!lyrics?.syncedLyrics || lyrics.syncedLyrics.length === 0) return -1;
    let idx = -1;
    for (let i = 0; i < lyrics.syncedLyrics.length; i++) {
      if (localProgress + 200 >= lyrics.syncedLyrics[i].timeMs) {
        idx = i;
      } else {
        break;
      }
    }
    return idx;
  })();

  // Auto-scroll active lyric line into center of container
  useEffect(() => {
    if (!autoScrollLyrics) return;
    if (activeTab !== "lyrics" && !(activeTab === "focus" && focusShowLyrics)) return;
    if (activeLyricIndex >= 0 && activeLyricRef.current) {
      activeLyricRef.current.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  }, [activeLyricIndex, activeTab, autoScrollLyrics, focusShowLyrics]);

  // Live Search Debounce
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults({ tracks: [], artists: [], albums: [], playlists: [] });
      return;
    }
    const handler = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await fetch(`/api/spotify/search?q=${encodeURIComponent(searchQuery)}&limit=10`);
        if (res.ok) {
          const json = await res.json();
          setSearchResults({
            tracks: json.tracks || [],
            artists: json.artists || [],
            albums: json.albums || [],
            playlists: json.playlists || [],
          });
        } else {
          showToast("Gagal mencari lagu. Coba klik Keluar lalu Masuk kembali.", "error");
        }
      } catch (e) {
        console.error("Search error", e);
      } finally {
        setIsSearching(false);
      }
    }, 400);

    return () => clearTimeout(handler);
  }, [searchQuery]);

  // Load Tab Specific Data
  useEffect(() => {
    if (!pinAuthenticated && !session) return;
    if (activeTab === "queue") fetchQueue();
    if (activeTab === "liked") fetchLikedSongs();
  }, [activeTab, pinAuthenticated, session, fetchQueue, fetchLikedSongs]);

  // Helper to convert Spotify URI (spotify:track:xxx) into Embed URL
  const uriToEmbedUrl = (uri?: string) => {
    if (!uri) return null;
    const parts = uri.split(":");
    if (parts.length >= 3) {
      const type = parts[1]; // track, playlist, album
      const id = parts[2];
      return `https://open.spotify.com/embed/${type}/${id}?utm_source=generator&theme=0`;
    }
    return null;
  };

  // Unified Playback Control Handler
  const handleControl = async (
    action: string,
    options?: {
      value?: any;
      uris?: string[];
      context_uri?: string;
      offset?: any;
      deviceId?: string;
      uri?: string;
      queueUris?: string[];
    }
  ) => {
    try {
      // Unlock browser audio context for Web Playback SDK if available
      if (playerRef.current?.activateElement) {
        try {
          playerRef.current.activateElement();
        } catch {}
      }

      // If playing a song/playlist and no active device exists, automatically use browser Web Player if ready
      let targetDeviceId = options?.deviceId;
      if (!targetDeviceId && action === "play" && !data?.device?.id && webPlayerDeviceId) {
        targetDeviceId = webPlayerDeviceId;
      }

      const currentQueueUris =
        options?.queueUris ?? queueData.queue.map((item) => item?.uri).filter(Boolean);

      const res = await fetch("/api/spotify/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          value: options?.value,
          uris: options?.uris,
          context_uri: options?.context_uri,
          offset: options?.offset,
          deviceId: targetDeviceId,
          uri: options?.uri,
          queueUris: currentQueueUris,
        }),
      });

      if (res.status === 401) {
        showToast("Sesi/Izin Spotify perlu diperbarui oleh Admin.", "error");
        return;
      }

      if (res.status === 404) {
        // Fallback: If no active Spotify Connect device is open on HP/PC, open built-in Browser Embed Player!
        const targetUri =
          options?.offset?.uri ||
          options?.uris?.[0] ||
          options?.context_uri ||
          data?.trackUri;
        const fallbackEmbed = uriToEmbedUrl(targetUri);
        if (fallbackEmbed) {
          setEmbedUrl(fallbackEmbed);
          showToast(
            "Aplikasi Spotify tidak aktif di HP/PC — Memutar langsung lewat Pemutar Web Browser!",
            "info"
          );
          return;
        }
        showToast(
          "Tidak ada perangkat Spotify aktif. Buka aplikasi Spotify di HP/PC atau pilih lagu dari daftar untuk diputar di browser!",
          "error"
        );
        return;
      }

      // If Spotify Connect succeeded, hide fallback embed
      if (action === "play" && res.ok) {
        setEmbedUrl(null);
      }

      if (action === "queue") {
        showToast("Lagu ditambahkan ke antrean!", "success");
        fetchQueue();
      } else if (action === "next") {
        if (queueData.queue.length > 0) {
          const popped = queueData.queue.slice(1);
          setQueueData((prev) => ({ ...prev, queue: popped }));
          saveLocalQueue(popped);
        } else {
          fetchQueue();
        }
      } else if (action === "transfer") {
        showToast("Pemutaran dipindahkan ke perangkat terpilih", "info");
        fetchDevices();
      }

      setTimeout(() => {
        fetchNowPlaying();
      }, 450);
    } catch (error) {
      console.error("Control error:", error);
      showToast("Gagal mengirim perintah ke Spotify", "error");
    }
  };

  // Synchronize our Managed Queue directly into Spotify's live playback engine
  // so when the current song finishes naturally, Spotify 100% plays the exact #1 song in our Queue!
  const syncQueueToSpotifyEngine = useCallback(
    async (updatedQueueList: any[]) => {
      if (!data?.trackUri || !data?.isPlaying) return;
      const queueUris = updatedQueueList.map((item) => item?.uri).filter(Boolean);
      const combinedUris = [data.trackUri, ...queueUris].slice(0, 100);
      try {
        await fetch("/api/spotify/control", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "sync-playback-queue",
            uris: combinedUris,
            positionMs: localProgress,
            deviceId: data?.device?.id || webPlayerDeviceId || undefined,
          }),
        });
      } catch {}
    },
    [data?.trackUri, data?.isPlaying, data?.device?.id, webPlayerDeviceId, localProgress]
  );

  // CRUD Antrean (Managed Queue)
  const handleAddToQueue = async (trackOrUri: any, position: "bottom" | "top" = "bottom") => {
    try {
      const payload =
        typeof trackOrUri === "string"
          ? { uri: trackOrUri, position }
          : { track: trackOrUri, uri: trackOrUri?.uri, position };

      const res = await fetch("/api/spotify/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const json = await res.json();
        const updated = json.queue || queueData.queue;
        setQueueData((prev) => ({
          ...prev,
          queue: updated,
        }));
        saveLocalQueue(updated);
        syncQueueToSpotifyEngine(updated);
        showToast(
          position === "top"
            ? "Ditambahkan ke urutan #1 antrean berikutnya!"
            : "Lagu ditambahkan ke antrean!",
          "success"
        );
      } else {
        showToast("Gagal menambahkan lagu ke antrean", "error");
      }
    } catch {
      showToast("Gagal menambahkan ke antrean", "error");
    }
  };

  const handleRemoveFromQueue = async (queueId?: string, index?: number) => {
    const optimistic = queueData.queue.filter((it, idx) =>
      queueId ? it.queueId !== queueId : idx !== index
    );
    setQueueData((prev) => ({ ...prev, queue: optimistic }));
    saveLocalQueue(optimistic);
    syncQueueToSpotifyEngine(optimistic);

    try {
      const res = await fetch("/api/spotify/queue", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queueId, index }),
      });
      if (res.ok) {
        const json = await res.json();
        const updated = json.queue || optimistic;
        setQueueData((prev) => ({ ...prev, queue: updated }));
        saveLocalQueue(updated);
        showToast("Lagu dihapus dari antrean", "info");
      }
    } catch {
      showToast("Gagal menghapus lagu dari antrean", "error");
    }
  };

  const handleClearQueue = async () => {
    setQueueData((prev) => ({ ...prev, queue: [] }));
    saveLocalQueue([]);
    syncQueueToSpotifyEngine([]);

    try {
      const res = await fetch("/api/spotify/queue", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clearAll: true }),
      });
      if (res.ok) {
        showToast("Seluruh antrean berhasil dikosongkan", "info");
      }
    } catch {
      showToast("Gagal mengosongkan antrean", "error");
    }
  };

  const handleMoveInQueue = async (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= queueData.queue.length) return;
    // Optimistically update UI, localStorage, and Spotify playback engine immediately
    const optimistic = [...queueData.queue];
    const [moved] = optimistic.splice(fromIndex, 1);
    optimistic.splice(toIndex, 0, moved);
    setQueueData((prev) => ({ ...prev, queue: optimistic }));
    saveLocalQueue(optimistic);
    syncQueueToSpotifyEngine(optimistic);

    try {
      const res = await fetch("/api/spotify/queue", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "move", fromIndex, toIndex }),
      });
      if (res.ok) {
        const json = await res.json();
        const updated = json.queue || optimistic;
        setQueueData((prev) => ({ ...prev, queue: updated }));
        saveLocalQueue(updated);
      }
    } catch {
      showToast("Gagal mengubah urutan antrean", "error");
    }
  };

  const handleDeduplicateQueue = async () => {
    try {
      const res = await fetch("/api/spotify/queue", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deduplicate" }),
      });
      if (res.ok) {
        const json = await res.json();
        const updated = json.queue || [];
        setQueueData((prev) => ({ ...prev, queue: updated }));
        saveLocalQueue(updated);
        syncQueueToSpotifyEngine(updated);
        showToast("Lagu duplikat di antrean berhasil dibersihkan!", "success");
      }
    } catch {
      showToast("Gagal membersihkan duplikat", "error");
    }
  };

  // Play a specific item from inside the Queue (removes that item from Queue and keeps all other queued tracks in exact order!)
  const handlePlayFromQueue = async (index: number) => {
    const target = queueData.queue[index];
    if (!target) return;

    const remainingQueue = queueData.queue.filter((_, idx) => idx !== index);
    setQueueData((prev) => ({ ...prev, queue: remainingQueue }));
    saveLocalQueue(remainingQueue);

    await fetch("/api/spotify/queue", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ queueId: target.queueId, index }),
    });

    // Play target song and pass remainingQueue URIs explicitly
    handleControl("play", {
      uris: [target.uri],
      queueUris: remainingQueue.map((item) => item?.uri).filter(Boolean),
    });
  };

  // Play a specific track WITHOUT wiping out the existing queue!
  // Even when clicking a song inside a Playlist or Album, we play its URI (backed by our customQueue)
  // so that the user's queue is preserved and never replaced by the whole playlist/album unless "Putar Playlist" is clicked.
  const playTrack = (trackUri: string, _contextUri?: string) => {
    handleControl("play", {
      uris: [trackUri],
      queueUris: queueData.queue.map((item) => item?.uri).filter(Boolean),
    });
  };

  // Play an entire playlist or album (and populate customQueue with its tracks in exact order!)
  const playContext = async (contextUri: string, tracksList?: any[]) => {
    if (Array.isArray(tracksList) && tracksList.length > 0) {
      const firstTrack = tracksList[0];
      const restTracks = tracksList.slice(1);
      const res = await fetch("/api/spotify/queue", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "replace",
          queue: restTracks,
        }),
      });
      if (res.ok) {
        const json = await res.json();
        const updated = json.queue || restTracks;
        setQueueData((prev) => ({ ...prev, queue: updated }));
        saveLocalQueue(updated);
      }
      if (firstTrack?.uri) {
        handleControl("play", {
          uris: [firstTrack.uri],
          queueUris: restTracks.map((t: any) => t?.uri).filter(Boolean),
        });
        return;
      }
    }
    handleControl("play", { context_uri: contextUri });
  };

  // Open Playlist Detail
  const openPlaylist = async (playlistId: string) => {
    setLoadingDetail(true);
    setActiveTab("playlist");
    try {
      const res = await fetch(`/api/spotify/playlists?id=${encodeURIComponent(playlistId)}`);
      if (res.ok) {
        const json = await res.json();
        setSelectedPlaylist(json);
      }
    } catch (e) {
      showToast("Gagal memuat detail playlist", "error");
    } finally {
      setLoadingDetail(false);
    }
  };

  // Open Album Detail
  const openAlbum = async (albumId: string) => {
    if (!albumId) return;
    setLoadingDetail(true);
    setActiveTab("album");
    try {
      const res = await fetch(`/api/spotify/playlists?albumId=${encodeURIComponent(albumId)}`);
      if (res.ok) {
        const json = await res.json();
        setSelectedAlbum(json);
      }
    } catch (e) {
      showToast("Gagal memuat detail album", "error");
    } finally {
      setLoadingDetail(false);
    }
  };

  // Open Artist Profile Detail (Spotify Artist Page)
  const openArtist = async (artistId: string) => {
    if (!artistId) return;
    setLoadingDetail(true);
    setActiveTab("artist");
    try {
      const res = await fetch(`/api/spotify/browse?artistId=${encodeURIComponent(artistId)}`);
      if (res.ok) {
        const json = await res.json();
        setSelectedArtist({
          artist: json.artist,
          topTracks: json.topTracks || [],
          albums: json.albums || [],
        });
      }
    } catch (e) {
      showToast("Gagal memuat profil artis", "error");
    } finally {
      setLoadingDetail(false);
    }
  };

  // Toggle Mute / Unmute like Spotify Desktop
  const handleToggleMute = () => {
    if (volume > 0) {
      setPreviousVolume(volume);
      setVolume(0);
      handleControl("volume", { value: 0 });
    } else {
      const restored = previousVolume > 0 ? previousVolume : 70;
      setVolume(restored);
      handleControl("volume", { value: restored });
    }
  };

  // Global Keyboard Shortcuts (Space = Play/Pause when not typing in input)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!pinAuthenticated) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) {
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        handleControl(data?.isPlaying ? "pause" : "play");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pinAuthenticated, data?.isPlaying]);

  // Create New Playlist
  const handleCreatePlaylist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlaylistName.trim()) return;
    try {
      const res = await fetch("/api/spotify/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          name: newPlaylistName.trim(),
          description: newPlaylistDesc.trim(),
          isPublic: false,
        }),
      });
      if (res.ok) {
        const created = await res.json();
        showToast(`Playlist "${created.name}" berhasil dibuat!`, "success");
        setNewPlaylistName("");
        setNewPlaylistDesc("");
        setShowCreateModal(false);
        fetchPlaylists();
        if (created.id) openPlaylist(created.id);
      } else {
        showToast("Gagal membuat playlist. Pastikan sudah login ulang untuk izin playlist.", "error");
      }
    } catch (e) {
      showToast("Terjadi kesalahan saat membuat playlist", "error");
    }
  };

  // Add Track to Playlist
  const handleAddTrackToPlaylist = async (playlistId: string, trackUri: string, playlistName: string) => {
    try {
      const res = await fetch("/api/spotify/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add-tracks",
          playlistId,
          uris: [trackUri],
        }),
      });
      if (res.ok) {
        showToast(`Ditambahkan ke playlist "${playlistName}"`, "success");
        setTrackToAdd(null);
        if (selectedPlaylist?.id === playlistId) {
          openPlaylist(playlistId);
        }
      } else {
        showToast("Gagal menambahkan lagu ke playlist", "error");
      }
    } catch (e) {
      showToast("Gagal menambahkan lagu", "error");
    }
  };

  // Remove Track from Playlist
  const handleRemoveTrackFromPlaylist = async (playlistId: string, trackUri: string) => {
    try {
      const res = await fetch("/api/spotify/playlists", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playlistId, uri: trackUri }),
      });
      if (res.ok) {
        showToast("Lagu dihapus dari playlist", "info");
        openPlaylist(playlistId);
      } else {
        showToast("Gagal menghapus lagu dari playlist", "error");
      }
    } catch (e) {
      showToast("Gagal menghapus lagu", "error");
    }
  };

  // Save / Remove Liked Song
  const handleToggleLike = async (trackId: string, action: "save" | "remove" = "save") => {
    try {
      const res = await fetch("/api/spotify/browse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackId, action }),
      });
      if (res.ok) {
        showToast(
          action === "save" ? "Disimpan ke Lagu yang Disukai ♥" : "Dihapus dari Lagu yang Disukai",
          "success"
        );
        if (activeTab === "liked") fetchLikedSongs();
      }
    } catch {}
  };

  // Cycle Repeat Mode: off -> context -> track
  const handleCycleRepeat = () => {
    const current = data?.repeatState || "off";
    const nextState = current === "off" ? "context" : current === "context" ? "track" : "off";
    handleControl("repeat", { value: nextState });
  };

  // Handle PIN 2016 Login
  const handlePinLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (pinInput.trim() === "2016") {
      localStorage.setItem("vantara_pin_auth", "2016");
      localStorage.setItem("vantara_auth_mode", "geolab");
      setAuthMode("geolab");
      setPinAuthenticated(true);
      setPinError("");
      setPinInput("");
    } else {
      setPinError("Kode PIN salah! Silakan coba lagi.");
    }
  };

  // Handle Logout (clears PIN session and returns to PIN Login screen)
  const handleLogout = () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem("vantara_pin_auth");
      localStorage.removeItem("vantara_auth_mode");
    }
    setPinAuthenticated(false);
    setPinInput("");
    if (session && authMode === "admin") {
      signOut({ redirect: false });
    }
  };

  // Helper to quickly initialize GeoLab playlist if not found
  const handleInitGeoLabPlaylist = async () => {
    try {
      const res = await fetch("/api/spotify/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          name: "GeoLab",
          description: "Playlist Resmi GeoLab - Vantara Music Platform",
          isPublic: false,
        }),
      });
      if (res.ok) {
        const created = await res.json();
        showToast('Playlist "GeoLab" berhasil dibuat!', "success");
        fetchPlaylists();
        if (created.id) openPlaylist(created.id);
      } else {
        showToast("Gagal membuat playlist GeoLab. Pastikan Admin sudah login Spotify sekali.", "error");
      }
    } catch {
      showToast("Gagal membuat playlist GeoLab", "error");
    }
  };

  if (status === "loading" || checkingPinStorage) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-[#09090b] text-white">
        <div className="w-12 h-12 border-4 border-t-[#1DB954] border-zinc-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!pinAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[100dvh] bg-gradient-to-b from-[#121212] to-black text-white p-6">
        <div className="w-full max-w-sm bg-[#18181b] border border-white/10 rounded-3xl p-8 shadow-2xl flex flex-col items-center">
          <div className="w-16 h-16 mb-5 bg-[#1DB954] rounded-full flex items-center justify-center shadow-[0_0_35px_rgba(29,185,84,0.4)]">
            <svg viewBox="0 0 24 24" fill="black" className="w-9 h-9">
              <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm4.586 14.424c-.18.295-.563.387-.857.207-2.35-1.434-5.305-1.76-8.786-.963-.335.077-.67-.133-.746-.47-.077-.334.132-.67.47-.745 3.808-.87 7.076-.496 9.712 1.115.293.18.386.563.207.856zm1.268-2.834c-.226.367-.714.48-1.08.254-2.686-1.65-6.78-2.13-9.965-1.166-.41.127-.84-.105-.966-.516-.126-.41.106-.84.516-.965 3.65-1.108 8.19-.57 11.24 1.312.368.226.482.714.255 1.08zm.106-2.953C14.73 8.71 8.544 8.5 4.98 9.584c-.496.15-1.01-.132-1.16-.628-.15-.495.13-1.01.627-1.16 4.103-1.245 10.957-1.002 14.88 1.328.448.266.595.845.33 1.293-.264.448-.844.595-1.293.33z" />
            </svg>
          </div>
          <span className="text-[11px] font-bold uppercase tracking-widest text-[#1DB954] mb-1">
            GeoLab Music Access
          </span>
          <h1 className="text-2xl font-extrabold mb-2 text-center tracking-tight">
            Vantara Music Platform
          </h1>
          <p className="text-zinc-400 text-center mb-6 text-xs">
            Masukkan kode PIN untuk mengakses pemutar musik & playlist <b>GeoLab</b>.
          </p>

          <form onSubmit={handlePinLogin} className="w-full space-y-4">
            <div>
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                autoFocus
                value={pinInput}
                onChange={(e) => {
                  setPinInput(e.target.value);
                  if (pinError) setPinError("");
                }}
                placeholder="• • • •"
                className="w-full bg-zinc-900 border border-white/15 focus:border-[#1DB954] rounded-2xl py-3.5 px-4 text-center text-2xl font-mono tracking-[0.5em] text-white outline-none transition-all"
              />
              {pinError && (
                <p className="text-red-400 text-xs text-center mt-2 font-medium">{pinError}</p>
              )}
            </div>

            <button
              type="submit"
              className="w-full bg-[#1DB954] hover:bg-[#1ed760] text-black font-bold py-3.5 rounded-full transition-all duration-200 hover:scale-[1.02] active:scale-95 shadow-lg cursor-pointer"
            >
              Masuk dengan PIN
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-white/10 w-full flex flex-col items-center gap-2">
            {session ? (
              <button
                onClick={() => {
                  localStorage.setItem("vantara_pin_auth", "2016");
                  localStorage.setItem("vantara_auth_mode", "admin");
                  setAuthMode("admin");
                  setPinAuthenticated(true);
                }}
                className="text-[11px] text-zinc-400 hover:text-white underline cursor-pointer"
              >
                Masuk sebagai Admin Pemilik (Tampilkan Semua Playlist)
              </button>
            ) : null}
            <button
              onClick={() => signIn("spotify")}
              className="text-[11px] text-zinc-500 hover:text-[#1DB954] transition-colors cursor-pointer"
            >
              ⚙️ Admin: Sinkronkan / Hubungkan Akun Spotify
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] w-full bg-black text-white flex flex-col overflow-hidden select-none font-sans">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed top-5 right-5 z-50 px-5 py-3 rounded-xl shadow-2xl border text-sm font-semibold flex items-center gap-2.5 transition-all ${
            toast.type === "error"
              ? "bg-red-950/95 border-red-500/40 text-red-200"
              : toast.type === "info"
              ? "bg-zinc-900/95 border-zinc-700 text-white"
              : "bg-emerald-950/95 border-[#1DB954]/50 text-emerald-200"
          }`}
        >
          <span className="w-2 h-2 rounded-full bg-[#1DB954] animate-pulse" />
          <span>{toast.message}</span>
        </div>
      )}

      {/* Main Workspace (Sidebar + Main View) */}
      <div className="flex-1 flex overflow-hidden p-2 gap-2">
        {/* Left Sidebar */}
        <aside
          className={`${
            mobileMenuOpen ? "fixed inset-y-0 left-0 z-40 w-72 p-2 bg-black" : "hidden md:flex"
          } md:w-64 lg:w-72 flex-col gap-2 h-full shrink-0`}
        >
          {/* Primary Nav Box */}
          <div className="bg-[#121212] rounded-xl p-4 flex flex-col gap-1">
            <div className="flex items-center justify-between px-2 mb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-[#1DB954] flex items-center justify-center text-black font-black">
                  V
                </div>
                <div>
                  <span className="font-bold text-base tracking-tight block leading-none">
                    Vantara Music
                  </span>
                  <span className="text-[10px] text-[#1DB954] uppercase tracking-widest font-semibold">
                    Spotify Platform
                  </span>
                </div>
              </div>
              {mobileMenuOpen && (
                <button
                  onClick={() => setMobileMenuOpen(false)}
                  className="md:hidden text-zinc-400 hover:text-white p-1"
                >
                  ✕
                </button>
              )}
            </div>

            <button
              onClick={() => {
                setActiveTab("home");
                setMobileMenuOpen(false);
              }}
              className={`flex items-center gap-3.5 px-3 py-2.5 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${
                activeTab === "home"
                  ? "bg-white/10 text-white"
                  : "text-zinc-400 hover:text-white hover:bg-white/5"
              }`}
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 3l9 8h-3v9h-5v-6H11v6H6v-9H3l9-8z" />
              </svg>
              <span>Beranda</span>
            </button>

            <button
              onClick={() => {
                setActiveTab("search");
                setMobileMenuOpen(false);
              }}
              className={`flex items-center gap-3.5 px-3 py-2.5 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${
                activeTab === "search"
                  ? "bg-white/10 text-white"
                  : "text-zinc-400 hover:text-white hover:bg-white/5"
              }`}
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
              </svg>
              <span>Cari & Tambah Lagu</span>
            </button>

            <button
              onClick={() => {
                setActiveTab("liked");
                setMobileMenuOpen(false);
              }}
              className={`flex items-center gap-3.5 px-3 py-2.5 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${
                activeTab === "liked"
                  ? "bg-white/10 text-white"
                  : "text-zinc-400 hover:text-white hover:bg-white/5"
              }`}
            >
              <svg className="w-5 h-5 text-[#1DB954]" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
              </svg>
              <span>Lagu yang Disukai</span>
            </button>

            <button
              onClick={() => {
                setActiveTab("queue");
                setMobileMenuOpen(false);
              }}
              className={`flex items-center gap-3.5 px-3 py-2.5 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${
                activeTab === "queue"
                  ? "bg-white/10 text-white"
                  : "text-zinc-400 hover:text-white hover:bg-white/5"
              }`}
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z" />
              </svg>
              <span>Antrean Musik</span>
            </button>

            <button
              onClick={() => {
                setActiveTab("focus");
                setMobileMenuOpen(false);
              }}
              className={`flex items-center gap-3.5 px-3 py-2.5 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${
                activeTab === "focus"
                  ? "bg-white/10 text-[#1DB954]"
                  : "text-zinc-400 hover:text-white hover:bg-white/5"
              }`}
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
              </svg>
              <span>Mode Live Player</span>
            </button>

            <button
              onClick={() => {
                setActiveTab("lyrics");
                setMobileMenuOpen(false);
              }}
              className={`flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${
                activeTab === "lyrics"
                  ? "bg-white/10 text-[#1DB954]"
                  : "text-zinc-400 hover:text-white hover:bg-white/5"
              }`}
            >
              <div className="flex items-center gap-3.5">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.49 3 2.89 5.35 5.91 5.78V20H9c-.55 0-1 .45-1 1s.45 1 1 1h6c.55 0 1-.45 1-1s-.45-1-1-1h-2v-2.08c3.02-.43 5.42-2.78 5.91-5.78.1-.6-.39-1.14-1-1.14z" />
                </svg>
                <span>Lirik Lagu</span>
              </div>
              {lyrics?.syncedLyrics && lyrics.syncedLyrics.length > 0 && (
                <span className="text-[9px] font-bold uppercase tracking-wider bg-[#1DB954]/20 text-[#1DB954] px-1.5 py-0.5 rounded">
                  Sync
                </span>
              )}
            </button>
          </div>

          {/* Playlists Library Box */}
          <div className="bg-[#121212] rounded-xl p-4 flex-1 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between mb-3 px-1">
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                {authMode === "geolab" ? "Playlist GeoLab" : `Playlist Anda (${playlists.length})`}
              </span>
              {authMode === "admin" && (
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="text-xs bg-white/10 hover:bg-[#1DB954] hover:text-black text-white font-semibold px-2.5 py-1 rounded-full transition-colors cursor-pointer"
                  title="Buat Playlist Baru"
                >
                  + Buat
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
              {playlists.map((pl) => (
                <button
                  key={pl.id}
                  onClick={() => {
                    openPlaylist(pl.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 p-2 rounded-lg text-left transition-colors cursor-pointer ${
                    activeTab === "playlist" && selectedPlaylist?.id === pl.id
                      ? "bg-white/15 text-white"
                      : "hover:bg-white/5 text-zinc-300"
                  }`}
                >
                  <img
                    src={pl.images?.[0]?.url || "https://placehold.co/80x80/27272a/white?text=♪"}
                    alt={pl.name}
                    className="w-10 h-10 rounded object-cover shrink-0 bg-zinc-800"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate text-white">{pl.name}</p>
                    <p className="text-xs text-zinc-500 truncate">
                      {pl.tracks?.total ?? 0} lagu • {pl.owner?.display_name || "GeoLab"}
                    </p>
                  </div>
                </button>
              ))}

              {playlists.length === 0 && authMode === "geolab" && (
                <div className="p-3 bg-white/[0.03] rounded-xl border border-white/5 text-center space-y-2">
                  <p className="text-xs text-zinc-400">
                    Playlist <b>GeoLab</b> belum ditemukan di akun Spotify.
                  </p>
                  <button
                    onClick={handleInitGeoLabPlaylist}
                    className="w-full bg-[#1DB954] hover:bg-[#1ed760] text-black text-xs font-bold py-2 px-3 rounded-lg transition-colors cursor-pointer"
                  >
                    + Buat Playlist GeoLab
                  </button>
                </div>
              )}
            </div>
          </div>
        </aside>

        {/* Main Content View */}
        <main className="flex-1 bg-gradient-to-b from-[#1e1e24] via-[#121212] to-[#121212] rounded-xl overflow-y-auto flex flex-col relative">
          {/* Sticky Top Bar */}
          <header className="sticky top-0 z-20 backdrop-blur-md bg-[#121212]/75 px-4 sm:px-6 py-3.5 flex items-center justify-between gap-3 border-b border-white/5">
            <div className="flex items-center gap-3 flex-1 max-w-xl">
              <button
                onClick={() => setMobileMenuOpen(true)}
                className="md:hidden p-2 rounded-lg bg-white/10 text-white"
              >
                ☰
              </button>

              {/* Global Quick Search Input */}
              <div className="relative flex-1">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    if (activeTab !== "search") setActiveTab("search");
                  }}
                  onFocus={() => {
                    if (searchQuery.trim()) setActiveTab("search");
                  }}
                  placeholder="Cari lagu, artis, atau album untuk diputar / ditambah..."
                  className="w-full bg-zinc-800/90 hover:bg-zinc-800 focus:bg-zinc-800 text-sm text-white rounded-full py-2.5 pl-10 pr-9 outline-none focus:ring-2 focus:ring-[#1DB954] transition-all"
                />
                <svg
                  className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
                </svg>
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white text-xs"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              <span className="hidden lg:inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-full bg-[#1DB954]/15 text-[#1DB954] border border-[#1DB954]/30">
                {authMode === "geolab" ? "🔒 Mode PIN: GeoLab" : "👑 Mode Admin"}
              </span>

              {/* Web Browser Audio Activator */}
              {webPlayerReady && webPlayerDeviceId && (
                <button
                  onClick={() => handleControl("transfer", { deviceId: webPlayerDeviceId })}
                  className={`hidden sm:flex items-center gap-2 text-xs font-semibold px-3.5 py-2 rounded-full border transition-all cursor-pointer ${
                    data?.device?.id === webPlayerDeviceId
                      ? "bg-[#1DB954]/20 border-[#1DB954] text-[#1DB954]"
                      : "bg-white/5 hover:bg-white/10 border-white/10 text-zinc-300"
                  }`}
                  title="Putar suara musik langsung di tab browser ini"
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      data?.device?.id === webPlayerDeviceId ? "bg-[#1DB954] animate-ping" : "bg-zinc-400"
                    }`}
                  />
                  <span>
                    {data?.device?.id === webPlayerDeviceId ? "Audio Browser Aktif" : "Putar di Browser Ini"}
                  </span>
                </button>
              )}

              <button
                onClick={handleLogout}
                className="text-xs font-semibold bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-full transition-colors cursor-pointer"
              >
                Keluar
              </button>
            </div>
          </header>

          {/* Dynamic Body Content */}
          <div className="p-4 sm:p-6 flex-1">
            {/* TAB: HOME */}
            {activeTab === "home" && (
              <div className="space-y-8">
                {/* Spotify Time-of-Day Greeting + Quick Access */}
                <section>
                  <h2 className="text-2xl sm:text-3xl font-extrabold mb-4 tracking-tight">
                    {(() => {
                      const h = new Date().getHours();
                      if (h < 11) return "Selamat Pagi";
                      if (h < 15) return "Selamat Siang";
                      if (h < 18) return "Selamat Sore";
                      return "Selamat Malam";
                    })()}
                  </h2>

                  {playlists.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {playlists.slice(0, 6).map((pl) => (
                        <div
                          key={pl.id}
                          onClick={() => openPlaylist(pl.id)}
                          className="group bg-white/5 hover:bg-white/15 transition-all rounded-lg flex items-center overflow-hidden cursor-pointer pr-3"
                        >
                          <img
                            src={pl.images?.[0]?.url || "https://placehold.co/80x80/27272a/white?text=♪"}
                            alt={pl.name}
                            className="w-16 h-16 object-cover shrink-0 shadow-md"
                          />
                          <span className="font-bold text-sm px-3.5 truncate flex-1">{pl.name}</span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              playContext(pl.uri);
                            }}
                            className="w-10 h-10 rounded-full bg-[#1DB954] text-black flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all shadow-lg hover:scale-105 shrink-0 cursor-pointer"
                            title="Putar Playlist"
                          >
                            <svg className="w-5 h-5 translate-x-0.5" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M8 5v14l11-7z" />
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {/* Top Artists Section (Spotify Round Cards) */}
                {topArtists.length > 0 && (
                  <section>
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h2 className="text-xl font-bold">Artis Teratas Anda</h2>
                        <p className="text-xs text-zinc-400">Klik artis untuk melihat lagu populer & diskografi album</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
                      {topArtists.slice(0, 6).map((artist) => (
                        <div
                          key={artist.id}
                          onClick={() => openArtist(artist.id)}
                          className="bg-[#181818] hover:bg-[#282828] transition-all p-4 rounded-xl group cursor-pointer flex flex-col items-center text-center"
                        >
                          <div className="relative w-28 h-28 sm:w-32 sm:h-32 rounded-full overflow-hidden mb-3 shadow-xl">
                            <img
                              src={artist.images?.[0]?.url || "https://placehold.co/200x200/27272a/white?text=Artis"}
                              alt={artist.name}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            />
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                playContext(artist.uri);
                              }}
                              className="absolute bottom-1.5 right-1.5 w-10 h-10 rounded-full bg-[#1DB954] text-black flex items-center justify-center opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 transition-all shadow-xl hover:scale-105 cursor-pointer"
                              title={`Putar lagu ${artist.name}`}
                            >
                              <svg className="w-5 h-5 translate-x-0.5" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M8 5v14l11-7z" />
                              </svg>
                            </button>
                          </div>
                          <h3 className="font-bold text-sm truncate w-full text-white">{artist.name}</h3>
                          <p className="text-[11px] text-zinc-400 mt-0.5">Artis</p>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Top Tracks Section */}
                <section>
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h2 className="text-xl font-bold">Lagu Teratas Anda</h2>
                      <p className="text-xs text-zinc-400">Klik lagu untuk langsung memutar atau tambahkan ke antrean/playlist</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
                    {topTracks.map((track) => (
                      <div
                        key={track.id}
                        className="bg-[#181818] hover:bg-[#282828] transition-all p-3.5 rounded-xl group flex flex-col justify-between"
                      >
                        <div>
                          <div className="relative aspect-square rounded-lg overflow-hidden mb-3 shadow-lg">
                            <img
                              src={track.album?.images?.[0]?.url || ""}
                              alt={track.name}
                              onClick={() => playTrack(track.uri)}
                              className="w-full h-full object-cover cursor-pointer"
                            />
                            <button
                              onClick={() => playTrack(track.uri)}
                              className="absolute bottom-2 right-2 w-11 h-11 rounded-full bg-[#1DB954] text-black flex items-center justify-center opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 transition-all shadow-xl hover:scale-105 cursor-pointer"
                              title="Putar Sekarang"
                            >
                              <svg className="w-5 h-5 translate-x-0.5" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M8 5v14l11-7z" />
                              </svg>
                            </button>
                          </div>
                          <h3
                            onClick={() => playTrack(track.uri)}
                            className="font-semibold text-sm truncate text-white hover:underline cursor-pointer"
                            title={track.name}
                          >
                            {track.name}
                          </h3>
                          <p
                            onClick={() => track.artists?.[0]?.id && openArtist(track.artists[0].id)}
                            className="text-xs text-zinc-400 hover:text-white hover:underline truncate mt-0.5 cursor-pointer"
                          >
                            {track.artists?.map((a: any) => a.name).join(", ")}
                          </p>
                        </div>

                        <div className="flex items-center justify-between gap-1 mt-3 pt-2 border-t border-white/5">
                          <button
                            onClick={() => handleAddToQueue(track)}
                            className="text-[11px] text-zinc-400 hover:text-white bg-white/5 hover:bg-white/10 px-2 py-1 rounded transition-colors cursor-pointer"
                            title="Tambah ke Antrean"
                          >
                            + Antrean
                          </button>
                          <button
                            onClick={() => setTrackToAdd(track)}
                            className="text-[11px] text-[#1DB954] hover:bg-[#1DB954]/10 px-2 py-1 rounded transition-colors cursor-pointer"
                            title="Tambah ke Playlist"
                          >
                            + Playlist
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                {/* Recently Played Section */}
                {recentTracks.length > 0 && (
                  <section>
                    <h2 className="text-xl font-bold mb-4">Baru Saja Diputar</h2>
                    <div className="bg-white/[0.03] rounded-xl border border-white/5 divide-y divide-white/5">
                      {recentTracks.map((track, idx) => (
                        <TrackRow
                          key={`${track.id}-${idx}`}
                          index={idx + 1}
                          track={track}
                          isCurrent={data?.trackId === track.id}
                          onPlay={() => playTrack(track.uri)}
                          onPlayNext={() => handleAddToQueue(track, "top")}
                          onQueue={() => handleAddToQueue(track)}
                          onAddToPlaylist={() => setTrackToAdd(track)}
                          onLike={() => handleToggleLike(track.id, "save")}
                          onArtistClick={(artistId) => openArtist(artistId)}
                          onAlbumClick={(albumId) => openAlbum(albumId)}
                        />
                      ))}
                    </div>
                  </section>
                )}
              </div>
            )}

            {/* TAB: SEARCH */}
            {activeTab === "search" && (
              <div className="space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-2xl font-bold">Pencarian Katalog Spotify</h2>
                    <p className="text-xs text-zinc-400">
                      Cari lagu, artis, atau album dari Spotify untuk diputar, dimasukkan ke antrean, atau ditambahkan ke playlist
                    </p>
                  </div>

                  {/* Filter Pills */}
                  <div className="flex items-center gap-2">
                    {(authMode === "geolab"
                      ? ([
                          { id: "all", label: "Semua" },
                          { id: "tracks", label: "Lagu" },
                          { id: "artists", label: "Artis" },
                          { id: "albums", label: "Album" },
                        ] as const)
                      : ([
                          { id: "all", label: "Semua" },
                          { id: "tracks", label: "Lagu" },
                          { id: "artists", label: "Artis" },
                          { id: "albums", label: "Album" },
                          { id: "playlists", label: "Playlist" },
                        ] as const)
                    ).map((tab) => (
                      <button
                        key={tab.id}
                        onClick={() => setSearchFilter(tab.id)}
                        className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors cursor-pointer ${
                          searchFilter === tab.id
                            ? "bg-[#1DB954] text-black"
                            : "bg-white/10 text-zinc-300 hover:bg-white/15"
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </div>

                {isSearching && (
                  <div className="py-12 text-center text-zinc-400 text-sm animate-pulse">
                    Mencari di katalog Spotify...
                  </div>
                )}

                {!isSearching && !searchQuery.trim() && (
                  <div className="py-16 text-center bg-white/[0.02] rounded-2xl border border-white/5">
                    <p className="text-lg font-semibold text-zinc-300">Ketik judul lagu, nama penyanyi, atau album di atas</p>
                    <p className="text-xs text-zinc-500 mt-1">
                      Anda bisa memutar langsung, melihat profil artis, atau menambahkan lagu ke antrean & playlist.
                    </p>
                  </div>
                )}

                {!isSearching && searchQuery.trim() && (
                  <div className="space-y-8">
                    {/* Tracks Results */}
                    {(searchFilter === "all" || searchFilter === "tracks") &&
                      searchResults.tracks.length > 0 && (
                        <section>
                          <h3 className="text-lg font-bold mb-3">Lagu</h3>
                          <div className="bg-white/[0.03] rounded-xl border border-white/5 divide-y divide-white/5">
                            {searchResults.tracks.map((track, idx) => (
                              <TrackRow
                                key={track.id}
                                index={idx + 1}
                                track={track}
                                isCurrent={data?.trackId === track.id}
                                onPlay={() => playTrack(track.uri)}
                                onPlayNext={() => handleAddToQueue(track, "top")}
                                onQueue={() => handleAddToQueue(track)}
                                onAddToPlaylist={() => setTrackToAdd(track)}
                                onLike={() => handleToggleLike(track.id, "save")}
                                onArtistClick={(artistId) => openArtist(artistId)}
                                onAlbumClick={(albumId) => openAlbum(albumId)}
                              />
                            ))}
                          </div>
                        </section>
                      )}

                    {/* Artists Results */}
                    {(searchFilter === "all" || searchFilter === "artists") &&
                      searchResults.artists.length > 0 && (
                        <section>
                          <h3 className="text-lg font-bold mb-3">Artis</h3>
                          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                            {searchResults.artists.slice(0, 10).map((artist: any) => (
                              <div
                                key={artist.id}
                                onClick={() => openArtist(artist.id)}
                                className="bg-[#181818] hover:bg-[#282828] p-4 rounded-xl cursor-pointer transition-all group flex flex-col items-center text-center"
                              >
                                <div className="relative w-28 h-28 rounded-full overflow-hidden mb-3 shadow-lg">
                                  <img
                                    src={
                                      artist.images?.[0]?.url ||
                                      "https://placehold.co/200x200/27272a/white?text=Artis"
                                    }
                                    alt={artist.name}
                                    className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                                  />
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      playContext(artist.uri);
                                    }}
                                    className="absolute bottom-1 right-1 w-10 h-10 rounded-full bg-[#1DB954] text-black flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all shadow-lg cursor-pointer"
                                  >
                                    <svg className="w-5 h-5 translate-x-0.5" fill="currentColor" viewBox="0 0 24 24">
                                      <path d="M8 5v14l11-7z" />
                                    </svg>
                                  </button>
                                </div>
                                <p className="font-bold text-sm truncate w-full">{artist.name}</p>
                                <p className="text-xs text-zinc-400 mt-0.5">Artis</p>
                              </div>
                            ))}
                          </div>
                        </section>
                      )}

                    {/* Albums Results */}
                    {(searchFilter === "all" || searchFilter === "albums") &&
                      searchResults.albums.length > 0 && (
                        <section>
                          <h3 className="text-lg font-bold mb-3">Album</h3>
                          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                            {searchResults.albums.slice(0, 10).map((album) => (
                              <div
                                key={album.id}
                                onClick={() => openAlbum(album.id)}
                                className="bg-[#181818] hover:bg-[#282828] p-3.5 rounded-xl cursor-pointer transition-all group"
                              >
                                <div className="relative aspect-square rounded-lg overflow-hidden mb-3">
                                  <img
                                    src={album.images?.[0]?.url || ""}
                                    alt={album.name}
                                    className="w-full h-full object-cover"
                                  />
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      playContext(album.uri);
                                    }}
                                    className="absolute bottom-2 right-2 w-10 h-10 rounded-full bg-[#1DB954] text-black flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all shadow-lg cursor-pointer"
                                  >
                                    <svg className="w-5 h-5 translate-x-0.5" fill="currentColor" viewBox="0 0 24 24">
                                      <path d="M8 5v14l11-7z" />
                                    </svg>
                                  </button>
                                </div>
                                <p className="font-semibold text-sm truncate">{album.name}</p>
                                <p className="text-xs text-zinc-400 truncate mt-0.5">
                                  {album.artists?.map((a: any) => a.name).join(", ")}
                                </p>
                              </div>
                            ))}
                          </div>
                        </section>
                      )}

                    {/* Playlists Results (Only in Admin mode) */}
                    {authMode === "admin" &&
                      (searchFilter === "all" || searchFilter === "playlists") &&
                      searchResults.playlists.length > 0 && (
                        <section>
                          <h3 className="text-lg font-bold mb-3">Playlist Spotify</h3>
                          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                            {searchResults.playlists.slice(0, 10).map((pl) => (
                              <div
                                key={pl.id}
                                onClick={() => openPlaylist(pl.id)}
                                className="bg-[#181818] hover:bg-[#282828] p-3.5 rounded-xl cursor-pointer transition-all group"
                              >
                                <div className="relative aspect-square rounded-lg overflow-hidden mb-3">
                                  <img
                                    src={pl.images?.[0]?.url || "https://placehold.co/200x200/27272a/white?text=♪"}
                                    alt={pl.name}
                                    className="w-full h-full object-cover"
                                  />
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      playContext(pl.uri);
                                    }}
                                    className="absolute bottom-2 right-2 w-10 h-10 rounded-full bg-[#1DB954] text-black flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all shadow-lg cursor-pointer"
                                  >
                                    <svg className="w-5 h-5 translate-x-0.5" fill="currentColor" viewBox="0 0 24 24">
                                      <path d="M8 5v14l11-7z" />
                                    </svg>
                                  </button>
                                </div>
                                <p className="font-semibold text-sm truncate">{pl.name}</p>
                                <p className="text-xs text-zinc-400 truncate mt-0.5">
                                  Oleh {pl.owner?.display_name || "Spotify"}
                                </p>
                              </div>
                            ))}
                          </div>
                        </section>
                      )}
                  </div>
                )}
              </div>
            )}

            {/* TAB: LIKED SONGS */}
            {activeTab === "liked" && (
              <div className="space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-end gap-5 bg-gradient-to-r from-emerald-900/40 to-transparent p-5 rounded-2xl border border-white/5">
                  <div className="w-28 h-28 rounded-xl bg-gradient-to-br from-indigo-600 to-[#1DB954] flex items-center justify-center shadow-2xl shrink-0">
                    <svg className="w-14 h-14 text-white" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <span className="text-xs font-bold uppercase tracking-wider text-[#1DB954]">Koleksi Pribadi</span>
                    <h2 className="text-3xl font-extrabold mt-1">Lagu yang Disukai</h2>
                    <p className="text-xs text-zinc-400 mt-1">{likedTracks.length} lagu tersimpan di akun Spotify Anda</p>
                  </div>
                  {likedTracks.length > 0 && (
                    <button
                      onClick={() =>
                        playContext(
                          "",
                          likedTracks.map((i) => i.track).filter(Boolean)
                        )
                      }
                      className="bg-[#1DB954] hover:bg-[#1ed760] text-black font-bold px-6 py-3 rounded-full shadow-lg transition-transform hover:scale-105 cursor-pointer"
                    >
                      ▶ Putar Semua
                    </button>
                  )}
                </div>

                <div className="bg-white/[0.03] rounded-xl border border-white/5 divide-y divide-white/5">
                  {likedTracks.map((item, idx) =>
                    item.track ? (
                      <TrackRow
                        key={`${item.track.id}-${idx}`}
                        index={idx + 1}
                        track={item.track}
                        isCurrent={data?.trackId === item.track.id}
                        onPlay={() => playTrack(item.track.uri)}
                        onQueue={() => handleAddToQueue(item.track)}
                        onAddToPlaylist={() => setTrackToAdd(item.track)}
                        onRemove={() => handleToggleLike(item.track.id, "remove")}
                        removeLabel="Hapus Like"
                      />
                    ) : null
                  )}
                  {likedTracks.length === 0 && (
                    <div className="p-10 text-center text-zinc-400 text-sm">
                      Belum ada lagu yang disukai atau izin library belum diaktifkan (silakan Logout & Login kembali).
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB: QUEUE */}
            {activeTab === "queue" && (
              <div className="space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-2xl font-bold">Antrean Pemutaran (Queue)</h2>
                    <p className="text-xs text-zinc-400">
                      Kelola antrean lagu Anda (Tambah, Urutkan Naik/Turun, Hapus). Memutar lagu lain tidak akan menghapus antrean ini.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => setActiveTab("search")}
                      className="text-xs bg-[#1DB954] hover:bg-[#1ed760] text-black font-bold px-3.5 py-2 rounded-full transition-colors cursor-pointer"
                    >
                      + Tambah Lagu ke Antrean
                    </button>
                    {queueData.queue.length > 1 && (
                      <button
                        onClick={handleDeduplicateQueue}
                        className="text-xs bg-white/10 hover:bg-white/15 text-zinc-200 px-3.5 py-2 rounded-full font-semibold cursor-pointer"
                        title="Hapus lagu yang kembar / duplikat di dalam antrean"
                      >
                        ✨ Bersihkan Duplikat
                      </button>
                    )}
                    {queueData.queue.length > 0 && (
                      <button
                        onClick={handleClearQueue}
                        className="text-xs bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/20 px-3.5 py-2 rounded-full font-semibold cursor-pointer"
                        title="Kosongkan seluruh daftar antrean"
                      >
                        🗑 Kosongkan Antrean
                      </button>
                    )}
                    <button
                      onClick={async () => {
                        const res = await fetch("/api/spotify/queue", {
                          method: "PUT",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ action: "sync-from-spotify" }),
                        });
                        if (res.ok) {
                          const json = await res.json();
                          const updated = json.queue || [];
                          setQueueData((prev) => ({ ...prev, queue: updated }));
                          saveLocalQueue(updated);
                          showToast("Antrean disinkronkan dari aplikasi Spotify", "info");
                        }
                      }}
                      className="text-xs bg-white/10 hover:bg-white/15 px-3.5 py-2 rounded-full font-semibold cursor-pointer"
                      title="Impor antrean aktif dari aplikasi Spotify"
                    >
                      ⬇ Impor dari Spotify
                    </button>
                  </div>
                </div>

                {(queueData.currently_playing || data?.title) && (
                  <section>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-[#1DB954] mb-2">
                      Sedang Diputar Sekarang
                    </h3>
                    <div className="bg-[#1DB954]/10 border border-[#1DB954]/30 rounded-xl">
                      {queueData.currently_playing ? (
                        <TrackRow
                          index={1}
                          track={queueData.currently_playing}
                          isCurrent={true}
                          onPlay={() => playTrack(queueData.currently_playing.uri)}
                          onQueue={() => handleAddToQueue(queueData.currently_playing)}
                          onAddToPlaylist={() => setTrackToAdd(queueData.currently_playing)}
                        />
                      ) : (
                        <div className="flex items-center justify-between gap-3 px-4 py-3">
                          <div className="flex items-center gap-3 min-w-0">
                            {data?.albumImageUrl && (
                              <img
                                src={data.albumImageUrl}
                                alt={data.title}
                                className="w-10 h-10 rounded object-cover"
                              />
                            )}
                            <div className="min-w-0">
                              <p className="text-sm font-bold text-[#1DB954] truncate">{data?.title}</p>
                              <p className="text-xs text-zinc-400 truncate">
                                {data?.artist} {data?.album ? `• ${data.album}` : ""}
                              </p>
                            </div>
                          </div>
                          <span className="text-xs text-zinc-400 font-mono">
                            {formatTime(data?.durationMs || 0)}
                          </span>
                        </div>
                      )}
                    </div>
                  </section>
                )}

                <section>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                      Lagu Berikutnya di Antrean ({queueData.queue.length})
                    </h3>
                    {queueData.queue.length > 0 && (
                      <span className="text-[11px] text-zinc-500">
                        Klik ▶ untuk langsung memutar • Gunakan ↑ ↓ untuk mengubah urutan • Klik Hapus untuk mengeluarkan
                      </span>
                    )}
                  </div>
                  <div className="bg-white/[0.03] rounded-xl border border-white/5 divide-y divide-white/5">
                    {queueData.queue.map((track, idx) => (
                      <TrackRow
                        key={track.queueId || `${track.id}-${idx}`}
                        index={idx + 1}
                        track={track}
                        isCurrent={false}
                        onPlay={() => handlePlayFromQueue(idx)}
                        onQueue={() => handleAddToQueue(track)}
                        onAddToPlaylist={() => setTrackToAdd(track)}
                        onMoveUp={idx > 0 ? () => handleMoveInQueue(idx, idx - 1) : undefined}
                        onMoveDown={
                          idx < queueData.queue.length - 1
                            ? () => handleMoveInQueue(idx, idx + 1)
                            : undefined
                        }
                        onRemove={() => handleRemoveFromQueue(track.queueId, idx)}
                        removeLabel="Hapus"
                      />
                    ))}
                    {queueData.queue.length === 0 && (
                      <div className="p-10 text-center text-zinc-400 space-y-3">
                        <p className="text-sm">Antrean khusus Anda saat ini kosong.</p>
                        <button
                          onClick={() => setActiveTab("search")}
                          className="bg-[#1DB954] hover:bg-[#1ed760] text-black text-xs font-bold px-4 py-2 rounded-full cursor-pointer"
                        >
                          + Cari & Tambah Lagu ke Antrean
                        </button>
                      </div>
                    )}
                  </div>
                </section>

                {/* Next from Spotify Autoplay / Context when Custom Queue is empty or after Custom Queue */}
                {queueData.spotify_queue && queueData.spotify_queue.length > 0 && (
                  <section>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                        Berikutnya dari Spotify / Konteks Pemutar ({queueData.spotify_queue.length})
                      </h3>
                      <span className="text-[11px] text-zinc-500">
                        Klik + Antrean untuk memindahkan ke Antrean Utama Anda
                      </span>
                    </div>
                    <div className="bg-white/[0.02] rounded-xl border border-white/5 divide-y divide-white/5 opacity-85">
                      {queueData.spotify_queue
                        .filter(
                          (st: any) =>
                            !queueData.queue.some((qt: any) => qt.uri === st.uri)
                        )
                        .slice(0, 10)
                        .map((track: any, idx: number) => (
                          <TrackRow
                            key={`sp-${track.id}-${idx}`}
                            index={idx + 1}
                            track={track}
                            isCurrent={false}
                            onPlay={() => playTrack(track.uri)}
                            onQueue={() => handleAddToQueue(track)}
                            onAddToPlaylist={() => setTrackToAdd(track)}
                          />
                        ))}
                    </div>
                  </section>
                )}
              </div>
            )}

            {/* TAB: PLAYLIST DETAIL */}
            {activeTab === "playlist" && (
              <div className="space-y-6">
                {loadingDetail ? (
                  <div className="py-16 text-center text-zinc-400 animate-pulse">Memuat isi playlist...</div>
                ) : selectedPlaylist ? (
                  <>
                    <div className="flex flex-col sm:flex-row sm:items-end gap-5 bg-white/[0.03] p-5 rounded-2xl border border-white/5">
                      <img
                        src={
                          selectedPlaylist.images?.[0]?.url ||
                          "https://placehold.co/200x200/27272a/white?text=Playlist"
                        }
                        alt={selectedPlaylist.name}
                        className="w-32 h-32 sm:w-40 sm:h-40 rounded-xl object-cover shadow-2xl shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <span className="text-xs font-bold uppercase tracking-wider text-[#1DB954]">Playlist</span>
                        <h2 className="text-2xl sm:text-4xl font-extrabold truncate mt-1">
                          {selectedPlaylist.name}
                        </h2>
                        {selectedPlaylist.description && (
                          <p
                            className="text-xs sm:text-sm text-zinc-400 mt-1 line-clamp-2"
                            dangerouslySetInnerHTML={{ __html: selectedPlaylist.description }}
                          />
                        )}
                        <p className="text-xs text-zinc-500 mt-2">
                          Oleh <span className="text-zinc-300 font-semibold">{selectedPlaylist.owner?.display_name}</span> •{" "}
                          {selectedPlaylist.tracks?.total || 0} lagu
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2.5">
                        <button
                          onClick={() =>
                            playContext(
                              selectedPlaylist.uri,
                              (selectedPlaylist.tracks?.items || []).map((i: any) => i.track).filter(Boolean)
                            )
                          }
                          className="bg-[#1DB954] hover:bg-[#1ed760] text-black font-bold px-6 py-3 rounded-full shadow-lg transition-transform hover:scale-105 cursor-pointer"
                        >
                          ▶ Putar Playlist
                        </button>
                        <button
                          onClick={() => setActiveTab("search")}
                          className="bg-white/10 hover:bg-white/20 text-white text-xs font-semibold px-4 py-3 rounded-full transition-colors cursor-pointer"
                        >
                          + Tambah Lagu
                        </button>
                      </div>
                    </div>

                    {/* Spotify-style In-Playlist Filter & Sort Bar */}
                    <div className="flex flex-wrap items-center justify-between gap-3 px-1">
                      <div className="relative w-full sm:w-72">
                        <input
                          type="text"
                          value={playlistFilter}
                          onChange={(e) => setPlaylistFilter(e.target.value)}
                          placeholder="Cari di dalam playlist ini..."
                          className="w-full bg-white/5 hover:bg-white/10 focus:bg-zinc-800 text-xs text-white rounded-lg py-2 pl-8 pr-7 outline-none border border-white/10 focus:border-[#1DB954]"
                        />
                        <svg
                          className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2"
                          fill="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
                        </svg>
                        {playlistFilter && (
                          <button
                            onClick={() => setPlaylistFilter("")}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white text-xs"
                          >
                            ✕
                          </button>
                        )}
                      </div>

                      <div className="flex items-center gap-2 text-xs text-zinc-400">
                        <span>Urutkan:</span>
                        <select
                          value={playlistSort}
                          onChange={(e) => setPlaylistSort(e.target.value as any)}
                          className="bg-zinc-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none focus:border-[#1DB954] cursor-pointer"
                        >
                          <option value="default">Urutan Asli</option>
                          <option value="title">Judul Lagu (A-Z)</option>
                          <option value="artist">Nama Artis (A-Z)</option>
                          <option value="duration">Durasi Terpanjang</option>
                        </select>
                      </div>
                    </div>

                    <div className="bg-white/[0.03] rounded-xl border border-white/5 divide-y divide-white/5">
                      {(() => {
                        const rawItems = (selectedPlaylist.tracks?.items || [])
                          .map((item: any, idx: number) => ({ track: item.track, originalIndex: idx + 1 }))
                          .filter((x: any) => Boolean(x.track));

                        const filtered = rawItems.filter(({ track }: any) => {
                          if (!playlistFilter.trim()) return true;
                          const q = playlistFilter.toLowerCase();
                          const tName = (track.name || "").toLowerCase();
                          const aName = (track.artists || []).map((a: any) => a.name).join(" ").toLowerCase();
                          const alName = (track.album?.name || "").toLowerCase();
                          return tName.includes(q) || aName.includes(q) || alName.includes(q);
                        });

                        if (playlistSort === "title") {
                          filtered.sort((a: any, b: any) => (a.track.name || "").localeCompare(b.track.name || ""));
                        } else if (playlistSort === "artist") {
                          filtered.sort((a: any, b: any) =>
                            (a.track.artists?.[0]?.name || "").localeCompare(b.track.artists?.[0]?.name || "")
                          );
                        } else if (playlistSort === "duration") {
                          filtered.sort((a: any, b: any) => (b.track.duration_ms || 0) - (a.track.duration_ms || 0));
                        }

                        return filtered.map(({ track, originalIndex }: any, idx: number) => (
                          <TrackRow
                            key={`${track.id}-${originalIndex}-${idx}`}
                            index={idx + 1}
                            track={track}
                            isCurrent={data?.trackId === track.id}
                            onPlay={() => playTrack(track.uri)}
                            onPlayNext={() => handleAddToQueue(track, "top")}
                            onQueue={() => handleAddToQueue(track)}
                            onAddToPlaylist={() => setTrackToAdd(track)}
                            onArtistClick={(artistId) => openArtist(artistId)}
                            onAlbumClick={(albumId) => openAlbum(albumId)}
                            onRemove={() =>
                              handleRemoveTrackFromPlaylist(selectedPlaylist.id, track.uri)
                            }
                            removeLabel="Hapus"
                          />
                        ));
                      })()}
                      {(selectedPlaylist.tracks?.items || []).length === 0 && (
                        <div className="p-10 text-center text-zinc-400 text-sm">
                          Playlist ini masih kosong. Klik tombol <b>+ Tambah Lagu</b> untuk mencari dan memasukkan lagu!
                        </div>
                      )}
                    </div>
                  </>
                ) : null}
              </div>
            )}

            {/* TAB: ALBUM DETAIL */}
            {activeTab === "album" && selectedAlbum && (
              <div className="space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-end gap-5 bg-white/[0.03] p-5 rounded-2xl border border-white/5">
                  <img
                    src={selectedAlbum.images?.[0]?.url || ""}
                    alt={selectedAlbum.name}
                    className="w-32 h-32 sm:w-40 sm:h-40 rounded-xl object-cover shadow-2xl shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-bold uppercase tracking-wider text-[#1DB954]">Album</span>
                    <h2 className="text-2xl sm:text-4xl font-extrabold truncate mt-1">{selectedAlbum.name}</h2>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1 text-sm text-zinc-300">
                      {selectedAlbum.artists?.map((a: any, i: number) => (
                        <span key={a.id || i}>
                          <button
                            onClick={() => a.id && openArtist(a.id)}
                            className="hover:text-[#1DB954] hover:underline font-semibold cursor-pointer"
                          >
                            {a.name}
                          </button>
                          {i < selectedAlbum.artists.length - 1 ? ", " : ""}
                        </span>
                      ))}
                    </div>
                    <p className="text-xs text-zinc-500 mt-1">
                      {selectedAlbum.release_date} • {selectedAlbum.total_tracks} lagu
                    </p>
                  </div>
                  <button
                    onClick={() =>
                      playContext(
                        selectedAlbum.uri,
                        (selectedAlbum.tracks?.items || []).map((t: any) => ({
                          ...t,
                          album: { id: selectedAlbum.id, name: selectedAlbum.name, images: selectedAlbum.images },
                        }))
                      )
                    }
                    className="bg-[#1DB954] hover:bg-[#1ed760] text-black font-bold px-6 py-3 rounded-full shadow-lg transition-transform hover:scale-105 cursor-pointer"
                  >
                    ▶ Putar Album
                  </button>
                </div>

                <div className="bg-white/[0.03] rounded-xl border border-white/5 divide-y divide-white/5">
                  {(selectedAlbum.tracks?.items || []).map((track: any, idx: number) => {
                    const enrichedTrack = {
                      ...track,
                      album: { id: selectedAlbum.id, name: selectedAlbum.name, images: selectedAlbum.images },
                    };
                    return (
                      <TrackRow
                        key={track.id}
                        index={idx + 1}
                        track={enrichedTrack}
                        isCurrent={data?.trackId === track.id}
                        onPlay={() => playTrack(track.uri)}
                        onPlayNext={() => handleAddToQueue(enrichedTrack, "top")}
                        onQueue={() => handleAddToQueue(enrichedTrack)}
                        onAddToPlaylist={() => setTrackToAdd(enrichedTrack)}
                        onArtistClick={(artistId) => openArtist(artistId)}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {/* TAB: ARTIST PROFILE VIEW (Spotify Artist Page) */}
            {activeTab === "artist" && (
              <div className="space-y-8">
                {loadingDetail ? (
                  <div className="py-16 text-center text-zinc-400 animate-pulse">Memuat profil artis...</div>
                ) : selectedArtist?.artist ? (
                  <>
                    {/* Artist Hero Banner */}
                    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-emerald-950/50 via-[#18181b] to-[#121212] p-6 sm:p-8 flex flex-col sm:flex-row sm:items-end gap-6">
                      <img
                        src={
                          selectedArtist.artist.images?.[0]?.url ||
                          "https://placehold.co/240x240/27272a/white?text=Artis"
                        }
                        alt={selectedArtist.artist.name}
                        className="w-32 h-32 sm:w-44 sm:h-44 rounded-full object-cover shadow-2xl border-2 border-white/10 shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-[#1DB954] uppercase tracking-wider">
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                          </svg>
                          <span>Artis Terverifikasi Spotify</span>
                        </div>
                        <h2 className="text-3xl sm:text-5xl font-black tracking-tight mt-1 truncate">
                          {selectedArtist.artist.name}
                        </h2>
                        <p className="text-xs sm:text-sm text-zinc-300 mt-2">
                          {(selectedArtist.artist.followers?.total || 0).toLocaleString("id-ID")} pengikut
                          {selectedArtist.artist.genres?.length > 0 &&
                            ` • ${selectedArtist.artist.genres.slice(0, 3).join(", ")}`}
                        </p>
                      </div>
                      {selectedArtist.topTracks.length > 0 && (
                        <button
                          onClick={() => playContext(selectedArtist.artist.uri, selectedArtist.topTracks)}
                          className="bg-[#1DB954] hover:bg-[#1ed760] text-black font-bold px-7 py-3.5 rounded-full shadow-xl transition-transform hover:scale-105 cursor-pointer shrink-0"
                        >
                          ▶ Putar Lagu Populer
                        </button>
                      )}
                    </div>

                    {/* Popular Tracks */}
                    {selectedArtist.topTracks.length > 0 && (
                      <section>
                        <h3 className="text-xl font-bold mb-3">Lagu Populer</h3>
                        <div className="bg-white/[0.03] rounded-xl border border-white/5 divide-y divide-white/5">
                          {selectedArtist.topTracks.slice(0, 10).map((track: any, idx: number) => (
                            <TrackRow
                              key={track.id}
                              index={idx + 1}
                              track={track}
                              isCurrent={data?.trackId === track.id}
                              onPlay={() => playTrack(track.uri)}
                              onPlayNext={() => handleAddToQueue(track, "top")}
                              onQueue={() => handleAddToQueue(track)}
                              onAddToPlaylist={() => setTrackToAdd(track)}
                              onLike={() => handleToggleLike(track.id, "save")}
                              onAlbumClick={(albumId) => openAlbum(albumId)}
                            />
                          ))}
                        </div>
                      </section>
                    )}

                    {/* Discography (Albums & Singles) */}
                    {selectedArtist.albums.length > 0 && (
                      <section>
                        <h3 className="text-xl font-bold mb-3">Diskografi (Album & Single)</h3>
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                          {selectedArtist.albums.map((album: any) => (
                            <div
                              key={album.id}
                              onClick={() => openAlbum(album.id)}
                              className="bg-[#181818] hover:bg-[#282828] p-3.5 rounded-xl cursor-pointer transition-all group"
                            >
                              <div className="relative aspect-square rounded-lg overflow-hidden mb-3 shadow-lg">
                                <img
                                  src={album.images?.[0]?.url || ""}
                                  alt={album.name}
                                  className="w-full h-full object-cover"
                                />
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    playContext(album.uri);
                                  }}
                                  className="absolute bottom-2 right-2 w-10 h-10 rounded-full bg-[#1DB954] text-black flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all shadow-lg cursor-pointer"
                                >
                                  <svg className="w-5 h-5 translate-x-0.5" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M8 5v14l11-7z" />
                                  </svg>
                                </button>
                              </div>
                              <p className="font-semibold text-sm truncate">{album.name}</p>
                              <p className="text-xs text-zinc-400 truncate mt-0.5 capitalize">
                                {album.release_date?.slice(0, 4)} • {album.album_type || "Album"}
                              </p>
                            </div>
                          ))}
                        </div>
                      </section>
                    )}
                  </>
                ) : null}
              </div>
            )}

            {/* TAB: FOCUS / LIVE PLAYER VIEW */}
            {activeTab === "focus" && (
              <div className="relative min-h-[75vh] rounded-2xl overflow-hidden flex flex-col lg:flex-row items-center justify-center p-6 sm:p-10 gap-8 border border-white/5">
                {data?.albumImageUrl && (
                  <div
                    className="absolute inset-0 z-0 opacity-35 scale-110"
                    style={{
                      backgroundImage: `url(${data.albumImageUrl})`,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                      filter: "blur(55px)",
                    }}
                  />
                )}
                <div className="z-10 flex flex-col items-center text-center max-w-md w-full shrink-0">
                  <div className="w-60 h-60 sm:w-72 sm:h-72 rounded-2xl overflow-hidden shadow-2xl mb-6 border border-white/10">
                    {data?.albumImageUrl ? (
                      <img src={data.albumImageUrl} alt={data.album} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-zinc-800 flex items-center justify-center text-4xl text-zinc-600">
                        ♪
                      </div>
                    )}
                  </div>
                  <h2 className="text-2xl sm:text-3xl font-extrabold">{data?.title || "Tidak Ada Musik"}</h2>
                  <p className="text-zinc-300 text-base mt-1">{data?.artist || "Pilih lagu dari Beranda atau Cari"}</p>
                  <p className="text-xs text-[#1DB954] mt-2 uppercase tracking-widest font-semibold">
                    {data?.device?.name ? `Aktif di: ${data.device.name}` : "Siap Diputar"}
                  </p>
                  <div className="flex items-center gap-2.5 mt-4">
                    <button
                      onClick={() => setFocusShowLyrics((prev) => !prev)}
                      className={`text-xs font-semibold px-4 py-2 rounded-full border transition-all cursor-pointer ${
                        focusShowLyrics
                          ? "bg-[#1DB954]/20 border-[#1DB954] text-[#1DB954]"
                          : "bg-white/10 border-white/10 text-zinc-300 hover:text-white"
                      }`}
                    >
                      🎤 {focusShowLyrics ? "Sembunyikan Lirik" : "Tampilkan Lirik"}
                    </button>
                    <button
                      onClick={() => setActiveTab("lyrics")}
                      className="text-xs font-semibold px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all cursor-pointer"
                    >
                      Layar Penuh Lirik ↗
                    </button>
                  </div>
                </div>

                {/* Live Lyrics Side Panel inside Focus Mode */}
                {focusShowLyrics && data?.title && (
                  <div className="z-10 flex-1 w-full max-w-xl bg-black/40 backdrop-blur-md border border-white/10 rounded-2xl p-5 sm:p-6 flex flex-col h-[52vh] lg:h-[62vh]">
                    <div className="flex items-center justify-between pb-3 mb-3 border-b border-white/10">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold uppercase tracking-wider text-[#1DB954]">
                          Lirik Lagu
                        </span>
                        {lyrics?.syncedLyrics && lyrics.syncedLyrics.length > 0 && (
                          <span className="text-[10px] bg-[#1DB954]/20 text-[#1DB954] px-2 py-0.5 rounded-full font-semibold">
                            Tersinkronisasi • Klik baris untuk lompat
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => setAutoScrollLyrics((p) => !p)}
                        className={`text-[11px] px-2.5 py-1 rounded-full font-semibold cursor-pointer transition-colors ${
                          autoScrollLyrics
                            ? "bg-[#1DB954] text-black"
                            : "bg-white/10 text-zinc-300 hover:bg-white/20"
                        }`}
                      >
                        {autoScrollLyrics ? "Auto-Scroll: ON" : "Auto-Scroll: OFF"}
                      </button>
                    </div>

                    <div
                      ref={lyricsContainerRef}
                      className="flex-1 overflow-y-auto pr-2 space-y-4 custom-scrollbar scroll-smooth"
                    >
                      {loadingLyrics ? (
                        <div className="h-full flex flex-col items-center justify-center text-zinc-400 gap-2">
                          <div className="w-7 h-7 border-3 border-t-[#1DB954] border-zinc-700 rounded-full animate-spin" />
                          <span className="text-xs">Mencari lirik lagu...</span>
                        </div>
                      ) : lyrics?.instrumental ? (
                        <div className="h-full flex items-center justify-center text-center text-zinc-400">
                          <p className="text-base font-semibold">🎵 Lagu ini adalah Instrumental (Tanpa Vokal)</p>
                        </div>
                      ) : lyrics?.syncedLyrics && lyrics.syncedLyrics.length > 0 ? (
                        <div className="py-10 space-y-4">
                          {lyrics.syncedLyrics.map((line, i) => {
                            const isActive = i === activeLyricIndex;
                            const isPassed = i < activeLyricIndex;
                            return (
                              <div
                                key={`${line.timeMs}-${i}`}
                                ref={isActive ? activeLyricRef : null}
                                onClick={() => {
                                  setLocalProgress(line.timeMs);
                                  handleControl("seek", { value: line.timeMs });
                                }}
                                className={`cursor-pointer transition-all duration-300 rounded-xl px-3 py-1.5 ${
                                  isActive
                                    ? "text-white font-extrabold text-xl sm:text-2xl scale-[1.02] bg-white/[0.06] shadow-sm"
                                    : isPassed
                                    ? "text-zinc-500 font-semibold text-base sm:text-lg hover:text-zinc-300"
                                    : "text-zinc-400 font-semibold text-base sm:text-lg hover:text-zinc-200"
                                }`}
                                title={`Lompat ke ${formatTime(line.timeMs)}`}
                              >
                                {line.text || "♪ • • •"}
                              </div>
                            );
                          })}
                        </div>
                      ) : lyrics?.plainLyrics ? (
                        <div className=" whitespace-pre-line text-zinc-200 text-base sm:text-lg leading-relaxed font-medium py-4">
                          {lyrics.plainLyrics}
                        </div>
                      ) : (
                        <div className="h-full flex flex-col items-center justify-center text-center text-zinc-400 gap-2">
                          <p className="text-sm font-semibold">Lirik belum ditemukan untuk lagu ini.</p>
                          <button
                            onClick={() =>
                              fetchLyricsForTrack(data.title, data.artist, data.album, data.durationMs)
                            }
                            className="text-xs bg-white/10 hover:bg-white/20 text-white px-3.5 py-1.5 rounded-full cursor-pointer"
                          >
                            ↻ Coba Cari Ulang
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB: DEDICATED FULL LYRICS VIEW */}
            {activeTab === "lyrics" && (
              <div className="relative min-h-[75vh] rounded-2xl overflow-hidden flex flex-col p-5 sm:p-8 border border-white/10 bg-gradient-to-b from-emerald-950/30 via-[#121212] to-[#09090b]">
                {data?.albumImageUrl && (
                  <div
                    className="absolute inset-0 z-0 opacity-25 scale-110 pointer-events-none"
                    style={{
                      backgroundImage: `url(${data.albumImageUrl})`,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                      filter: "blur(70px)",
                    }}
                  />
                )}

                {/* Top Header inside Lyrics View */}
                <div className="z-10 flex flex-wrap items-center justify-between gap-4 pb-5 mb-4 border-b border-white/10">
                  <div className="flex items-center gap-4 min-w-0">
                    {data?.albumImageUrl ? (
                      <img
                        src={data.albumImageUrl}
                        alt={data.album}
                        className="w-16 h-16 rounded-xl object-cover shadow-xl border border-white/10 shrink-0"
                      />
                    ) : (
                      <div className="w-16 h-16 rounded-xl bg-zinc-800 flex items-center justify-center text-2xl text-zinc-500 shrink-0">
                        ♪
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-bold uppercase tracking-widest text-[#1DB954]">
                          Mode Karaoke & Lirik
                        </span>
                        {lyrics?.source && (
                          <span className="text-[10px] bg-white/10 text-zinc-300 px-2 py-0.5 rounded-full">
                            Sumber: {lyrics.source}
                          </span>
                        )}
                      </div>
                      <h2 className="text-xl sm:text-2xl font-extrabold truncate mt-0.5">
                        {data?.title || "Belum Ada Lagu yang Diputar"}
                      </h2>
                      <p className="text-xs sm:text-sm text-zinc-300 truncate">
                        {data?.artist || "Putar lagu apa saja untuk melihat lirik secara otomatis"}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {lyrics?.syncedLyrics && lyrics.syncedLyrics.length > 0 && (
                      <button
                        onClick={() => setAutoScrollLyrics((p) => !p)}
                        className={`text-xs font-bold px-4 py-2 rounded-full transition-all cursor-pointer ${
                          autoScrollLyrics
                            ? "bg-[#1DB954] text-black shadow-lg"
                            : "bg-white/10 text-zinc-300 hover:bg-white/20"
                        }`}
                      >
                        {autoScrollLyrics ? "✓ Auto-Scroll Aktif" : "Auto-Scroll Mati"}
                      </button>
                    )}
                    {data?.title && (
                      <button
                        onClick={() =>
                          fetchLyricsForTrack(data.title, data.artist, data.album, data.durationMs)
                        }
                        className="text-xs font-semibold bg-white/10 hover:bg-white/20 text-white px-3.5 py-2 rounded-full transition-colors cursor-pointer"
                        title="Muat ulang lirik"
                      >
                        ↻ Segarkan Lirik
                      </button>
                    )}
                  </div>
                </div>

                {/* Main Lyrics Scroll Area */}
                <div
                  ref={lyricsContainerRef}
                  className="z-10 flex-1 max-h-[58vh] overflow-y-auto px-2 sm:px-8 py-6 custom-scrollbar scroll-smooth"
                >
                  {!data?.title ? (
                    <div className="h-56 flex flex-col items-center justify-center text-center text-zinc-400 gap-3">
                      <p className="text-lg font-bold text-zinc-200">Belum ada lagu yang sedang diputar</p>
                      <p className="text-xs text-zinc-400 max-w-md">
                        Pilih dan putar lagu dari menu Beranda, Playlist, atau Pencarian untuk menampilkan lirik tersinkronisasi di sini.
                      </p>
                    </div>
                  ) : loadingLyrics ? (
                    <div className="h-56 flex flex-col items-center justify-center text-zinc-300 gap-3">
                      <div className="w-9 h-9 border-4 border-t-[#1DB954] border-zinc-700 rounded-full animate-spin" />
                      <p className="text-sm font-medium animate-pulse">
                        Memuat lirik untuk &ldquo;{data.title}&rdquo;...
                      </p>
                    </div>
                  ) : lyrics?.instrumental ? (
                    <div className="h-56 flex flex-col items-center justify-center text-center text-zinc-300 gap-2">
                      <span className="text-4xl">🎹</span>
                      <p className="text-lg font-bold">Lagu Instrumental</p>
                      <p className="text-xs text-zinc-400">Lagu ini tidak memiliki lirik vokal.</p>
                    </div>
                  ) : lyrics?.syncedLyrics && lyrics.syncedLyrics.length > 0 ? (
                    <div className="max-w-3xl mx-auto py-12 space-y-5">
                      {lyrics.syncedLyrics.map((line, i) => {
                        const isActive = i === activeLyricIndex;
                        const isPassed = i < activeLyricIndex;
                        return (
                          <div
                            key={`${line.timeMs}-${i}`}
                            ref={isActive ? activeLyricRef : null}
                            onClick={() => {
                              setLocalProgress(line.timeMs);
                              handleControl("seek", { value: line.timeMs });
                            }}
                            className={`group flex items-baseline justify-between gap-4 cursor-pointer transition-all duration-300 rounded-2xl px-4 py-2.5 ${
                              isActive
                                ? "text-[#1DB954] font-black text-2xl sm:text-4xl bg-white/[0.07] shadow-lg scale-[1.01]"
                                : isPassed
                                ? "text-zinc-500 font-bold text-lg sm:text-2xl hover:text-zinc-300 hover:bg-white/[0.03]"
                                : "text-zinc-300/80 font-bold text-lg sm:text-2xl hover:text-white hover:bg-white/[0.03]"
                            }`}
                            title={`Klik untuk melompat ke menit ${formatTime(line.timeMs)}`}
                          >
                            <span className="leading-snug">{line.text || "♪ • • •"}</span>
                            <span
                              className={`text-xs font-mono shrink-0 transition-opacity ${
                                isActive ? "opacity-100 text-[#1DB954]" : "opacity-0 group-hover:opacity-70 text-zinc-400"
                              }`}
                            >
                              {formatTime(line.timeMs)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : lyrics?.plainLyrics ? (
                    <div className="max-w-2xl mx-auto py-4">
                      <div className="mb-4 inline-block text-[11px] bg-white/10 text-zinc-300 px-3 py-1 rounded-full">
                        Lirik Teks Standar (Belum ada timestamp sinkronisasi untuk lagu ini)
                      </div>
                      <div className="whitespace-pre-line text-zinc-100 text-lg sm:text-2xl leading-relaxed font-semibold">
                        {lyrics.plainLyrics}
                      </div>
                    </div>
                  ) : (
                    <div className="h-56 flex flex-col items-center justify-center text-center text-zinc-400 gap-3">
                      <p className="text-base font-bold text-zinc-300">
                        Maaf, lirik untuk &ldquo;{data.title}&rdquo; belum tersedia di database.
                      </p>
                      <p className="text-xs text-zinc-500 max-w-md">
                        Pastikan judul lagu dan nama penyanyi sesuai, atau coba lagu lainnya.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </main>

        {/* Right Sidebar: Spotify Desktop "Now Playing View" + "Next in Queue" + "Mini Lyrics" */}
        {rightSidebarMode !== "closed" && (
          <aside className="hidden xl:flex w-80 bg-[#121212] rounded-xl flex-col overflow-hidden shrink-0 border border-white/5">
            {/* Right Sidebar Header Tabs */}
            <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1 bg-white/5 p-1 rounded-lg">
                <button
                  onClick={() => setRightSidebarMode("now-playing")}
                  className={`text-[11px] font-bold px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                    rightSidebarMode === "now-playing"
                      ? "bg-[#1DB954] text-black"
                      : "text-zinc-400 hover:text-white"
                  }`}
                >
                  Now Playing
                </button>
                <button
                  onClick={() => setRightSidebarMode("queue")}
                  className={`text-[11px] font-bold px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                    rightSidebarMode === "queue"
                      ? "bg-[#1DB954] text-black"
                      : "text-zinc-400 hover:text-white"
                  }`}
                >
                  Antrean ({queueData.queue.length})
                </button>
                <button
                  onClick={() => setRightSidebarMode("lyrics")}
                  className={`text-[11px] font-bold px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                    rightSidebarMode === "lyrics"
                      ? "bg-[#1DB954] text-black"
                      : "text-zinc-400 hover:text-white"
                  }`}
                >
                  Lirik
                </button>
              </div>
              <button
                onClick={() => setRightSidebarMode("closed")}
                className="text-zinc-400 hover:text-white text-xs p-1 cursor-pointer"
                title="Tutup Panel Kanan"
              >
                ✕
              </button>
            </div>

            {/* Right Sidebar Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-5 custom-scrollbar">
              {rightSidebarMode === "now-playing" && (
                <>
                  {/* Large Album Art Card */}
                  <div className="space-y-3">
                    <div
                      onClick={() => data?.albumId && openAlbum(data.albumId)}
                      className="aspect-square w-full rounded-xl overflow-hidden bg-zinc-800 shadow-2xl cursor-pointer group relative"
                    >
                      {data?.albumImageUrl ? (
                        <img
                          src={data.albumImageUrl}
                          alt={data.title}
                          className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-4xl text-zinc-600">
                          ♪
                        </div>
                      )}
                    </div>

                    <div className="flex items-start justify-between gap-2 pt-1">
                      <div className="min-w-0 flex-1">
                        <h3
                          onClick={() => data?.albumId && openAlbum(data.albumId)}
                          className="text-lg font-extrabold text-white truncate hover:underline cursor-pointer"
                        >
                          {data?.title || "Tidak Ada Lagu Aktif"}
                        </h3>
                        <p
                          onClick={() => data?.artistId && openArtist(data.artistId)}
                          className="text-sm text-zinc-400 hover:text-white hover:underline truncate cursor-pointer"
                        >
                          {data?.artist || "Pilih lagu untuk mulai mendengarkan"}
                        </p>
                      </div>
                      {data?.trackId && (
                        <button
                          onClick={() => handleToggleLike(data.trackId!, "save")}
                          className="text-zinc-400 hover:text-[#1DB954] p-1.5 text-lg cursor-pointer"
                          title="Simpan ke Lagu yang Disukai"
                        >
                          ♥
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Quick Lyrics Snippet Card (Like Spotify Desktop Now Playing Sidebar) */}
                  {lyrics?.syncedLyrics && lyrics.syncedLyrics.length > 0 && (
                    <div
                      onClick={() => setActiveTab("lyrics")}
                      className="bg-gradient-to-br from-emerald-900/50 to-zinc-900 border border-white/10 rounded-xl p-4 cursor-pointer hover:border-[#1DB954]/40 transition-all"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-[#1DB954]">
                          Lirik Saat Ini
                        </span>
                        <span className="text-[10px] text-zinc-400">Buka Penuh ↗</span>
                      </div>
                      <p className="text-sm font-bold text-white line-clamp-2">
                        {activeLyricIndex >= 0
                          ? lyrics.syncedLyrics[activeLyricIndex]?.text || "♪ • • •"
                          : lyrics.syncedLyrics[0]?.text}
                      </p>
                      {activeLyricIndex + 1 < lyrics.syncedLyrics.length && (
                        <p className="text-xs text-zinc-400 mt-1 line-clamp-1">
                          {lyrics.syncedLyrics[activeLyricIndex + 1]?.text}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Next in Queue Card inside Now Playing Sidebar */}
                  <div className="bg-white/[0.04] border border-white/5 rounded-xl p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white">Berikutnya di Antrean</span>
                      <button
                        onClick={() => setActiveTab("queue")}
                        className="text-[11px] font-bold text-zinc-400 hover:text-[#1DB954] cursor-pointer"
                      >
                        Buka Antrean
                      </button>
                    </div>

                    {queueData.queue.length > 0 ? (
                      <div className="space-y-2">
                        {queueData.queue.slice(0, 3).map((item, idx) => (
                          <div
                            key={item.queueId || `${item.id}-${idx}`}
                            className="flex items-center justify-between gap-2.5 p-1.5 rounded-lg hover:bg-white/5 group"
                          >
                            <div
                              onClick={() => handlePlayFromQueue(idx)}
                              className="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer"
                            >
                              <img
                                src={
                                  item.album?.images?.[0]?.url ||
                                  "https://placehold.co/60x60/27272a/white?text=♪"
                                }
                                alt={item.name}
                                className="w-9 h-9 rounded object-cover shrink-0"
                              />
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-semibold text-white truncate group-hover:text-[#1DB954]">
                                  {item.name}
                                </p>
                                <p className="text-[11px] text-zinc-400 truncate">
                                  {item.artists?.map((a: any) => a.name).join(", ")}
                                </p>
                              </div>
                            </div>
                            <button
                              onClick={() => handleRemoveFromQueue(item.queueId, idx)}
                              className="text-[11px] text-zinc-500 hover:text-red-400 px-1.5 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                              title="Hapus dari antrean"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-zinc-500 py-2">
                        Belum ada lagu di antrean berikutnya.
                      </p>
                    )}
                  </div>
                </>
              )}

              {rightSidebarMode === "queue" && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                      Antrean Anda ({queueData.queue.length})
                    </span>
                    {queueData.queue.length > 0 && (
                      <button
                        onClick={handleClearQueue}
                        className="text-[11px] text-red-400 hover:underline cursor-pointer"
                      >
                        Kosongkan
                      </button>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    {queueData.queue.map((item, idx) => (
                      <div
                        key={item.queueId || `${item.id}-${idx}`}
                        className="flex items-center justify-between gap-2 p-2 rounded-lg bg-white/[0.03] hover:bg-white/[0.08] group"
                      >
                        <div
                          onClick={() => handlePlayFromQueue(idx)}
                          className="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer"
                        >
                          <span className="text-[11px] font-mono text-zinc-500 w-4">{idx + 1}</span>
                          <img
                            src={
                              item.album?.images?.[0]?.url ||
                              "https://placehold.co/60x60/27272a/white?text=♪"
                            }
                            alt={item.name}
                            className="w-8 h-8 rounded object-cover shrink-0"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold text-white truncate">{item.name}</p>
                            <p className="text-[10px] text-zinc-400 truncate">
                              {item.artists?.map((a: any) => a.name).join(", ")}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => handleMoveInQueue(idx, idx - 1)}
                            disabled={idx === 0}
                            className="text-[10px] text-zinc-400 hover:text-white disabled:opacity-20 px-1 cursor-pointer"
                            title="Naik"
                          >
                            ↑
                          </button>
                          <button
                            onClick={() => handleMoveInQueue(idx, idx + 1)}
                            disabled={idx === queueData.queue.length - 1}
                            className="text-[10px] text-zinc-400 hover:text-white disabled:opacity-20 px-1 cursor-pointer"
                            title="Turun"
                          >
                            ↓
                          </button>
                          <button
                            onClick={() => handleRemoveFromQueue(item.queueId, idx)}
                            className="text-[10px] text-red-400 hover:text-red-300 px-1 cursor-pointer"
                            title="Hapus"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))}
                    {queueData.queue.length === 0 && (
                      <p className="text-xs text-zinc-500 text-center py-8">
                        Antrean masih kosong. Tambahkan lagu dari Beranda, Playlist, atau Pencarian.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {rightSidebarMode === "lyrics" && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-[#1DB954]">
                      Live Lirik
                    </span>
                    <button
                      onClick={() => setActiveTab("lyrics")}
                      className="text-[11px] text-zinc-400 hover:text-white cursor-pointer"
                    >
                      Layar Penuh ↗
                    </button>
                  </div>
                  {loadingLyrics ? (
                    <p className="text-xs text-zinc-400 py-8 text-center animate-pulse">
                      Mencari lirik...
                    </p>
                  ) : lyrics?.syncedLyrics && lyrics.syncedLyrics.length > 0 ? (
                    <div className="space-y-2.5 py-2">
                      {lyrics.syncedLyrics.map((line, i) => {
                        const isActive = i === activeLyricIndex;
                        return (
                          <p
                            key={`${line.timeMs}-${i}`}
                            onClick={() => {
                              setLocalProgress(line.timeMs);
                              handleControl("seek", { value: line.timeMs });
                            }}
                            className={`text-xs cursor-pointer transition-all rounded-lg px-2 py-1 ${
                              isActive
                                ? "text-[#1DB954] font-extrabold text-sm bg-white/5"
                                : "text-zinc-400 hover:text-white"
                            }`}
                          >
                            {line.text || "♪ • • •"}
                          </p>
                        );
                      })}
                    </div>
                  ) : lyrics?.plainLyrics ? (
                    <div className="whitespace-pre-line text-xs text-zinc-300 leading-relaxed">
                      {lyrics.plainLyrics}
                    </div>
                  ) : (
                    <p className="text-xs text-zinc-500 py-8 text-center">
                      Lirik belum ditemukan untuk lagu ini.
                    </p>
                  )}
                </div>
              )}
            </div>
          </aside>
        )}
      </div>

      {/* Built-in Browser Embed Player (Fallback when no Spotify app is open on HP/PC) */}
      {embedUrl && (
        <div className="bg-[#121212] border-t border-white/10 px-4 py-2 flex items-center gap-3 z-30">
          <iframe
            src={embedUrl}
            width="100%"
            height="80"
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            loading="lazy"
            className="rounded-xl border-0 flex-1"
          />
          <button
            onClick={() => setEmbedUrl(null)}
            className="text-xs text-zinc-400 hover:text-white px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 cursor-pointer shrink-0"
            title="Tutup Pemutar Embed"
          >
            ✕ Tutup
          </button>
        </div>
      )}

      {/* Persistent Bottom Player Bar */}
      <footer className="h-24 bg-[#09090b] border-t border-white/10 px-4 sm:px-6 flex items-center justify-between gap-4 z-30">
        {/* Left: Current Track Info */}
        <div className="flex items-center gap-3.5 min-w-0 w-1/4">
          {data?.albumImageUrl ? (
            <img
              src={data.albumImageUrl}
              alt={data.album}
              onClick={() => setActiveTab("focus")}
              className="w-14 h-14 rounded-lg object-cover shadow-md cursor-pointer hover:opacity-80 transition-opacity shrink-0"
            />
          ) : (
            <div className="w-14 h-14 rounded-lg bg-zinc-800 flex items-center justify-center text-zinc-500 shrink-0">
              ♪
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p
              onClick={() => (data?.albumId ? openAlbum(data.albumId) : setActiveTab("focus"))}
              className="text-sm font-bold text-white truncate hover:underline cursor-pointer"
            >
              {data?.title || "Belum ada lagu diputar"}
            </p>
            <p
              onClick={() => data?.artistId && openArtist(data.artistId)}
              className="text-xs text-zinc-400 hover:text-white hover:underline truncate cursor-pointer"
            >
              {data?.artist || "Pilih lagu untuk mulai memutar"}
            </p>
          </div>
          {data?.trackId && (
            <button
              onClick={() => handleToggleLike(data.trackId!, "save")}
              className="text-zinc-400 hover:text-[#1DB954] transition-colors p-1.5 cursor-pointer hidden sm:block"
              title="Simpan ke Lagu yang Disukai"
            >
              ♥
            </button>
          )}
        </div>

        {/* Center: Playback Controls + Seek Bar */}
        <div className="flex flex-col items-center max-w-xl w-2/4">
          <div className="flex items-center gap-5 mb-2">
            {/* Shuffle Button */}
            <button
              onClick={() => handleControl("shuffle", { value: !data?.shuffleState })}
              className={`transition-colors cursor-pointer ${
                data?.shuffleState ? "text-[#1DB954]" : "text-zinc-400 hover:text-white"
              }`}
              title="Acak (Shuffle)"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z" />
              </svg>
            </button>

            {/* Previous */}
            <button
              onClick={() => handleControl("previous")}
              className="text-zinc-300 hover:text-white transition-colors cursor-pointer"
              title="Sebelumnya"
            >
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
              </svg>
            </button>

            {/* Play / Pause */}
            <button
              onClick={() => handleControl(data?.isPlaying ? "pause" : "play")}
              className="w-10 h-10 bg-white hover:scale-105 text-black rounded-full flex items-center justify-center shadow-md transition-transform cursor-pointer"
              title={data?.isPlaying ? "Pause (Spasi)" : "Play (Spasi)"}
            >
              {data?.isPlaying ? (
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                </svg>
              ) : (
                <svg className="w-5 h-5 translate-x-0.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>

            {/* Next */}
            <button
              onClick={() => handleControl("next")}
              className="text-zinc-300 hover:text-white transition-colors cursor-pointer"
              title="Selanjutnya"
            >
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
              </svg>
            </button>

            {/* Repeat Button */}
            <button
              onClick={handleCycleRepeat}
              className={`relative transition-colors cursor-pointer ${
                data?.repeatState && data.repeatState !== "off"
                  ? "text-[#1DB954]"
                  : "text-zinc-400 hover:text-white"
              }`}
              title={`Ulangi: ${data?.repeatState || "off"}`}
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z" />
              </svg>
              {data?.repeatState === "track" && (
                <span className="absolute -top-1.5 -right-1.5 text-[9px] bg-[#1DB954] text-black font-black rounded-full w-3.5 h-3.5 flex items-center justify-center">
                  1
                </span>
              )}
            </button>
          </div>

          {/* Seek Bar */}
          <div className="w-full flex items-center gap-2.5">
            <span className="text-[11px] text-zinc-400 w-9 text-right font-mono">
              {formatTime(localProgress)}
            </span>
            <input
              type="range"
              min={0}
              max={data?.durationMs || 100}
              value={localProgress}
              onMouseDown={() => setIsSeeking(true)}
              onTouchStart={() => setIsSeeking(true)}
              onChange={(e) => setLocalProgress( parseInt(e.target.value, 10) )}
              onMouseUp={(e) => {
                const val = parseInt((e.target as HTMLInputElement).value, 10);
                setIsSeeking(false);
                handleControl("seek", { value: val });
              }}
              onTouchEnd={(e) => {
                const val = parseInt((e.target as HTMLInputElement).value, 10);
                setIsSeeking(false);
                handleControl("seek", { value: val });
              }}
              className="flex-1 h-1.5 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-[#1DB954]"
            />
            <span className="text-[11px] text-zinc-400 w-9 font-mono">
              {formatTime(data?.durationMs || 0)}
            </span>
          </div>
        </div>

        {/* Right: Now Playing Panel, Lyrics, Queue, Device Selector & Volume */}
        <div className="flex items-center justify-end gap-1.5 sm:gap-2.5 w-1/4 relative">
          {/* Toggle Right Now Playing Sidebar (Spotify Desktop Icon) */}
          <button
            onClick={() =>
              setRightSidebarMode((prev) => (prev === "closed" ? "now-playing" : "closed"))
            }
            className={`hidden xl:inline-flex p-2 rounded-lg transition-colors cursor-pointer ${
              rightSidebarMode !== "closed"
                ? "text-[#1DB954] bg-white/10"
                : "text-zinc-400 hover:text-white"
            }`}
            title="Tampilan Sedang Diputar (Panel Kanan Spotify)"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-6 16H5V5h8v14zm6 0h-4V5h4v14z" />
            </svg>
          </button>

          {/* Lyrics Button (Spotify Mic Icon) */}
          <button
            onClick={() => setActiveTab(activeTab === "lyrics" ? "home" : "lyrics")}
            className={`p-2 rounded-lg transition-colors cursor-pointer relative ${
              activeTab === "lyrics" ? "text-[#1DB954] bg-white/10" : "text-zinc-400 hover:text-white"
            }`}
            title="Lirik Lagu (Karaoke)"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.49 3 2.89 5.35 5.91 5.78V20H9c-.55 0-1 .45-1 1s.45 1 1 1h6c.55 0 1-.45 1-1s-.45-1-1-1h-2v-2.08c3.02-.43 5.42-2.78 5.91-5.78.1-.6-.39-1.14-1-1.14z" />
            </svg>
            {lyrics?.found && !lyrics?.instrumental && (
              <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-[#1DB954]" />
            )}
          </button>

          {/* Queue Button */}
          <button
            onClick={() => setActiveTab(activeTab === "queue" ? "home" : "queue")}
            className={`p-2 rounded-lg transition-colors cursor-pointer relative ${
              activeTab === "queue" ? "text-[#1DB954] bg-white/10" : "text-zinc-400 hover:text-white"
            }`}
            title="Lihat Antrean"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z" />
            </svg>
            {queueData.queue.length > 0 && (
              <span className="absolute -top-0.5 -right-0.5 text-[9px] bg-[#1DB954] text-black font-black rounded-full px-1">
                {queueData.queue.length}
              </span>
            )}
          </button>

          {/* Device Picker Button */}
          <div className="relative">
            <button
              onClick={() => {
                fetchDevices();
                setShowDevicesMenu((prev) => !prev);
              }}
              className={`p-2 rounded-lg transition-colors cursor-pointer ${
                showDevicesMenu ? "text-[#1DB954] bg-white/10" : "text-zinc-400 hover:text-white"
              }`}
              title="Pilih Perangkat Pemutar (Browser / HP / PC)"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M4 6h18V4H4c-1.1 0-2 .9-2 2v11H0v3h14v-3H4V6zm19 2h-6c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h6c.55 0 1-.45 1-1V9c0-.55-.45-1-1-1zm-1 9h-4v-7h4v7z" />
              </svg>
            </button>

            {showDevicesMenu && (
              <div className="absolute bottom-12 right-0 w-64 bg-zinc-900 border border-white/10 rounded-xl shadow-2xl p-3 z-50">
                <div className="flex items-center justify-between mb-2 pb-2 border-b border-white/10">
                  <span className="text-xs font-bold text-white">Pilih Perangkat Spotify</span>
                  <button
                    onClick={() => setShowDevicesMenu(false)}
                    className="text-xs text-zinc-400 hover:text-white"
                  >
                    ✕
                  </button>
                </div>
                <div className="space-y-1 max-h-52 overflow-y-auto">
                  {webPlayerDeviceId && (
                    <button
                      onClick={() => {
                        handleControl("transfer", { deviceId: webPlayerDeviceId });
                        setShowDevicesMenu(false);
                      }}
                      className={`w-full text-left px-3 py-2 rounded-lg text-xs flex items-center justify-between cursor-pointer ${
                        data?.device?.id === webPlayerDeviceId
                          ? "bg-[#1DB954]/20 text-[#1DB954] font-bold"
                          : "hover:bg-white/5 text-zinc-200"
                      }`}
                    >
                      <span>🌐 Vantara Web Browser</span>
                      {data?.device?.id === webPlayerDeviceId && <span>Aktif</span>}
                    </button>
                  )}
                  {devices
                    .filter((d) => d.id !== webPlayerDeviceId)
                    .map((dev) => (
                      <button
                        key={dev.id}
                        onClick={() => {
                          handleControl("transfer", { deviceId: dev.id });
                          setShowDevicesMenu(false);
                        }}
                        className={`w-full text-left px-3 py-2 rounded-lg text-xs flex items-center justify-between cursor-pointer ${
                          dev.is_active
                            ? "bg-[#1DB954]/20 text-[#1DB954] font-bold"
                            : "hover:bg-white/5 text-zinc-200"
                        }`}
                      >
                        <span className="truncate">
                          {dev.type === "Smartphone" ? "📱" : "💻"} {dev.name}
                        </span>
                        {dev.is_active && <span>Aktif</span>}
                      </button>
                    ))}
                  {devices.length === 0 && !webPlayerDeviceId && (
                    <p className="text-[11px] text-zinc-400 py-2 text-center">
                      Buka aplikasi Spotify di HP/PC atau tunggu Web Player aktif.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Volume Slider + Mute Toggle */}
          <div className="hidden sm:flex items-center gap-2 w-28">
            <button
              onClick={handleToggleMute}
              className="text-zinc-400 hover:text-white shrink-0 cursor-pointer"
              title={volume === 0 ? "Bunyikan (Unmute)" : "Bisukan (Mute)"}
            >
              {volume === 0 ? (
                <svg className="w-4 h-4 text-red-400" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
                </svg>
              )}
            </button>
            <input
              type="range"
              min={0}
              max={100}
              value={volume}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                setVolume(v);
              }}
              onMouseUp={(e) => {
                const v = parseInt((e.target as HTMLInputElement).value, 10);
                handleControl("volume", { value: v });
              }}
              onTouchEnd={(e) => {
                const v = parseInt((e.target as HTMLInputElement).value, 10);
                handleControl("volume", { value: v });
              }}
              className="w-full h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-[#1DB954]"
              title={`Volume: ${volume}%`}
            />
          </div>
        </div>
      </footer>

      {/* MODAL: CREATE NEW PLAYLIST */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#181818] border border-white/10 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <h3 className="text-xl font-bold mb-1">Buat Playlist Spotify Baru</h3>
            <p className="text-xs text-zinc-400 mb-4">
              Playlist ini akan langsung tersimpan di akun Spotify Anda.
            </p>
            <form onSubmit={handleCreatePlaylist} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-zinc-300 block mb-1">Nama Playlist</label>
                <input
                  type="text"
                  required
                  value={newPlaylistName}
                  onChange={(e) => setNewPlaylistName(e.target.value)}
                  placeholder="Contoh: Musik Kerja Vantara"
                  className="w-full bg-zinc-800 border border-white/10 rounded-lg px-3.5 py-2.5 text-sm text-white outline-none focus:border-[#1DB954]"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-zinc-300 block mb-1">Deskripsi (Opsional)</label>
                <input
                  type="text"
                  value={newPlaylistDesc}
                  onChange={(e) => setNewPlaylistDesc(e.target.value)}
                  placeholder="Daftar lagu favorit..."
                  className="w-full bg-zinc-800 border border-white/10 rounded-lg px-3.5 py-2.5 text-sm text-white outline-none focus:border-[#1DB954]"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-full text-xs font-semibold text-zinc-300 hover:bg-white/5 cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="bg-[#1DB954] hover:bg-[#1ed760] text-black font-bold px-5 py-2 rounded-full text-xs cursor-pointer"
                >
                  Simpan Playlist
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: ADD TRACK TO PLAYLIST */}
      {trackToAdd && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#181818] border border-white/10 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold">Tambahkan ke Playlist</h3>
                <p className="text-xs text-zinc-400 truncate max-w-xs">
                  {trackToAdd.name} — {trackToAdd.artists?.map((a: any) => a.name).join(", ")}
                </p>
              </div>
              <button
                onClick={() => setTrackToAdd(null)}
                className="text-zinc-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1">
              {playlists.map((pl) => (
                <button
                  key={pl.id}
                  onClick={() => handleAddTrackToPlaylist(pl.id, trackToAdd.uri, pl.name)}
                  className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-white/10 text-left transition-colors cursor-pointer"
                >
                  <img
                    src={pl.images?.[0]?.url || "https://placehold.co/60x60/27272a/white?text=♪"}
                    alt={pl.name}
                    className="w-10 h-10 rounded object-cover"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{pl.name}</p>
                    <p className="text-xs text-zinc-400">{pl.tracks?.total ?? 0} lagu</p>
                  </div>
                  <span className="text-xs font-bold text-[#1DB954]">+ Tambah</span>
                </button>
              ))}
              {playlists.length === 0 && authMode === "geolab" && (
                <div className="p-4 text-center space-y-3">
                  <p className="text-xs text-zinc-400">
                    Playlist <b>GeoLab</b> belum dibuat di akun Spotify Anda.
                  </p>
                  <button
                    onClick={handleInitGeoLabPlaylist}
                    className="bg-[#1DB954] hover:bg-[#1ed760] text-black text-xs font-bold px-4 py-2 rounded-full cursor-pointer"
                  >
                    + Buat Playlist GeoLab Sekarang
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TrackRow({
  index,
  track,
  isCurrent,
  onPlay,
  onPlayNext,
  onQueue,
  onAddToPlaylist,
  onLike,
  onArtistClick,
  onAlbumClick,
  onMoveUp,
  onMoveDown,
  onRemove,
  removeLabel,
}: {
  index: number;
  track: any;
  isCurrent: boolean;
  onPlay: () => void;
  onPlayNext?: () => void;
  onQueue: () => void;
  onAddToPlaylist: () => void;
  onLike?: () => void;
  onArtistClick?: (artistId: string) => void;
  onAlbumClick?: (albumId: string) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onRemove?: () => void;
  removeLabel?: string;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 px-3 sm:px-4 py-2.5 hover:bg-white/[0.06] transition-colors group ${
        isCurrent ? "bg-[#1DB954]/10" : ""
      }`}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <button
          onClick={onPlay}
          className="w-6 text-center text-xs text-zinc-400 group-hover:text-white font-mono shrink-0 cursor-pointer"
          title="Putar Lagu"
        >
          <span className="group-hover:hidden">{isCurrent ? "▶" : index}</span>
          <span className="hidden group-hover:inline text-[#1DB954]">▶</span>
        </button>

        {track.album?.images?.[0]?.url && (
          <img
            src={track.album.images[0].url}
            alt={track.name}
            onClick={onPlay}
            className="w-10 h-10 rounded object-cover shrink-0 cursor-pointer"
          />
        )}

        <div className="min-w-0 flex-1">
          <p
            onClick={onPlay}
            className={`text-sm font-semibold truncate cursor-pointer hover:underline ${
              isCurrent ? "text-[#1DB954]" : "text-white"
            }`}
          >
            {track.name}
          </p>
          <div className="text-xs text-zinc-400 truncate flex items-center gap-1">
            <span
              onClick={() => {
                const firstArtistId = track.artists?.[0]?.id;
                if (firstArtistId && onArtistClick) {
                  onArtistClick(firstArtistId);
                } else {
                  onPlay();
                }
              }}
              className="hover:text-white hover:underline cursor-pointer truncate"
            >
              {track.artists?.map((a: any) => a.name).join(", ")}
            </span>
            {track.album?.name && (
              <>
                <span>•</span>
                <span
                  onClick={() => {
                    if (track.album?.id && onAlbumClick) {
                      onAlbumClick(track.album.id);
                    }
                  }}
                  className="hover:text-white hover:underline cursor-pointer truncate"
                >
                  {track.album.name}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        {(onMoveUp || onMoveDown) && (
          <div className="flex items-center gap-1 mr-1">
            <button
              onClick={onMoveUp}
              disabled={!onMoveUp}
              className={`w-6 h-6 rounded flex items-center justify-center text-xs transition-colors ${
                onMoveUp
                  ? "text-zinc-300 hover:text-white bg-white/5 hover:bg-white/15 cursor-pointer"
                  : "text-zinc-700 bg-white/[0.02] cursor-not-allowed"
              }`}
              title="Geser Naik di Antrean"
            >
              ↑
            </button>
            <button
              onClick={onMoveDown}
              disabled={!onMoveDown}
              className={`w-6 h-6 rounded flex items-center justify-center text-xs transition-colors ${
                onMoveDown
                  ? "text-zinc-300 hover:text-white bg-white/5 hover:bg-white/15 cursor-pointer"
                  : "text-zinc-700 bg-white/[0.02] cursor-not-allowed"
              }`}
              title="Geser Turun di Antrean"
            >
              ↓
            </button>
          </div>
        )}
        {onLike && (
          <button
            onClick={onLike}
            className="text-xs text-zinc-400 hover:text-[#1DB954] px-2 py-1 rounded hover:bg-white/5 transition-colors cursor-pointer"
            title="Simpan ke Lagu yang Disukai"
          >
            ♥
          </button>
        )}
        {onPlayNext && (
          <button
            onClick={onPlayNext}
            className="hidden md:inline-flex text-[11px] font-medium text-zinc-300 hover:text-white bg-white/5 hover:bg-white/10 px-2.5 py-1 rounded-full transition-colors cursor-pointer"
            title="Putar Berikutnya (Taruh di urutan #1 Antrean)"
          >
            ⏭ Berikutnya
          </button>
        )}
        <button
          onClick={onQueue}
          className="text-[11px] font-medium text-zinc-300 hover:text-white bg-white/5 hover:bg-white/10 px-2.5 py-1 rounded-full transition-colors cursor-pointer"
          title="Tambahkan ke Antrean"
        >
          + Antrean
        </button>
        <button
          onClick={onAddToPlaylist}
          className="text-[11px] font-medium text-[#1DB954] bg-[#1DB954]/10 hover:bg-[#1DB954]/20 px-2.5 py-1 rounded-full transition-colors cursor-pointer"
          title="Tambahkan ke Playlist"
        >
          + Playlist
        </button>
        {onRemove && (
          <button
            onClick={onRemove}
            className="text-[11px] font-medium text-red-400 bg-red-500/10 hover:bg-red-500/20 px-2.5 py-1 rounded-full transition-colors cursor-pointer"
            title="Hapus lagu ini"
          >
            {removeLabel || "Hapus"}
          </button>
        )}
        <span className="text-xs text-zinc-500 font-mono w-10 text-right hidden sm:inline">
          {formatTime(track.duration_ms || 0)}
        </span>
      </div>
    </div>
  );
}

function formatTime(ms: number) {
  if (!ms || ms < 0) return "0:00";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
