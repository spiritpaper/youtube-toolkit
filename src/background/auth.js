// Google sign-in for the user's own YouTube Analytics. Uses the browser's
// OAuth window (chrome.identity.launchWebAuthFlow) with the user's own
// "Web application" client ID, so no server and no client secret are needed.
// Access tokens last an hour; they're kept in session storage (memory only)
// and renewed silently while the user stays signed in to Google.

export const SCOPES = [
  'https://www.googleapis.com/auth/yt-analytics.readonly',
  'https://www.googleapis.com/auth/youtube.readonly',
];

import { removePrefix } from './cache.js';

export class AuthError extends Error {
  constructor(message, reason = 'auth') {
    super(message);
    this.reason = reason;
  }
}

export const redirectUri = () => chrome.identity.getRedirectURL();

async function settings() {
  const { google = {} } = await chrome.storage.local.get('google');
  return google;
}

// Parses the token response from the redirect URL's fragment.
export function parseRedirect(url, expectedState) {
  const params = new URLSearchParams(new URL(url).hash.slice(1));
  if (params.get('error')) {
    throw new AuthError(
      params.get('error') === 'access_denied' ? 'Sign-in was cancelled.' : `Google sign-in failed: ${params.get('error')}`,
      params.get('error'),
    );
  }
  if (params.get('state') !== expectedState) throw new AuthError('Sign-in response did not match the request.');
  const token = params.get('access_token');
  if (!token) throw new AuthError('Google did not return an access token.');
  const granted = (params.get('scope') ?? '').split(' ');
  const missing = SCOPES.filter((s) => !granted.includes(s));
  if (missing.length && params.get('scope')) {
    throw new AuthError('Please allow access to both YouTube permissions when signing in.', 'scopes');
  }
  return { token, expiresAt: Date.now() + (Number(params.get('expires_in') ?? 3600) - 60) * 1000 };
}

async function authorize({ interactive }) {
  const { clientId, loginHint } = await settings();
  if (!clientId) throw new AuthError('Add your Google OAuth client ID in Settings first.', 'noClient');
  const state = crypto.randomUUID();
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: 'token',
    scope: SCOPES.join(' '),
    include_granted_scopes: 'true',
    state,
    ...(interactive ? { prompt: 'select_account' } : { prompt: 'none' }),
    ...(loginHint ? { login_hint: loginHint } : {}),
  });
  let redirect;
  try {
    redirect = await chrome.identity.launchWebAuthFlow({ url: url.href, interactive });
  } catch (err) {
    throw new AuthError(
      interactive ? `Sign-in window failed: ${err.message}` : 'Your Google session expired. Sign in again.',
      interactive ? 'auth' : 'signedOut',
    );
  }
  const session = parseRedirect(redirect, state);
  await chrome.storage.session.set({ googleToken: session });
  return session.token;
}

let pending = null;
/** A valid access token; signs in silently if needed. */
export async function getToken({ interactive = false } = {}) {
  const { googleToken } = await chrome.storage.session.get('googleToken');
  if (googleToken && googleToken.expiresAt > Date.now()) return googleToken.token;
  const { signedIn } = await settings();
  if (!signedIn && !interactive) throw new AuthError('Sign in with Google to see your own analytics.', 'signedOut');
  pending ??= authorize({ interactive }).finally(() => (pending = null));
  return pending;
}

export async function signIn() {
  await chrome.storage.session.remove('googleToken');
  const token = await getToken({ interactive: true });
  // Remember which channel this is, so silent renewals pick the same account.
  const res = await fetch(
    'https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true',
    { headers: { authorization: `Bearer ${token}` } },
  );
  const body = await res.json().catch(() => ({}));
  const ch = body.items?.[0];
  if (!res.ok || !ch) {
    throw new AuthError(body.error?.message ?? 'This Google account has no YouTube channel.', 'noChannel');
  }
  const me = { id: ch.id, title: ch.snippet.title, thumb: ch.snippet.thumbnails?.default?.url ?? '', handle: ch.snippet.customUrl ?? '' };
  const google = await settings();
  await chrome.storage.local.set({ google: { ...google, signedIn: true, me } });
  return me;
}

export async function signOut() {
  const { googleToken } = await chrome.storage.session.get('googleToken');
  if (googleToken?.token) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(googleToken.token)}`, { method: 'POST' }).catch(() => {});
  }
  await chrome.storage.session.remove('googleToken');
  await removePrefix('ya:'); // cached private analytics
  const google = await settings();
  await chrome.storage.local.set({ google: { clientId: google.clientId } });
  return true;
}

export async function authStatus() {
  const google = await settings();
  return { redirectUri: redirectUri(), clientId: google.clientId ?? '', signedIn: !!google.signedIn, me: google.me ?? null };
}
