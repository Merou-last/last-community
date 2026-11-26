# LAST COMMUNITY

A Discord bot plus web dashboard for a friends' gaming community. The bot and the dashboard run in a single Node service (built for Render) that stores server settings, sessions and uploaded images on a persistent disk.

## Features

- Roles and private categories for FiveM / GTA RP, Valorant, Fortnite, Minecraft, PUBG, Counter-Strike 2, EA Sports FC and Apex Legends. More games can be added from the dashboard.
- A Discord select menu lets each player pick one game. They receive that game's role and see its channels.
- Gang sections for Families, Ballas, Bloods, Los Santos Vagos and Marabunta Grande. Using `/gang` creates the role and a private category (general, members, operations, drug-trade, weapons-trade, territories) on first use, then gives the player the role.
- Joining the room creator voice channel creates a private temporary room for its owner. The owner can rename it, set a member limit, lock or open it, and invite or remove friends from the dashboard. Empty rooms are deleted automatically.
- An automatic welcome message with an image or GIF, and a default role for new members.
- A changeable dashboard background and uploads of JPG, PNG, WEBP and GIF images up to 10 MB.
- Discord OAuth sign-in. Anyone with Manage Server or Administrator can configure the server; room owners can manage their own room.

## Requirements

- Node.js 20 or newer.
- A Discord application with a Bot and OAuth2.
- A Render account. `render.yaml` defines a Starter web service and a 1 GB persistent disk so settings and uploads survive restarts.

## Discord setup

1. Create an application in the [Discord Developer Portal](https://discord.com/developers/applications) and add a Bot on the **Bot** tab.
2. Enable **Server Members Intent**. The bot needs it to assign the default role and send the welcome message.
3. Copy the **Bot Token**, **Application ID** and **Client Secret** into environment variables. Never commit the token or put it in front-end files.
4. Add this URL under **OAuth2 → General → Redirects**: `https://YOUR-SERVICE.onrender.com/auth/callback`.
5. Invite the bot with the link shown in the dashboard. It requests permission to view and manage channels, create roles and move voice members. **Place the bot's role above the game and gang roles.**

For local development copy `.env.example` to `.env` and fill in:

```env
DISCORD_TOKEN=...
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
DISCORD_REDIRECT_URI=http://localhost:10000/auth/callback
SESSION_SECRET=use-a-long-random-private-value
DATA_DIR=./data
PORT=10000
```

Add `http://localhost:10000/auth/callback` to the Discord OAuth2 redirects, then run `npm install` and `npm start`.

## Deploying to GitHub and Render

1. Unzip the project, create an empty GitHub repository and push the **contents of the folder** so `render.yaml` and `package.json` sit at the repository root. `.env`, `data/` and `node_modules/` are ignored by `.gitignore`.
2. In Render choose **New → Blueprint** and connect the repository. Render reads `render.yaml` and creates the web service and the persistent disk.
3. Add `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI` and `PUBLIC_BASE_URL` to the service's environment variables. Create the service first to learn its `onrender.com` address, then register the same `/auth/callback` URL in Discord.
4. Set `PUBLIC_BASE_URL` to `https://YOUR-SERVICE.onrender.com` (it is also used to build the absolute welcome image URL).
5. When the deploy finishes, open the service URL and sign in. Add the bot to your server if the dashboard asks, then press **Set up community** or run `/setup` once.

A persistent disk requires a paid Render service. Without it, sessions, uploaded images and local settings can disappear on redeploy or restart.

## Discord commands

| Command | Purpose |
| --- | --- |
| `/setup` | Admins only. Creates the welcome, game and voice categories, channels and roles. |
| `/roles` | Private menu to pick your game and reveal its section. |
| `/gang` | Pick Families, Ballas, Bloods or a gang an admin added. |
| `/voice-panel` | Admins only. Posts a public button that creates a temporary voice room. |

You can also choose the room creator channel in the dashboard. Joining it creates a room and moves you into it; the room is deleted when everyone leaves (or after a minute if nobody ever joins).

### Voice room states

- **Invite only** (default): only the owner, invited friends and admins can see and join.
- **Open**: everyone in the server can see and join the room.

Invited friends keep their access whether the room is locked or open.

## Supported image formats

Upload a welcome or background image from the dashboard, or paste a direct HTTPS link. Discord receives the welcome image through an embed, and Discord clients may animate GIFs depending on their embed support.

## Changes in this version

See `CHANGES.md` for the list of bug fixes.
