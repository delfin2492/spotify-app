import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session || !(session as any).refreshToken) {
    return NextResponse.json({ error: 'Please login first at the home page!' }, { status: 401 });
  }

  return NextResponse.json({ 
    instructions: "Copy the refreshToken below and paste it into Vercel Environment Variables as 'SPOTIFY_REFRESH_TOKEN'",
    refreshToken: (session as any).refreshToken 
  });
}
