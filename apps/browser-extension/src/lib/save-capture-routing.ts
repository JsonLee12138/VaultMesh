type LoginCaptureReference = { username: string; loginId?: string };
type LoginCandidateReference = { id: string; subtitle: string };

export function routeLoginCaptureByDefault<T extends LoginCaptureReference>(
  login: T,
  candidates: LoginCandidateReference[],
  defaultLoginId: string | null,
): Omit<T, "loginId"> & { loginId?: string } {
  if (login.loginId || normalizedUsername(login.username) || !defaultLoginId) return login;
  const defaultLogin = candidates.find((candidate) => candidate.id === defaultLoginId);
  return defaultLogin
    ? { ...login, username: defaultLogin.subtitle, loginId: defaultLogin.id }
    : login;
}

export function routeLoginCaptureByUsername<T extends LoginCaptureReference>(
  login: T,
  candidates: LoginCandidateReference[],
): Omit<T, "loginId"> & { loginId?: string } {
  const username = normalizedUsername(login.username);
  const { loginId: _discardedLoginId, ...withoutLoginId } = login;
  if (!username) return withoutLoginId;

  // A form that was filled from an existing item has an authoritative source
  // item.  Only an unchanged username may update that item.  Do not reroute a
  // changed username to another same-site item: changing the account name is
  // a request to create a separate account, never to overwrite one.
  if (login.loginId) {
    const source = candidates.find((candidate) => candidate.id === login.loginId);
    return source && normalizedUsername(source.subtitle) === username
      ? { ...withoutLoginId, loginId: source.id }
      : withoutLoginId;
  }

  const matches = candidates.filter((candidate) => normalizedUsername(candidate.subtitle) === username);
  if (matches.length !== 1) return withoutLoginId;
  return { ...withoutLoginId, loginId: matches[0]!.id };
}

function normalizedUsername(value: string): string {
  return value.trim().toLocaleLowerCase();
}
