/**
 * Authentication / authorisation boundary.
 *
 * The MVP is a read-only static bundle, so there is nothing to protect at the
 * client. `MockAuthProvider` returns a viewer identity without contacting any
 * IdP. When the site moves behind the organisation's approved SSO, implement
 * `AuthProvider` against it and swap the instance in `createAuthProvider`.
 *
 * Never put a client secret in this file — the bundle is public.
 */

export type Role = 'viewer' | 'editor' | 'admin';

export interface Identity {
  id: string;
  displayName: string;
  role: Role;
}

export interface AuthProvider {
  readonly id: string;
  getIdentity(): Promise<Identity>;
  signIn(): Promise<Identity>;
  signOut(): Promise<void>;
}

const VIEWER: Identity = {
  id: 'anonymous',
  displayName: '閲覧者',
  role: 'viewer',
};

export class MockAuthProvider implements AuthProvider {
  readonly id = 'mock';

  async getIdentity(): Promise<Identity> {
    return VIEWER;
  }

  async signIn(): Promise<Identity> {
    return VIEWER;
  }

  async signOut(): Promise<void> {
    // no-op
  }
}

/** Capability checks used by the UI. Editing is out of scope for the MVP. */
export function canEdit(identity: Identity): boolean {
  return identity.role === 'editor' || identity.role === 'admin';
}

export function canAdminister(identity: Identity): boolean {
  return identity.role === 'admin';
}

let provider: AuthProvider | null = null;

export function createAuthProvider(): AuthProvider {
  if (!provider) provider = new MockAuthProvider();
  return provider;
}

/** Test seam. */
export function setAuthProvider(next: AuthProvider | null): void {
  provider = next;
}
