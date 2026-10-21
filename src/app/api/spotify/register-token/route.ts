import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { tokenCache } from '@/lib/spotify-cache';

const TOKEN_FILE = path.join(process.cwd(), '.spotify-token');
const TMP_TOKEN_FILE = '/tmp/.spotify-token';

export async function POST(req: Request) {
  try {
    const { refreshToken } = await req.json();
    if (refreshToken) {
      tokenCache.refreshToken = refreshToken;

      console.log("=== COPY THIS REFRESH TOKEN TO VERCEL ENV 'SPOTIFY_REFRESH_TOKEN' ===");
      console.log(refreshToken);
      console.log("======================================================================");

      try {
        fs.writeFileSync(TOKEN_FILE, refreshToken, 'utf8');
      } catch (e) {}

      try {
        fs.writeFileSync(TMP_TOKEN_FILE, refreshToken, 'utf8');
      } catch (e) {}

      return NextResponse.json({ success: true });
    }
    return NextResponse.json({ success: false }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
