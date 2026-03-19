// Cache sederhana untuk menyimpan access token di memori server
export const tokenCache = {
  accessToken: null as string | null,
  expiresAt: 0,
};
