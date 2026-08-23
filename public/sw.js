/*
 * DocMaker Calendar service worker.
 *
 * Receives pushes and shows them, which is what makes a notification arrive
 * when the calendar is closed — a page can only be told things while it is
 * open.
 *
 * Notifications here stay on screen until they are answered: each one is a
 * decision (see it, or confirm you have seen it), and several stack rather
 * than replacing one another, because each concerns a different event.
 */

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "DocMaker Calendar", body: event.data ? event.data.text() : "" };
  }

  const options = {
    body: payload.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    // A unique tag per notification, so two shares stack instead of the second
    // quietly replacing the first.
    tag: payload.tag || `cc-${Date.now()}`,
    renotify: false,
    requireInteraction: true,
    timestamp: Date.now(),
    data: {
      url: payload.url || "/calendar",
      notificationId: payload.tag || null,
    },
    actions: [
      { action: "open", title: "See the event" },
      { action: "seen", title: "Confirmed seen" },
    ],
  };

  event.waitUntil(self.registration.showNotification(payload.title || "DocMaker Calendar", options));
});

self.addEventListener("notificationclick", (event) => {
  const data = event.notification.data || {};
  event.notification.close();

  // Either way the notification has been dealt with, so it stops being unread.
  const markRead = data.notificationId
    ? fetch("/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [data.notificationId] }),
        credentials: "include",
      }).catch(() => {})
    : Promise.resolve();

  if (event.action === "seen") {
    event.waitUntil(markRead);
    return;
  }

  const target = data.url || "/calendar";

  event.waitUntil(
    Promise.all([
      markRead,
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
        // Reuse a tab that is already open rather than piling up windows.
        for (const client of clients) {
          if (client.url.includes("/calendar") && "focus" in client) {
            client.navigate(target);
            return client.focus();
          }
        }
        return self.clients.openWindow(target);
      }),
    ]),
  );
});

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
