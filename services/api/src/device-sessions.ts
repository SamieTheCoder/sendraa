import { createAuthEndpoint, sessionMiddleware } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';

/** Enroll an existing pre-multi-session login without asking for its password again. */
export const rememberDeviceSession = () => ({
  id: 'remember-device-session',
  endpoints: {
    rememberDeviceSession: createAuthEndpoint('/multi-session/remember', {
      method: 'POST', requireHeaders: true, use: [sessionMiddleware],
    }, async (ctx) => {
      await setSessionCookie(ctx, ctx.context.session);
      return ctx.json({ ok: true });
    }),
  },
});
