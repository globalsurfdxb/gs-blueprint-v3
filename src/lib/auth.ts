import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/session";

export async function verifyCredentials(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) return null;

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return null;

  return user;
}

// Cached per-request: cheap to call from multiple server components/route handlers.
export const getCurrentUser = cache(async () => {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await verifySessionToken(token);
  if (!session) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: {
      roles: { include: { cluster: true, pod: true, restrictedPods: { select: { podId: true } } } },
    },
  });
  if (!user || !user.isActive) return null;

  // Empty restrictedPodIds means full-cluster access — the default for an unrestricted
  // Cluster Head (and meaningless for every other role, which is never pod-restricted).
  return {
    ...user,
    roles: user.roles.map((r) => ({ ...r, restrictedPodIds: r.restrictedPods.map((rp) => rp.podId) })),
  };
});

export type CurrentUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;
