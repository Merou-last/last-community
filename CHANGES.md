# Changes in v1.1.0

The whole project (bot messages, slash commands, dashboard, README) is now in English with a left-to-right layout.

## Bugs fixed

1. **Bot lost access to its own private categories.** Hiding a game/gang category from @everyone also hid it from the bot, which could then fail to create channels or manage them ("Missing Access"). The bot now gets its own allow overwrite on categories and on voice rooms.
2. **Lock button broke invitations.** Locking a room removed access for invited friends, and "open" never actually opened the room because @everyone stayed denied. Rooms are now *Invite only* by default; *Open* lets everyone in the server join; invited friends always keep access.
3. **Empty rooms were never deleted** when created from the `/voice-panel` button and the owner did not join. A cleanup sweep now deletes empty rooms after one minute.
4. **One failed disk write disabled all later saves.** The save queue is now self-healing, and a corrupted `state.json` is backed up instead of overwritten.
5. **Rate limiter blocked normal use.** It counted static files and Render's `/health` checks against a 180-request quota. It now covers only `/api` and `/auth` (600 per 15 minutes).
6. **Dashboard greeting showed a literal `${userName}`**, and server/user names were HTML-escaped twice.
7. **Welcome channel could be duplicated** by `/setup` because the lookup name differed from the created name.
8. **Duplicate roles/channels** could appear when `/setup` ran against a stale cache; channels and roles are now fetched first.
9. **Room settings could be half-applied**: the name was changed before the member limit was validated. Everything is validated first. The response also reported the wrong lock state.
10. **Member search** only looked at the first 1000 cached members and ignored Discord IDs. It now queries Discord directly and accepts an ID. The `prompt()` dialog was replaced with an inline search box.
11. **`/voice-panel` could be posted by anyone**; it now requires Manage Server. All commands are guild-only.
12. **Deprecated discord.js usage** (`ephemeral`, `ready` event) replaced with `MessageFlags.Ephemeral` and `Events.ClientReady`.
13. **Error handler** turned 404s into 500s and leaked internal error text; it now returns correct status codes and friendly messages (including "image too large").
14. **Security tightening**: removed `'unsafe-inline'` from `script-src`, restricted `/uploads/` URLs to safe file names, expired sessions are pruned regularly.
15. **Node version**: `engines` required Node 24 exactly and `render.yaml` pinned a version that may not exist. Now Node 20+ (Render uses 22). Added the missing `PUBLIC_BASE_URL` to `render.yaml`.

## Notes

- If you already ran `/setup` with the Arabic version, the old Arabic-named channels stay in place and the English version will create new ones next to them. Delete the old ones or rename them to match (for example `general`, `clips`, `looking-for-group`, `announcements`).
- Existing saved welcome messages stay as they were; edit them in the dashboard.
