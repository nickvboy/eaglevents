export const APP_NAME = "EagleEvents";
export const APP_SLUG = "eaglevents";

// Database table prefix retained for backward compatibility.
// Update this only after migrating existing tables.
export const DB_TABLE_PREFIX = "t3-app-template";
export const withDbTablePrefix = (name) => `${DB_TABLE_PREFIX}_${name}`;

export const COOKIE_NAME_PREFIX = APP_SLUG;

export const getSessionCookieName = (useSecureCookies) =>
  useSecureCookies
    ? `__Secure-${COOKIE_NAME_PREFIX}.session-token`
    : `${COOKIE_NAME_PREFIX}.session-token`;

export const authCookieNames = {
  sessionToken: getSessionCookieName,
  csrfToken: `${COOKIE_NAME_PREFIX}.csrf-token`,
  nonce: `${COOKIE_NAME_PREFIX}.nonce`,
  state: `${COOKIE_NAME_PREFIX}.state`,
  pkceCodeVerifier: `${COOKIE_NAME_PREFIX}.pkce`,
  callbackUrl: `${COOKIE_NAME_PREFIX}.callback-url`,
};