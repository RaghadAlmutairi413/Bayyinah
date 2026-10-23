const ACCESS_KEY = 'bayyinahAccessToken';
const REFRESH_KEY = 'bayyinahRefreshToken';
const USER_KEY = 'bayyinahUser';

export function displayName(person) {
  return `${person?.first_name || ''} ${person?.last_name || ''}`.trim();
}

export function saveLogin(login) {
  sessionStorage.setItem(ACCESS_KEY, login.access);
  sessionStorage.setItem(REFRESH_KEY, login.refresh);
  sessionStorage.setItem(USER_KEY, JSON.stringify(login.user));
}

export function getLogin() {
  const access = sessionStorage.getItem(ACCESS_KEY);
  const user = sessionStorage.getItem(USER_KEY);
  if (!access || !user) return null;

  const parsedUser = JSON.parse(user);
  if (
    typeof parsedUser.first_name !== 'string'
    || typeof parsedUser.last_name !== 'string'
  ) {
    clearLogin();
    return null;
  }
  return { access, user: parsedUser };
}

export function clearLogin() {
  sessionStorage.removeItem(ACCESS_KEY);
  sessionStorage.removeItem(REFRESH_KEY);
  sessionStorage.removeItem(USER_KEY);
}

export async function apiRequest(path, options = {}) {
  const request = async (access) => fetch(path, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(access ? { Authorization: `Bearer ${access}` } : {}),
    },
  });

  let access = sessionStorage.getItem(ACCESS_KEY);
  let response = await request(access);
  if (response.status !== 401) {
    return response;
  }

  const refresh = sessionStorage.getItem(REFRESH_KEY);
  if (!refresh) {
    clearLogin();
    window.location.assign('/login');
    throw new Error('Your session ended. Please sign in again.');
  }

  const refreshResponse = await fetch('/api/accounts/token/refresh/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh }),
  });
  const tokens = await refreshResponse.json();
  if (!refreshResponse.ok) {
    clearLogin();
    window.location.assign('/login');
    throw new Error('Your session ended. Please sign in again.');
  }

  access = tokens.access;
  sessionStorage.setItem(ACCESS_KEY, access);
  return request(access);
}

export async function responseData(response) {
  const body = await response.text();
  let data;
  try {
    data = body ? JSON.parse(body) : null;
  } catch {
    throw new Error(
      response.status >= 500
        ? 'The server could not complete your request. Please try again in a moment.'
        : 'We could not complete your request. Please try again.',
    );
  }

  if (data === null) {
    throw new Error(
      response.status >= 500
        ? 'The server could not complete your request. Please try again in a moment.'
        : 'We could not complete your request. Please try again.',
    );
  }

  if (!response.ok) {
    const collect = (value) => {
      if (typeof value === 'string') return [value];
      if (Array.isArray(value)) return value.flatMap(collect);
      if (value && typeof value === 'object') return Object.values(value).flatMap(collect);
      return [];
    };
    const messages = collect(data);
    throw new Error(messages.join(' ') || 'The request failed. Please try again.');
  }
  return data;
}
