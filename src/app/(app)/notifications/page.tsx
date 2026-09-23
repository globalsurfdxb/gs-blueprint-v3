import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { markNotificationRead, markAllNotificationsRead } from "@/lib/actions/notifications";
import { formatDateTime } from "@/lib/format";

export default async function NotificationsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const notifications = await prisma.notification.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const hasUnread = notifications.some((n) => !n.isRead);

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Notifications</h1>
        {hasUnread && (
          <form action={markAllNotificationsRead}>
            <button type="submit" className="flex min-h-11 items-center text-sm text-gs-red hover:underline">
              Mark all as read
            </button>
          </form>
        )}
      </div>

      <div className="mt-6 flex flex-col gap-2">
        {notifications.length === 0 && <p className="text-sm text-gs-gray">No notifications yet.</p>}
        {notifications.map((n) => {
          const markReadWithId = markNotificationRead.bind(null, n.id);
          const content = (
            <>
              <p className={n.isRead ? "text-gs-black" : "font-medium text-gs-black"}>{n.message}</p>
              <p className="mt-1 text-xs text-gs-gray">{formatDateTime(n.createdAt)}</p>
            </>
          );

          return (
            <div
              key={n.id}
              className={`flex items-center justify-between rounded-md border p-4 text-sm ${
                n.isRead ? "border-gs-gray/15 bg-white" : "border-gs-red/30 bg-gs-red/5"
              }`}
            >
              <div className="flex-1">
                {n.relatedProjectId && n.relatedTaskId ? (
                  <Link
                    href={`/projects/${n.relatedProjectId}/tasks/${n.relatedTaskId}`}
                    className="hover:underline"
                  >
                    {content}
                  </Link>
                ) : (
                  content
                )}
              </div>
              {!n.isRead && (
                <form action={markReadWithId}>
                  <button
                    type="submit"
                    className="ml-3 flex min-h-11 shrink-0 items-center text-xs text-gs-gray hover:text-gs-black"
                  >
                    Mark read
                  </button>
                </form>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
