import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const TOKEN_FILE = path.join(process.cwd(), '.spotify-token');

export async function POST(req: Request) {
  try {
    const { refreshToken } = await req.json();
    if (refreshToken) {
      fs.writeFileSync(TOKEN_FILE, refreshToken, 'utf8');
      return NextResponse.json({ success: true });
    }
    return NextResponse.json({ success: false }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
