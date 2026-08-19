export type JwtAccessTokenPayload = {
  userId: number;
};

export type JwtRefreshTokenPayload = JwtAccessTokenPayload & {
  sessionId: string;
};
