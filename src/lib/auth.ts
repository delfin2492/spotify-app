import { AuthOptions, getServerSession } from "next-auth";
import SpotifyProvider from "next-auth/providers/spotify";
import { tokenCache } from "./spotify-cache";
import fs from "fs";
import path from "path";

const scopes = [
  "streaming",
  "user-read-email",
  "user-read-private",
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
  "user-read-recently-played",
  "user-top-read",
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-public",
  "playlist-modify-private",
  "user-library-read",
  "user-library-modify",
].join(" ");

async function refreshAccessToken(token: any) {
  try {
    const basicAuth = Buffer.from(
      `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
    ).toString("base64");

    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: token.refreshToken,
      }),
    });

    const refreshedTokens = await response.json();

    if (!response.ok) {
      throw refreshedTokens;
    }

    return {
      ...token,
      accessToken: refreshedTokens.access_token,
      expiresAt: Math.floor(Date.now() / 1000 + refreshedTokens.expires_in),
      refreshToken: refreshedTokens.refresh_token ?? token.refreshToken,
    };
  } catch (error) {
    console.error("Error refreshing access token", error);
    return {
      ...token,
      error: "RefreshAccessTokenError",
    };
  }
}

export const authOptions: AuthOptions = {
  providers: [
    SpotifyProvider({
      clientId: process.env.SPOTIFY_CLIENT_ID as string,
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET as string,
      authorization: {
        url: "https://accounts.spotify.com/authorize",
        params: {
          scope: scopes,
          show_dialog: "true",
        },
      },
    }),
  ],
  secret: process.env.NEXTAUTH_SECRET,
  callbacks: {
    async jwt({ token, account, user }) {
      if (account && user) {
        tokenCache.accessToken = account.access_token ?? null;
        tokenCache.expiresAt = (account.expires_at ?? 0) * 1000;
        return {
          ...token,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          expiresAt: account.expires_at,
        };
      }

      // Return previous token if the access token has not expired yet (with 60s buffer)
      if (token.expiresAt && Date.now() < ((token.expiresAt as number) * 1000) - 60000) {
        return token;
      }

      // Access token has expired, refresh it
      if (token.refreshToken) {
        return await refreshAccessToken(token);
      }

      return token;
    },
    async session({ session, token }: any) {
      session.accessToken = token.accessToken;
      session.refreshToken = token.refreshToken;
      session.error = token.error;
      return session;
    },
  },
};

export async function getValidAccessToken(): Promise<string | null> {
  const session = (await getServerSession(authOptions)) as any;
  if (session?.accessToken && !session?.error) {
    tokenCache.accessToken = session.accessToken;
    if (session?.refreshToken) {
      tokenCache.refreshToken = session.refreshToken;
    }
    tokenCache.expiresAt = Date.now() + 30 * 60 * 1000;
    return session.accessToken;
  }

  // Fallback untuk perangkat yang login menggunakan PIN (tanpa sesi OAuth di browser tersebut)
  try {
    if (tokenCache.accessToken && Date.now() < tokenCache.expiresAt - 60000) {
      return tokenCache.accessToken;
    }

    let refreshToken =
      session?.refreshToken ||
      tokenCache.refreshToken ||
      process.env.SPOTIFY_REFRESH_TOKEN;

    if (!refreshToken) {
      const tmpFile = "/tmp/.spotify-token";
      const localFile = path.join(process.cwd(), ".spotify-token");
      if (fs.existsSync(tmpFile)) {
        refreshToken = fs.readFileSync(tmpFile, "utf8").trim();
      } else if (fs.existsSync(localFile)) {
        refreshToken = fs.readFileSync(localFile, "utf8").trim();
      }
    }

    if (!refreshToken) return null;

    const refreshed = await refreshAccessToken({ refreshToken });
    if (refreshed.accessToken) {
      tokenCache.accessToken = refreshed.accessToken;
      tokenCache.refreshToken = refreshed.refreshToken || refreshToken;
      tokenCache.expiresAt = (refreshed.expiresAt as number) * 1000;
      return refreshed.accessToken;
    }
  } catch (e) {
    console.error("Fallback token refresh failed:", e);
  }

  return null;
}
