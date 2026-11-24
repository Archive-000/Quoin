"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Navbar from "../components/Navbar";
import { useRouter } from "next/navigation";
import {
  API_BASE_URL,
  fetchCurrentUser,
  getToken,
  removeToken,
  setToken,
  type User,
  type Wallet,
} from "../lib/auth";

/**
 * Returns a non-empty display name for a user. Falls back to "U" so the
 * initial-letter badge is never rendered blank (the previous code used
 * `??`, which treats `""` as a valid value and produced an empty circle
 * when the backend returned an empty username/email).
 */
function getDisplayName(user: User): string {
  const username = user.username?.trim();
  if (username) return username;
  const email = user.email?.trim();
  if (email) return email;
  return "U";
}

function UserAvatar({ user }: { user: User }) {
  const [imageFailed, setImageFailed] = useState(false);
  const displayName = getDisplayName(user);
  const initial = displayName.charAt(0).toUpperCase() || "U";
  const avatarUrl = user.avatarUrl?.trim();

  if (avatarUrl && !imageFailed) {
    return (
      // Plain <img> is intentional: avatar URLs are supplied by the
      // backend (or the user) and may point at arbitrary hosts that are
      // not whitelisted for next/image. onError flips back to the
      // initial-letter badge so a broken URL never leaves an empty
      // square behind.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt={`${displayName}'s avatar`}
        referrerPolicy="no-referrer"
        loading="lazy"
        decoding="async"
        className="h-10 w-10 flex-shrink-0 rounded-full bg-cyan-500/20 object-cover"
        onError={() => setImageFailed(true)}
      />
    );
  }

  return (
    <div
      aria-hidden="true"
      className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-cyan-500/20 font-bold text-cyan-300"
    >
      {initial}
    </div>
  );
}

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newToken, setNewToken] = useState("");
  const hydratedRef = useRef(false);

  const loadUser = useCallback(
    async (tokenValue: string) => {
      setIsLoading(true);
      setError(null);
      try {
        const current = await fetchCurrentUser(tokenValue);
        setUser(current);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load user profile",
        );
        setUser(null);
        removeToken();
      } finally {
        setIsLoading(false);
      }
    },
    [removeToken],
  );

  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;

    const stored = getToken();
    if (stored) {
      void loadUser(stored);
    } else {
      setIsLoading(false);
    }
  }, [loadUser]);

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = newToken.trim();
    if (!value) return;
    setToken(value);
    await loadUser(value);
  };

  const handleLogout = () => {
    removeToken();
    setUser(null);
    setError(null);
    setNewToken("");
    router.replace("/");
  };

  return (
    <main className="min-h-screen bg-[#02030a] text-white py-12 px-4 sm:px-6 lg:px-8">
      <Navbar />
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-bold mb-6">Profile</h1>

        {isLoading && (
          <div className="rounded-2xl border border-white/10 bg-black/20 px-6 py-4 text-white/70">
            Loading your profile...
          </div>
        )}

        {!isLoading && error && !user && (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-6 py-4 text-red-300 mb-6">
            {error}
          </div>
        )}

        {!user && (
          <section className="rounded-2xl border border-white/10 bg-black/20 px-6 py-8 mb-6">
            <h2 className="text-lg font-semibold mb-2">
              Log in to view your profile
            </h2>
            <p className="text-sm text-white/60 mb-4">
              Obtain an access token by calling
              <code className="text-cyan-300 font-mono text-xs">
                POST {API_BASE_URL}/auth/wallet/login
              </code>{" "}
              (request a nonce, sign it, then log in), then paste the returned
              `accessToken` below.
            </p>
            <form
              onSubmit={handleLogin}
              className="flex flex-col gap-3 md:flex-row md:gap-4"
            >
              <input
                type="text"
                value={newToken}
                onChange={(event) => setNewToken(event.target.value)}
                placeholder="Paste access token..."
                className="flex-1 mt-2 w-full rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-sm outline-none placeholder:text-white/30 focus:border-cyan-400/40"
              />
              <button
                type="submit"
                disabled={isLoading}
                className="rounded-full bg-cyan-300 px-6 py-3 text-sm font-semibold text-black transition hover:bg-cyan-200 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isLoading ? "Signing in..." : "Sign in"}
              </button>
            </form>
          </section>
        )}

        {user && (
          <>
            <section className="rounded-2xl border border-white/10 bg-black/20 px-6 py-6 mb-6">
              <div className="flex items-center gap-4 mb-4">
                <UserAvatar user={user} />
                <div>
                  <h2 className="text-lg font-semibold">
                    {user.username?.trim() ||
                      user.email?.trim() ||
                      "Unnamed user"}
                  </h2>
                  <p className="text-sm text-white/60 truncate max-w-xs">
                    {user.id}
                  </p>
                </div>
                <button
                  onClick={handleLogout}
                  className="ml-auto text-sm text-white/70 hover:text-white underline"
                >
                  Log out
                </button>
              </div>
              <dl className="grid gap-2 text-sm text-white/70">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  <dt className="text-xs uppercase text-white/50">Status</dt>
                  <dd className="flex items-center gap-1.5">
                    {user.isActive ? (
                      <span className="flex h-2 w-2 rounded-full bg-green-500"></span>
                    ) : (
                      <span className="flex h-2 w-2 rounded-full bg-red-500"></span>
                    )}
                    {user.isActive ? "Active" : "Inactive"}
                  </dd>
                  <dt className="text-xs uppercase text-white/50">
                    Member since
                  </dt>
                  <dd>{new Date(user.createdAt).toLocaleDateString()}</dd>
                  <dt className="text-xs uppercase text-white/50">Email</dt>
                  <dd>{user.email ?? "-"}</dd>
                  <dt className="text-xs uppercase text-white/50">Username</dt>
                  <dd>{user.username ?? "-"}</dd>
                </div>
              </dl>
            </section>

            {user.wallets && user.wallets.length > 0 && (
              <section className="rounded-2xl border border-white/10 bg-black/20 px-6 py-6">
                <h3 className="text-sm font-semibold text-white/60 uppercase tracking-wider mb-3">
                  Connected wallets ({user.wallets.length})
                </h3>
                <div className="grid gap-3">
                  {user.wallets.map((wallet: Wallet) => (
                    <div
                      key={wallet.id}
                      className="rounded-xl border border-white/10 bg-black/50 p-3 text-sm"
                    >
                      <div className="flex justify-between items-center mb-1">
                        <span className="font-mono text-xs text-cyan-300">
                          {wallet.publicKey}
                        </span>
                        {wallet.isPrimary && (
                          <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded">
                            Primary
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-white/50">
                        <span>Last used:</span>
                        <span className="truncate">
                          {wallet.lastUsed
                            ? new Date(wallet.lastUsed).toLocaleString()
                            : "-"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
