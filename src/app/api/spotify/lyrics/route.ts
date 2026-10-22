import { NextRequest, NextResponse } from "next/server";

export interface SyncedLyricLine {
  timeMs: number;
  text: string;
}

/**
 * Clean up track titles from Spotify metadata (e.g., "- Remastered 2011", "(feat. ...)", "[Live]")
 * so lyric search engines find accurate matches.
 */
function cleanTrackTitle(title: string): string {
  return title
    .replace(/\s*\((?:feat\.?|ft\.?|with|prod\.?|from|remaster|live|acoustic|bonus|deluxe|version|edit)[^)]*\)/gi, "")
    .replace(/\s*\[(?:feat\.?|ft\.?|with|remaster|live|acoustic|bonus|deluxe|version|edit)[^\]]*\]/gi, "")
    .replace(/\s*-\s*(?:\d{4}\s*)?(?:remaster(?:ed)?|live|mono|stereo|single|album|radio|version|edit|mix).*$/i, "")
    .trim();
}

/**
 * Extract primary artist name (first artist before comma)
 */
function primaryArtist(artist: string): string {
  return artist.split(",")[0].trim();
}

/**
 * Parse LRC format string into array of { timeMs, text }
 * Supports [mm:ss.xx] or [mm:ss.xxx] or [mm:ss]
 */
function parseLrc(lrc: string): SyncedLyricLine[] {
  const lines = lrc.split(/\r?\n/);
  const result: SyncedLyricLine[] = [];
  const timeRegex = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;

  for (const rawLine of lines) {
    const matches = [...rawLine.matchAll(timeRegex)];
    if (matches.length === 0) continue;

    const text = rawLine.replace(timeRegex, "").trim();
    for (const match of matches) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const fractionStr = match[3] || "0";
      const millis =
        fractionStr.length === 1
          ? parseInt(fractionStr, 10) * 100
          : fractionStr.length === 2
          ? parseInt(fractionStr, 10) * 10
          : parseInt(fractionStr, 10);

      const timeMs = minutes * 60 * 1000 + seconds * 1000 + millis;
      result.push({ timeMs, text });
    }
  }

  return result.sort((a, b) => a.timeMs - b.timeMs);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const title = searchParams.get("title")?.trim() || "";
  const artist = searchParams.get("artist")?.trim() || "";
  const album = searchParams.get("album")?.trim() || "";
  const durationMs = parseInt(searchParams.get("durationMs") || "0", 10);

  if (!title) {
    return NextResponse.json({ error: "Missing track title" }, { status: 400 });
  }

  const cleanedTitle = cleanTrackTitle(title);
  const mainArtist = primaryArtist(artist);
  const durationSec = durationMs > 0 ? Math.round(durationMs / 1000) : 0;

  const headers = {
    "User-Agent": "VantaraMusicPlatform/1.0 (https://github.com/vantara-music)",
  };

  try {
    // 1. Try exact match on LRCLIB if artist & title are available
    if (mainArtist && cleanedTitle) {
      const getParams = new URLSearchParams({
        track_name: cleanedTitle,
        artist_name: mainArtist,
      });
      if (album) getParams.set("album_name", album);
      if (durationSec > 0) getParams.set("duration", String(durationSec));

      const exactRes = await fetch(`https://lrclib.net/api/get?${getParams.toString()}`, {
        headers,
        next: { revalidate: 3600 },
      });

      if (exactRes.ok) {
        const item = await exactRes.json();
        if (item && (item.syncedLyrics || item.plainLyrics || item.instrumental)) {
          return NextResponse.json({
            found: true,
            instrumental: Boolean(item.instrumental),
            syncedLyrics: item.syncedLyrics ? parseLrc(item.syncedLyrics) : [],
            plainLyrics: item.plainLyrics || "",
            trackName: item.trackName || title,
            artistName: item.artistName || artist,
            source: "LRCLIB",
          });
        }
      }
    }

    // 2. Fallback: Search on LRCLIB with cleaned title + main artist
    const searchQueries = [
      `${cleanedTitle} ${mainArtist}`.trim(),
      `${title} ${mainArtist}`.trim(),
      cleanedTitle,
    ];

    for (const q of searchQueries) {
      if (!q) continue;
      const searchRes = await fetch(
        `https://lrclib.net/api/search?q=${encodeURIComponent(q)}`,
        { headers, next: { revalidate: 3600 } }
      );

      if (searchRes.ok) {
        const list = await searchRes.json();
        if (Array.isArray(list) && list.length > 0) {
          // Prefer results that match artist name and have syncedLyrics
          const artistLower = mainArtist.toLowerCase();
          const matchedArtist = list.filter((it: any) =>
            (it.artistName || "").toLowerCase().includes(artistLower) ||
            artistLower.includes((it.artistName || "").toLowerCase())
          );

          const pool = matchedArtist.length > 0 ? matchedArtist : list;

          // Sort pool by: has syncedLyrics first, then closest duration if durationSec > 0
          pool.sort((a: any, b: any) => {
            const aSynced = a.syncedLyrics ? 1 : 0;
            const bSynced = b.syncedLyrics ? 1 : 0;
            if (aSynced !== bSynced) return bSynced - aSynced;
            if (durationSec > 0 && a.duration && b.duration) {
              return Math.abs(a.duration - durationSec) - Math.abs(b.duration - durationSec);
            }
            return 0;
          });

          const best = pool.find((it: any) => it.syncedLyrics || it.plainLyrics || it.instrumental);
          if (best) {
            return NextResponse.json({
              found: true,
              instrumental: Boolean(best.instrumental),
              syncedLyrics: best.syncedLyrics ? parseLrc(best.syncedLyrics) : [],
              plainLyrics: best.plainLyrics || "",
              trackName: best.trackName || title,
              artistName: best.artistName || artist,
              source: "LRCLIB",
            });
          }
        }
      }
    }

    // 3. Second Fallback: lyrics.ovh for plain lyrics
    if (mainArtist && cleanedTitle) {
      const ovhRes = await fetch(
        `https://api.lyrics.ovh/v1/${encodeURIComponent(mainArtist)}/${encodeURIComponent(cleanedTitle)}`,
        { signal: AbortSignal.timeout(4500) }
      ).catch(() => null);

      if (ovhRes && ovhRes.ok) {
        const ovhJson = await ovhRes.json();
        if (ovhJson?.lyrics) {
          return NextResponse.json({
            found: true,
            instrumental: false,
            syncedLyrics: [],
            plainLyrics: ovhJson.lyrics.trim(),
            trackName: title,
            artistName: artist,
            source: "Lyrics.ovh",
          });
        }
      }
    }

    return NextResponse.json({
      found: false,
      instrumental: false,
      syncedLyrics: [],
      plainLyrics: "",
    });
  } catch (error) {
    console.error("Error fetching lyrics:", error);
    return NextResponse.json(
      {
        found: false,
        instrumental: false,
        syncedLyrics: [],
        plainLyrics: "",
      },
      { status: 200 }
    );
  }
}
