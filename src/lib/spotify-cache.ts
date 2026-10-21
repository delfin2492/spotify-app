// Cache sederhana untuk menyimpan access token & refresh token di memori server
export const tokenCache = {
  accessToken: null as string | null,
  refreshToken: null as string | null,
  expiresAt: 0,
};
