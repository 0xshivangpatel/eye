// Auth client. Cookies are httpOnly and same-origin, so every request just
// needs credentials: "include"; there is no token to store in JS.
export interface User {
  id: string;
  username: string;
  role: "admin" | "user";
}

async function call<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    credentials: "include",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      message = ((await res.json()) as { error?: string }).error ?? message;
    } catch {
      /* ignore */
    }
    const err = new Error(message) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

export const authApi = {
  me: () => call<{ user: User }>("/auth/me"),
  login: (username: string, password: string) =>
    call<{ user: User }>("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  logout: () => call<{ ok: true }>("/auth/logout", { method: "POST" }),
  listUsers: () => call<{ users: User[] }>("/auth/users"),
  createUser: (username: string, password: string, role: "admin" | "user") =>
    call<{ user: User }>("/auth/users", { method: "POST", body: JSON.stringify({ username, password, role }) }),
  setPassword: (id: string, password: string) =>
    call<{ ok: true }>(`/auth/users/${id}/password`, { method: "POST", body: JSON.stringify({ password }) }),
  deleteUser: (id: string) => call<{ ok: true }>(`/auth/users/${id}`, { method: "DELETE" }),
};
