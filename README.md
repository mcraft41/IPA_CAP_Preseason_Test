# Cap Room — PRESEASON TEST backend

This is a **separate, standalone deployment** of the league app, specifically for
preseason testing — a completely different server and URL from the production league,
so nothing here can ever collide with or affect the real season's data.

It's the same code as the production `backend/` folder, just serving the preseason-
branded version of the app (with the "PRESEASON TEST" badge and the Hall of Fame Game
week label built in).

## Deploy this exactly like the production one, as its own separate service

Follow the same GitHub-upload + Render steps used for the production backend, but:
- Use a **different repo name**, e.g. `cap-room-preseason`
- Use a **different Render service**, e.g. `cap-room-preseason` (don't reuse the
  production service — that would just overwrite the real league)
- You'll get a **different URL**, e.g. `https://cap-room-preseason.onrender.com` —
  that's the link to share for preseason testing. The production league keeps its own
  separate URL untouched.

## Everything else

Same endpoints, same file layout, same deployment steps, same free-tier caveats as the
production backend — see that folder's README.md for the full walkthrough. The only
difference is this serves the preseason-branded page and stores its data completely
separately.
