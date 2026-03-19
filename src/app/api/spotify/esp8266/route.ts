import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { getNowPlaying } from '@/lib/spotify';
import fs from 'fs';
import path from 'path';

// File untuk menyimpan refresh token agar bisa diakses tanpa login browser
const TOKEN_FILE = path.join(process.cwd(), '.spotify-token');

import { tokenCache } from '@/lib/spotify-cache';

async function getAccessToken() {
  try {
    // Jika masih ada token di cache dan belum expired (beri buffer 1 menit)
    if (tokenCache.accessToken && Date.now() < tokenCache.expiresAt - 60000) {
      return tokenCache.accessToken;
    }

    if (!fs.existsSync(TOKEN_FILE)) return null;
    const refreshToken = fs.readFileSync(TOKEN_FILE, 'utf8');

    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(
          `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
        ).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });

    const data = await response.json();
    
    if (data.access_token) {
      tokenCache.accessToken = data.access_token;
      tokenCache.expiresAt = Date.now() + (data.expires_in * 1000);
      return data.access_token;
    }
    return null;
  } catch (e) {
    return null;
  }
}

export async function GET() {
  const accessToken = await getAccessToken();

  if (!accessToken) {
    return NextResponse.json({ error: 'No token found. Please login to the web app first.' }, { status: 401 });
  }

  try {
    const response = await getNowPlaying(accessToken);

    if (response.status === 204 || response.status > 400) {
      return NextResponse.json({ isPlaying: false });
    }

    const song = await response.json();
    
    // Format super simpel untuk ESP8266 agar hemat memori
    return NextResponse.json({
      title: song.item.name,
      artist: song.item.artists[0].name,
      isPlaying: song.is_playing,
      progress: song.progress_ms,
      duration: song.item.duration_ms
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      }
    });
  } catch (error) {
    return NextResponse.json({ isPlaying: false }, { status: 500 });
  }
}
