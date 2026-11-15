/**
 * Where a signed-out person is sent back to after they sign in again.
 * Account settings is never a place to return to: signing out happens there, so remembering it would send the next
 * sign-in straight back to Settings instead of the home page. Everything else (a project page, a join link) is remembered.
 */
export function signInReturnPath(pathname: string, search = ''): string {
  if (pathname === '/settings') return '/'
  return pathname + search
}
