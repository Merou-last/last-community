import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cookieSession from "cookie-session";
import multer from "multer";
import { rateLimit } from "express-rate-limit";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from "discord.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 10000);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "data"));
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const STATE_FILE = path.join(DATA_DIR, "state.json");
const DEFAULT_IMAGE = "/assets/last-community.jpg";
const EPHEMERAL = MessageFlags.Ephemeral;
const app = express();
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildVoiceStates] });

const PRESET_GAMES = [
  { key: "fivem", name: "FiveM / GTA RP", emoji: "🚘" },
  { key: "valorant", name: "Valorant", emoji: "🎯" },
  { key: "fortnite", name: "Fortnite", emoji: "🪂" },
  { key: "minecraft", name: "Minecraft", emoji: "⛏️" },
  { key: "pubg", name: "PUBG", emoji: "🪖" },
  { key: "cs2", name: "Counter-Strike 2", emoji: "💣" },
  { key: "fifa", name: "EA Sports FC", emoji: "⚽" },
  { key: "apex", name: "Apex Legends", emoji: "🛰️" },
];
const PRESET_GANGS = [
  { key: "families", name: "Families", emoji: "🟢" },
  { key: "ballas", name: "Ballas", emoji: "🟣" },
  { key: "bloods", name: "Bloods", emoji: "🔴" },
  { key: "vagos", name: "Los Santos Vagos", emoji: "🟡" },
  { key: "marabunta", name: "Marabunta Grande", emoji: "🔵" },
];
const GAME_CHANNELS = ["general", "clips", "looking-for-group", "announcements"];
const GANG_CHANNELS = ["general", "members", "operations", "drug-trade", "weapons-trade", "territories"];
const COMMUNITY_CATEGORY = "🌟・Community";
const WELCOME_CHANNEL = "👋・welcome";
const GAME_PICKER_CHANNEL = "choose-your-game";
const VOICE_CATEGORY = "🎙️・Voice";
const VOICE_LOBBY = "➕・Create-Room";
const DEFAULT_ROLE_NAME = "Community Member";
const ROOM_PREFIX = "🔊・";
const EMPTY_ROOM_GRACE_MS = 60 * 1000;

const EMPTY_STATE = { guilds: {}, sessions: {} };
let state = structuredClone(EMPTY_STATE);
let stateWrite = Promise.resolve();
const creatingRooms = new Set();
const creatingGangs = new Set();

const allBotPermissions = ["ViewChannel", "ManageChannels", "ManageRoles", "MoveMembers", "Connect", "SendMessages", "EmbedLinks", "ReadMessageHistory", "UseApplicationCommands"]
  .reduce((sum, key) => sum | PermissionFlagsBits[key], 0n).toString();

function makeGuildConfig() {
  return {
    welcomeChannelId: "",
    welcomeMessage: "Welcome {user} to LAST COMMUNITY! 🎮",
    welcomeImageUrl: DEFAULT_IMAGE,
    backgroundUrl: DEFAULT_IMAGE,
    defaultRoleId: "",
    voiceLobbyId: "",
    voiceCategoryId: "",
    generalCategoryId: "",
    gameRoles: {},
    gangs: Object.fromEntries(PRESET_GANGS.map((gang) => [gang.key, { ...gang, roleId: "", categoryId: "" }])),
    rooms: {},
  };
}

function guildConfig(guildId) {
  state.guilds[guildId] ||= makeGuildConfig();
  const config = state.guilds[guildId];
  config.gameRoles ||= {};
  config.gangs ||= {};
  config.rooms ||= {};
  return config;
}

// FIX: a single failed write used to poison the promise chain, so every later save was silently skipped.
function persistState() {
  const snapshot = JSON.stringify(state, null, 2);
  const run = stateWrite.catch(() => {}).then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const temp = `${STATE_FILE}.tmp`;
    await fs.writeFile(temp, snapshot, { encoding: "utf8", mode: 0o600 });
    await fs.rename(temp, STATE_FILE);
  });
  stateWrite = run.catch((error) => console.error("State could not be saved:", error.message));
  return run;
}

function pruneSessions() {
  const now = Date.now();
  let changed = false;
  for (const [sessionId, session] of Object.entries(state.sessions)) {
    if (!session.expiresAt || session.expiresAt < now) { delete state.sessions[sessionId]; changed = true; }
  }
  return changed;
}

async function loadState() {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  try {
    const saved = JSON.parse(await fs.readFile(STATE_FILE, "utf8"));
    state = { ...structuredClone(EMPTY_STATE), ...saved, guilds: saved.guilds || {}, sessions: saved.sessions || {} };
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error("State file could not be read; starting clean and keeping a backup copy.", error.message);
      await fs.rename(STATE_FILE, `${STATE_FILE}.corrupt-${Date.now()}`).catch(() => {});
    }
  }
  pruneSessions();
  await persistState();
}

function getPublicBaseUrl() {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
  try { return new URL(process.env.DISCORD_REDIRECT_URI).origin; } catch { return `http://localhost:${PORT}`; }
}

function fullAssetUrl(value) {
  if (!value) return "";
  if (value.startsWith("/")) return `${getPublicBaseUrl()}${value}`;
  return value;
}

function validHttpsOrLocalAsset(value) {
  if (typeof value !== "string") return false;
  if (value === "" || value === DEFAULT_IMAGE || /^\/uploads\/[\w.-]+$/.test(value)) return true;
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

function hasValidImageSignature(buffer, mimeType) {
  if (!buffer) return false;
  if (mimeType === "image/png") return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === "image/jpeg") return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimeType === "image/gif") return /^GIF8[79]a$/.test(buffer.subarray(0, 6).toString("ascii"));
  if (mimeType === "image/webp") return buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  return false;
}

function hasBit(value, bit) {
  try { return (BigInt(value || "0") & bit) === bit; } catch { return false; }
}

function userIsAdmin(session, guildId) {
  const guild = session?.guilds?.find((entry) => entry.id === guildId);
  return Boolean(guild && (guild.owner || hasBit(guild.permissions, PermissionFlagsBits.Administrator) || hasBit(guild.permissions, PermissionFlagsBits.ManageGuild)));
}

function safeChannelName(value) {
  return String(value || "room").normalize("NFKC").trim().replace(/[\\/#@:*?"<>|]/g, "").replace(/\s+/g, "-").slice(0, 90) || "room";
}

function csrfEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function requireAuth(req, res, next) {
  const session = req.session?.sid ? state.sessions[req.session.sid] : null;
  if (!session || session.expiresAt < Date.now()) {
    if (req.session) req.session = null;
    return res.status(401).json({ error: "Please sign in with Discord first.", loginRequired: true });
  }
  req.authSessionId = req.session.sid;
  req.authSession = session;
  next();
}

function guildAccess({ admin = false, requireBot = true } = {}) {
  return async (req, res, next) => {
    const guildId = req.params.guildId;
    const membership = req.authSession?.guilds?.find((entry) => entry.id === guildId);
    if (!membership) return res.status(403).json({ error: "This server is not part of your Discord account." });
    const guild = client.guilds.cache.get(guildId);
    if (!guild && requireBot) {
      const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(process.env.DISCORD_CLIENT_ID || "")}&permissions=${allBotPermissions}&scope=bot%20applications.commands`;
      return res.status(409).json({ error: "Add the bot to this server first.", inviteUrl });
    }
    let liveMember = null;
    if (guild) liveMember = await guild.members.fetch(req.authSession.id).catch(() => null);
    if (guild && !liveMember) return res.status(403).json({ error: "You are no longer a member of this server." });
    req.guildMember = liveMember;
    req.isGuildAdmin = guild
      ? Boolean(guild.ownerId === req.authSession.id || liveMember?.permissions.has(PermissionFlagsBits.Administrator) || liveMember?.permissions.has(PermissionFlagsBits.ManageGuild))
      : userIsAdmin(req.authSession, guildId);
    if (admin && !req.isGuildAdmin) return res.status(403).json({ error: "This action requires the Manage Server permission in Discord." });
    req.guild = guild || null;
    req.guildSettings = guild ? guildConfig(guildId) : null;
    req.guildMembership = membership;
    next();
  };
}

function requireCsrf(req, res, next) {
  if (!csrfEqual(req.get("x-csrf-token"), req.authSession.csrf)) return res.status(403).json({ error: "Your session expired. Refresh the page and try again." });
  next();
}

// FIX: the limiter used to cover static files and /health too, so Render health checks and normal page loads ate the quota.
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 600, standardHeaders: "draft-8", legacyHeaders: false });
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' https://unpkg.com; style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://discord.com");
  next();
});
app.get("/health", (_req, res) => res.json({ status: "ok", bot: client.isReady() ? "online" : "offline", uptime: Math.floor(process.uptime()) }));
app.use(["/api", "/auth"], apiLimiter);
app.use(express.json({ limit: "128kb" }));
app.use(cookieSession({
  name: "nova_session",
  keys: [process.env.SESSION_SECRET || "development-only-change-this-before-deploying"],
  maxAge: 14 * 24 * 60 * 60 * 1000,
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production" || Boolean(process.env.RENDER),
}));
app.use("/uploads", express.static(UPLOAD_DIR, { maxAge: "7d", immutable: true }));
app.use("/assets", express.static(path.join(__dirname, "public", "assets"), { maxAge: "30d", immutable: true }));
app.use(express.static(path.join(__dirname, "public"), { index: "index.html", maxAge: "1h" }));

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, UPLOAD_DIR),
    filename: (_req, file, callback) => {
      const extensions = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif" };
      callback(null, `${Date.now()}-${crypto.randomBytes(5).toString("hex")}${extensions[file.mimetype] || ".img"}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const allowed = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
    const error = allowed.has(file.mimetype) ? null : Object.assign(new Error("Supported formats: PNG, JPG, WEBP and GIF."), { status: 400 });
    callback(error, allowed.has(file.mimetype));
  },
});

app.get("/auth/login", (req, res) => {
  if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET || !process.env.DISCORD_REDIRECT_URI) {
    return res.redirect("/?error=discord-config");
  }
  const oauthState = crypto.randomBytes(24).toString("hex");
  req.session ||= {};
  req.session.oauthState = oauthState;
  const query = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    redirect_uri: process.env.DISCORD_REDIRECT_URI,
    response_type: "code",
    scope: "identify guilds",
    state: oauthState,
    prompt: "consent",
  });
  res.redirect(`https://discord.com/oauth2/authorize?${query}`);
});

app.get("/auth/callback", async (req, res) => {
  const fail = (message = "login-failed") => res.redirect(`/?error=${encodeURIComponent(message)}`);
  if (req.query.error) return fail("discord-denied");
  if (!req.query.code || !req.query.state || req.query.state !== req.session?.oauthState) return fail("oauth-state");
  try {
    const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code: String(req.query.code),
        redirect_uri: process.env.DISCORD_REDIRECT_URI,
      }),
    });
    if (!tokenResponse.ok) throw new Error(`Discord token exchange returned ${tokenResponse.status}`);
    const token = await tokenResponse.json();
    const [profileResponse, guildsResponse] = await Promise.all([
      fetch("https://discord.com/api/users/@me", { headers: { Authorization: `Bearer ${token.access_token}` } }),
      fetch("https://discord.com/api/users/@me/guilds", { headers: { Authorization: `Bearer ${token.access_token}` } }),
    ]);
    if (!profileResponse.ok || !guildsResponse.ok) throw new Error("Could not load the Discord profile and guild list.");
    const profile = await profileResponse.json();
    const guilds = await guildsResponse.json();
    const sessionId = crypto.randomBytes(32).toString("hex");
    const now = Date.now();
    pruneSessions();
    state.sessions[sessionId] = {
      id: profile.id,
      username: profile.global_name || profile.username,
      handle: profile.username,
      avatar: profile.avatar ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png?size=128` : "",
      guilds: guilds.map((guild) => ({ id: guild.id, name: guild.name, icon: guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=96` : "", permissions: guild.permissions, owner: guild.owner === true })),
      csrf: crypto.randomBytes(24).toString("hex"),
      expiresAt: now + Math.min(Number(token.expires_in || 604800), 604800) * 1000,
    };
    req.session = { sid: sessionId };
    await persistState();
    res.redirect("/");
  } catch (error) {
    console.error("Discord OAuth callback failed:", error.message);
    fail("login-failed");
  }
});

app.post("/auth/logout", requireAuth, requireCsrf, async (req, res) => {
  delete state.sessions[req.authSessionId];
  req.session = null;
  await persistState();
  res.json({ ok: true });
});

app.get("/api/me", requireAuth, (req, res) => {
  const availableGuilds = req.authSession.guilds.filter((guild) => client.guilds.cache.has(guild.id) || userIsAdmin(req.authSession, guild.id));
  const guilds = availableGuilds.map((guild) => ({ ...guild, admin: userIsAdmin(req.authSession, guild.id), botInstalled: client.guilds.cache.has(guild.id) }));
  res.json({ user: { id: req.authSession.id, username: req.authSession.username, handle: req.authSession.handle, avatar: req.authSession.avatar }, guilds, csrf: req.authSession.csrf, clientId: process.env.DISCORD_CLIENT_ID || "", botPermissions: allBotPermissions, botOnline: client.isReady() });
});

app.get("/api/guild/:guildId/snapshot", requireAuth, guildAccess({ admin: false, requireBot: false }), async (req, res) => {
  const guild = req.guild;
  const settings = req.guildSettings;
  if (!guild) return res.json({ installed: false, admin: userIsAdmin(req.authSession, req.params.guildId), settings: null, games: [], gangs: [], rooms: [] });
  await guild.channels.fetch().catch(() => {});
  await guild.roles.fetch().catch(() => {});
  const members = guild.members.cache;
  const visibleChannels = [...guild.channels.cache.values()].filter((channel) => req.isGuildAdmin || channel.permissionsFor(req.guildMember)?.has(PermissionFlagsBits.ViewChannel));
  const allRooms = Object.entries(settings.rooms).flatMap(([channelId, room]) => {
    const channel = guild.channels.cache.get(channelId);
    if (!channel || channel.type !== ChannelType.GuildVoice) return [];
    if (!(room.ownerId === req.authSession.id || req.isGuildAdmin)) return [];
    return [{ id: channel.id, name: channel.name, ownerId: room.ownerId, ownerName: members.get(room.ownerId)?.displayName || "Room owner", userLimit: channel.userLimit, locked: Boolean(room.locked), members: [...channel.members.values()].map((member) => ({ id: member.id, name: member.displayName, avatar: member.user.displayAvatarURL({ size: 64 }) })) }];
  });
  res.json({
    installed: true,
    admin: req.isGuildAdmin,
    guild: { id: guild.id, name: guild.name, icon: guild.iconURL({ size: 128 }), memberCount: guild.memberCount },
    settings: {
      welcomeChannelId: settings.welcomeChannelId,
      welcomeMessage: settings.welcomeMessage,
      welcomeImageUrl: settings.welcomeImageUrl,
      backgroundUrl: settings.backgroundUrl,
      defaultRoleId: settings.defaultRoleId,
      voiceLobbyId: settings.voiceLobbyId,
      voiceCategoryId: settings.voiceCategoryId,
    },
    channels: visibleChannels.map((channel) => ({ id: channel.id, name: channel.name, type: channel.type, parentId: channel.parentId })),
    roles: [...guild.roles.cache.values()].filter((role) => req.isGuildAdmin ? role.id !== guild.id && !role.managed : req.guildMember.roles.cache.has(role.id)).map((role) => ({ id: role.id, name: role.name, color: role.hexColor })),
    games: Object.entries(settings.gameRoles).map(([key, game]) => ({ key, ...game, roleExists: guild.roles.cache.has(game.roleId) })),
    gangs: Object.entries(settings.gangs).map(([key, gang]) => ({ key, ...gang, roleExists: Boolean(gang.roleId && guild.roles.cache.has(gang.roleId)), provisioned: Boolean(gang.categoryId && guild.channels.cache.has(gang.categoryId)) })),
    rooms: allRooms,
    voiceChannels: visibleChannels.filter((channel) => channel.type === ChannelType.GuildVoice).map((channel) => ({ id: channel.id, name: channel.name, parentId: channel.parentId })),
    botOnline: client.isReady(),
  });
});

// FIX: searching only filtered the first 1000 cached members and ignored the "or Discord ID" promise in the UI.
app.get("/api/guild/:guildId/members", requireAuth, guildAccess({ admin: false, requireBot: true }), async (req, res) => {
  const query = String(req.query.q || "").trim().slice(0, 60);
  let found = [];
  try {
    if (/^\d{17,20}$/.test(query)) {
      const member = await req.guild.members.fetch(query).catch(() => null);
      found = member ? [member] : [];
    } else {
      found = [...(await req.guild.members.fetch(query ? { query, limit: 40 } : { limit: 100 })).values()];
    }
  } catch { found = [...req.guild.members.cache.values()]; }
  const members = found
    .filter((member) => !member.user.bot && member.id !== req.authSession.id)
    .slice(0, 40)
    .map((member) => ({ id: member.id, name: member.displayName, handle: member.user.username, avatar: member.user.displayAvatarURL({ size: 64 }), voiceChannelId: member.voice.channelId }));
  res.json({ members });
});

app.put("/api/guild/:guildId/settings", requireAuth, guildAccess({ admin: true }), requireCsrf, async (req, res) => {
  const { welcomeChannelId, welcomeMessage, welcomeImageUrl, backgroundUrl, defaultRoleId, voiceLobbyId } = req.body || {};
  const settings = req.guildSettings;
  const guild = req.guild;
  if (welcomeChannelId !== undefined) {
    const channel = guild.channels.cache.get(String(welcomeChannelId));
    if (welcomeChannelId && (!channel || !channel.isTextBased())) return res.status(400).json({ error: "Choose an existing text channel in this server." });
    settings.welcomeChannelId = String(welcomeChannelId);
  }
  if (welcomeMessage !== undefined) {
    if (typeof welcomeMessage !== "string" || welcomeMessage.length > 1600) return res.status(400).json({ error: "The welcome message cannot be longer than 1600 characters." });
    settings.welcomeMessage = welcomeMessage;
  }
  for (const [field, value] of [["welcomeImageUrl", welcomeImageUrl], ["backgroundUrl", backgroundUrl]]) {
    if (value !== undefined) {
      if (!validHttpsOrLocalAsset(value)) return res.status(400).json({ error: "Use an HTTPS link or an image you uploaded from the dashboard." });
      settings[field] = value;
    }
  }
  if (defaultRoleId !== undefined) {
    const role = guild.roles.cache.get(String(defaultRoleId));
    if (defaultRoleId && (!role || role.id === guild.id || role.managed)) return res.status(400).json({ error: "That default role is not valid." });
    settings.defaultRoleId = String(defaultRoleId);
  }
  if (voiceLobbyId !== undefined) {
    const channel = guild.channels.cache.get(String(voiceLobbyId));
    if (voiceLobbyId && (!channel || channel.type !== ChannelType.GuildVoice)) return res.status(400).json({ error: "Choose an existing voice channel to use as the room creator." });
    settings.voiceLobbyId = String(voiceLobbyId);
    settings.voiceCategoryId = channel?.parentId || settings.voiceCategoryId;
  }
  await persistState();
  res.json({ ok: true, settings: { ...settings } });
});

async function botMemberId(guild) {
  return (guild.members.me || await guild.members.fetchMe()).id;
}

async function createOrReuseRole(guild, name, currentId = "") {
  let role = currentId ? guild.roles.cache.get(currentId) : null;
  role ||= guild.roles.cache.find((entry) => entry.name === name && !entry.managed);
  if (!role) role = await guild.roles.create({ name, reason: "Setting up LAST COMMUNITY roles" });
  return role;
}

// FIX: hiding a category from @everyone also hid it from the bot, so it could no longer create or manage the channels inside.
// The bot now gets its own explicit allow overwrite.
async function createOrReuseCategory(guild, name, roleId) {
  const botId = await botMemberId(guild);
  const botAllow = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory];
  let category = guild.channels.cache.find((entry) => entry.type === ChannelType.GuildCategory && entry.name === name);
  if (!category) {
    category = await guild.channels.create({
      name,
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: botId, allow: botAllow },
        { id: roleId, allow: [PermissionFlagsBits.ViewChannel] },
      ],
      reason: "Creating a category restricted to its role",
    });
  } else {
    await category.permissionOverwrites.edit(botId, { ViewChannel: true, ManageChannels: true, SendMessages: true, EmbedLinks: true, ReadMessageHistory: true });
    await category.permissionOverwrites.edit(guild.id, { ViewChannel: false });
    await category.permissionOverwrites.edit(roleId, { ViewChannel: true });
  }
  return category;
}

async function ensureTextChannels(guild, category, names) {
  const result = [];
  for (const name of names) {
    const safe = safeChannelName(name).toLowerCase();
    let channel = guild.channels.cache.find((entry) => entry.parentId === category.id && entry.name === safe);
    if (!channel) channel = await guild.channels.create({ name: safe, type: ChannelType.GuildText, parent: category.id, reason: "Creating community channels" });
    result.push(channel);
  }
  return result;
}

async function ensureGameSpace(guild, game, settings) {
  const existing = settings.gameRoles[game.key] || {};
  const role = await createOrReuseRole(guild, `🎮 ${game.name}`, existing.roleId);
  const category = await createOrReuseCategory(guild, `${game.emoji || "🎮"} ${game.name}`, role.id);
  const channels = await ensureTextChannels(guild, category, GAME_CHANNELS);
  settings.gameRoles[game.key] = { name: game.name, emoji: game.emoji || "🎮", roleId: role.id, categoryId: category.id, channelIds: channels.map((channel) => channel.id) };
}

async function ensureGangSpace(guild, key, gang, settings) {
  const existing = settings.gangs[key] || gang;
  const role = await createOrReuseRole(guild, `${gang.emoji || "🏴"} ${gang.name}`, existing.roleId);
  const category = await createOrReuseCategory(guild, `🏴 ${gang.name}`, role.id);
  await ensureTextChannels(guild, category, GANG_CHANNELS);
  settings.gangs[key] = { ...gang, roleId: role.id, categoryId: category.id };
  return role;
}

async function ensureWelcomeChannel(guild, settings) {
  let category = settings.generalCategoryId ? guild.channels.cache.get(settings.generalCategoryId) : null;
  category ||= guild.channels.cache.find((entry) => entry.type === ChannelType.GuildCategory && entry.name === COMMUNITY_CATEGORY);
  if (!category) category = await guild.channels.create({ name: COMMUNITY_CATEGORY, type: ChannelType.GuildCategory, reason: "Setting up LAST COMMUNITY" });
  settings.generalCategoryId = category.id;
  let welcome = settings.welcomeChannelId ? guild.channels.cache.get(settings.welcomeChannelId) : null;
  // FIX: the lookup name used to differ from the created name, which could create a duplicate welcome channel.
  welcome ||= guild.channels.cache.find((entry) => entry.parentId === category.id && entry.name === WELCOME_CHANNEL);
  if (!welcome) welcome = await guild.channels.create({ name: WELCOME_CHANNEL, type: ChannelType.GuildText, parent: category.id, reason: "Welcome channel" });
  settings.welcomeChannelId = welcome.id;
  await ensureTextChannels(guild, category, [GAME_PICKER_CHANNEL, "chat"]);
  let role = settings.defaultRoleId ? guild.roles.cache.get(settings.defaultRoleId) : null;
  if (!role) role = await createOrReuseRole(guild, DEFAULT_ROLE_NAME);
  settings.defaultRoleId = role.id;
  return { category, welcome, role };
}

async function ensureVoiceHub(guild, settings) {
  let category = settings.voiceCategoryId ? guild.channels.cache.get(settings.voiceCategoryId) : null;
  category ||= guild.channels.cache.find((entry) => entry.type === ChannelType.GuildCategory && entry.name === VOICE_CATEGORY);
  if (!category) category = await guild.channels.create({ name: VOICE_CATEGORY, type: ChannelType.GuildCategory, reason: "Creating the voice rooms category" });
  settings.voiceCategoryId = category.id;
  let lobby = settings.voiceLobbyId ? guild.channels.cache.get(settings.voiceLobbyId) : null;
  if (!lobby) lobby = guild.channels.cache.find((entry) => entry.parentId === category.id && entry.name === VOICE_LOBBY);
  if (!lobby) lobby = await guild.channels.create({ name: VOICE_LOBBY, type: ChannelType.GuildVoice, parent: category.id, reason: "Joining this channel creates a private temporary room" });
  settings.voiceLobbyId = lobby.id;
}

async function postGameRolePanel(guild, settings) {
  const channel = guild.channels.cache.find((entry) => entry.parentId === settings.generalCategoryId && entry.name === GAME_PICKER_CHANNEL);
  const games = Object.entries(settings.gameRoles).filter(([, game]) => guild.roles.cache.has(game.roleId));
  if (!channel || !games.length) return;
  if (settings.rolePanelMessageId) await channel.messages.delete(settings.rolePanelMessageId).catch(() => {});
  const menu = new StringSelectMenuBuilder()
    .setCustomId("game-roles")
    .setPlaceholder("Pick the game whose channels you want to see")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(games.slice(0, 25).map(([key, game]) => new StringSelectMenuOptionBuilder().setLabel(game.name.slice(0, 100)).setValue(key).setEmoji(game.emoji || "🎮")));
  const message = await channel.send({
    embeds: [new EmbedBuilder().setColor(0x57d8f4).setTitle("Choose your game 🎮").setDescription("Your choice gives you the game's role and shows its private category. You can change it any time.").setFooter({ text: "LAST COMMUNITY · Our games, our community" })],
    components: [new ActionRowBuilder().addComponents(menu)],
  });
  settings.rolePanelMessageId = message.id;
}

async function setupGuild(guild) {
  await guild.channels.fetch().catch(() => {});
  await guild.roles.fetch().catch(() => {});
  const settings = guildConfig(guild.id);
  const { welcome } = await ensureWelcomeChannel(guild, settings);
  for (const game of PRESET_GAMES) await ensureGameSpace(guild, game, settings);
  await ensureVoiceHub(guild, settings);
  await postGameRolePanel(guild, settings);
  await persistState();
  return { welcome, settings };
}

// Rooms start private (invite only). "Locked" = invite only, "Open" = everyone in the server can join.
async function createRoom(guild, member, parentId = "") {
  const settings = guildConfig(guild.id);
  const botId = await botMemberId(guild);
  const baseName = safeChannelName(member.displayName || member.user.username).slice(0, 75);
  const channel = await guild.channels.create({
    name: `${ROOM_PREFIX}${baseName}`.slice(0, 100),
    type: ChannelType.GuildVoice,
    parent: parentId || settings.voiceCategoryId || null,
    permissionOverwrites: [
      { id: guild.id, deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect] },
      { id: botId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers] },
      { id: member.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak, PermissionFlagsBits.Stream, PermissionFlagsBits.UseVAD, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers] },
    ],
    reason: `Temporary voice room for ${member.user.username}`,
  });
  settings.rooms[channel.id] = { ownerId: member.id, createdAt: Date.now(), locked: true, invitedMemberIds: [] };
  await persistState();
  return channel;
}

async function provisionGangForMember(guild, member, gangKey) {
  const settings = guildConfig(guild.id);
  const gang = settings.gangs[gangKey] || PRESET_GANGS.find((entry) => entry.key === gangKey);
  if (!gang) throw new Error("That gang does not exist.");
  const lockKey = `${guild.id}:${gangKey}`;
  if (creatingGangs.has(lockKey)) throw new Error("This gang is being set up right now. Try again in a moment.");
  creatingGangs.add(lockKey);
  try {
    await guild.channels.fetch().catch(() => {});
    await guild.roles.fetch().catch(() => {});
    const role = await ensureGangSpace(guild, gangKey, gang, settings);
    await member.roles.add(role, `Picked ${gang.name} from the RP gang menu`);
    await persistState();
    return { gang, role };
  } finally {
    creatingGangs.delete(lockKey);
  }
}

function buildCommands() {
  const guildOnly = InteractionContextType.Guild;
  return [
    new SlashCommandBuilder().setName("setup").setDescription("Set up community categories, roles and the welcome channel").setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).setContexts(guildOnly),
    new SlashCommandBuilder().setName("roles").setDescription("Pick the game whose channels you want to see").setContexts(guildOnly),
    new SlashCommandBuilder().setName("gang").setDescription("Pick your RP gang and unlock its private category").setContexts(guildOnly),
    new SlashCommandBuilder().setName("voice-panel").setDescription("Post a button that creates temporary voice rooms").setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).setContexts(guildOnly),
  ].map((command) => command.toJSON());
}

async function registerCommands() {
  if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_TOKEN) return;
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  const commands = buildCommands();
  if (process.env.DEV_GUILD_ID) await rest.put(Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DEV_GUILD_ID), { body: commands });
  else await rest.put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID), { body: commands });
  console.log(`Registered ${commands.length} Discord slash commands.`);
}

async function handleInteraction(interaction) {
  try {
    if (interaction.isChatInputCommand()) {
      if (!interaction.guild) return interaction.reply({ content: "This command only works inside a server.", flags: EPHEMERAL });
      if (interaction.commandName === "setup") {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: "You need the Manage Server permission to use this command.", flags: EPHEMERAL });
        await interaction.deferReply({ flags: EPHEMERAL });
        const { settings } = await setupGuild(interaction.guild);
        return interaction.editReply(`Setup complete. ${Object.keys(settings.gameRoles).length} game categories, ${Object.keys(settings.gangs).length} gang templates and the room creator channel are ready.`);
      }
      if (interaction.commandName === "roles") {
        const settings = guildConfig(interaction.guildId);
        const games = Object.entries(settings.gameRoles).filter(([, game]) => interaction.guild.roles.cache.has(game.roleId));
        if (!games.length) return interaction.reply({ content: "Game categories are not set up yet. Ask a server admin to run `/setup`.", flags: EPHEMERAL });
        const menu = new StringSelectMenuBuilder().setCustomId("game-roles").setPlaceholder("Pick one game").setMinValues(1).setMaxValues(1)
          .addOptions(games.slice(0, 25).map(([key, game]) => new StringSelectMenuOptionBuilder().setLabel(game.name.slice(0, 100)).setValue(key).setEmoji(game.emoji || "🎮")));
        return interaction.reply({ content: "Your pick unlocks your game's channels and hides the other game categories:", components: [new ActionRowBuilder().addComponents(menu)], flags: EPHEMERAL });
      }
      if (interaction.commandName === "gang") {
        const gangs = Object.entries(guildConfig(interaction.guildId).gangs);
        if (!gangs.length) return interaction.reply({ content: "No gangs have been added yet. Ask a server admin to add some from the dashboard.", flags: EPHEMERAL });
        const menu = new StringSelectMenuBuilder().setCustomId("gang-select").setPlaceholder("Pick your RP gang").setMinValues(1).setMaxValues(1)
          .addOptions(gangs.slice(0, 25).map(([key, gang]) => new StringSelectMenuOptionBuilder().setLabel(gang.name.slice(0, 100)).setValue(key).setEmoji(gang.emoji || "🏴")));
        return interaction.reply({ content: "Pick your gang. Its role and private category are created on the first pick, then the role is given to you:", components: [new ActionRowBuilder().addComponents(menu)], flags: EPHEMERAL });
      }
      if (interaction.commandName === "voice-panel") {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: "You need the Manage Server permission to post the voice panel.", flags: EPHEMERAL });
        const panel = new EmbedBuilder().setColor(0x57d8f4).setTitle("Your own voice room 🎙️").setDescription("Press the button to create a private temporary room. Invite friends or change its settings from the LAST COMMUNITY dashboard.").setFooter({ text: "Rooms are deleted automatically when they are empty" });
        const button = new ButtonBuilder().setCustomId("voice-create").setLabel("Create my room").setStyle(ButtonStyle.Primary).setEmoji("🎙️");
        return interaction.reply({ embeds: [panel], components: [new ActionRowBuilder().addComponents(button)] });
      }
    }
    if (interaction.isStringSelectMenu() && interaction.customId === "game-roles") {
      const settings = guildConfig(interaction.guildId);
      const game = settings.gameRoles[interaction.values[0]];
      if (!game || !interaction.guild.roles.cache.has(game.roleId)) return interaction.reply({ content: "That role is no longer available. Ask an admin to re-run the setup.", flags: EPHEMERAL });
      await interaction.deferReply({ flags: EPHEMERAL });
      const member = interaction.member;
      const otherRoleIds = Object.entries(settings.gameRoles).filter(([key, value]) => key !== interaction.values[0] && member.roles.cache.has(value.roleId)).map(([, value]) => value.roleId);
      if (otherRoleIds.length) await member.roles.remove(otherRoleIds, "Changed game choice");
      if (!member.roles.cache.has(game.roleId)) await member.roles.add(game.roleId, "Picked a game role from the menu");
      return interaction.editReply(`You picked **${game.name}**. Its channels are now available to you.`);
    }
    if (interaction.isStringSelectMenu() && interaction.customId === "gang-select") {
      await interaction.deferReply({ flags: EPHEMERAL });
      const { gang } = await provisionGangForMember(interaction.guild, interaction.member, interaction.values[0]);
      return interaction.editReply(`Welcome to **${gang.name}**. You now have the gang role and can see its channels.`);
    }
    if (interaction.isButton() && interaction.customId === "voice-create") {
      await interaction.deferReply({ flags: EPHEMERAL });
      const key = `${interaction.guildId}:${interaction.user.id}`;
      if (creatingRooms.has(key)) return interaction.editReply("Your room is being created. Give it a moment.");
      creatingRooms.add(key);
      try {
        const wasInVoice = Boolean(interaction.member.voice.channelId);
        const room = await createRoom(interaction.guild, interaction.member);
        let moved = false;
        if (wasInVoice) moved = await interaction.member.voice.setChannel(room, "Moving the owner into their new room").then(() => true).catch(() => false);
        return interaction.editReply(moved
          ? `Created ${room} and moved you in. Open the dashboard to manage invites, the lock and the member limit.`
          : `Created ${room}. Join it from the voice category, then open the dashboard to manage invites, the lock and the member limit. It is deleted if nobody joins within a minute.`);
      } finally { creatingRooms.delete(key); }
    }
  } catch (error) {
    console.error("Interaction failed:", error);
    const message = error.code === 50013 ? "The bot is missing permissions. Make sure it has Manage Channels, Manage Roles and Move Members, and move the bot's role above the community roles." : (error.message?.startsWith("This gang is being") ? error.message : "Something went wrong while handling that request. Check the bot's permissions and try again.");
    if (interaction.deferred || interaction.replied) await interaction.followUp({ content: message, flags: EPHEMERAL }).catch(() => {});
    else await interaction.reply({ content: message, flags: EPHEMERAL }).catch(() => {});
  }
}

client.on(Events.InteractionCreate, handleInteraction);
client.on(Events.Error, (error) => console.error("Discord client error:", error.message));

client.on(Events.GuildMemberAdd, async (member) => {
  const settings = guildConfig(member.guild.id);
  if (settings.defaultRoleId) await member.roles.add(settings.defaultRoleId, "Default member role").catch((error) => console.warn("Default role could not be assigned:", error.message));
  const channel = settings.welcomeChannelId ? member.guild.channels.cache.get(settings.welcomeChannelId) : null;
  if (!channel?.isTextBased()) return;
  const message = String(settings.welcomeMessage || "Welcome {user} to LAST COMMUNITY!")
    .replaceAll("{user}", `<@${member.id}>`).replaceAll("{server}", member.guild.name);
  const embed = new EmbedBuilder().setColor(0x57d8f4).setTitle("Welcome to the community! ✨").setDescription(message).setThumbnail(member.user.displayAvatarURL({ size: 256 })).setFooter({ text: "LAST COMMUNITY" });
  const image = fullAssetUrl(settings.welcomeImageUrl);
  if (image) embed.setImage(image);
  await channel.send({ content: `<@${member.id}>`, embeds: [embed], allowedMentions: { users: [member.id] } }).catch((error) => console.warn("Welcome message could not be sent:", error.message));
});

client.on(Events.VoiceStateUpdate, async (before, after) => {
  const guild = after.guild || before.guild;
  const settings = guildConfig(guild.id);
  if (after.channelId && after.channelId === settings.voiceLobbyId && before.channelId !== after.channelId && after.member) {
    const key = `${guild.id}:${after.id}`;
    if (!creatingRooms.has(key)) {
      creatingRooms.add(key);
      try {
        const room = await createRoom(guild, after.member, settings.voiceCategoryId);
        await after.member.voice.setChannel(room, "Creating a room after joining the room creator");
      } catch (error) { console.warn("Could not create a temporary voice room:", error.message); }
      finally { creatingRooms.delete(key); }
    }
  }
  if (before.channelId && before.channelId !== after.channelId && settings.rooms[before.channelId]) {
    const previous = before.guild.channels.cache.get(before.channelId);
    if (previous?.type === ChannelType.GuildVoice && previous.members.size === 0) {
      delete settings.rooms[before.channelId];
      await previous.delete("Deleting the temporary voice room after everyone left").catch(() => {});
      await persistState();
    }
  }
});

// FIX: rooms created from the /voice-panel button were never deleted if the owner did not join them.
async function sweepEmptyRooms() {
  let changed = false;
  for (const guild of client.guilds.cache.values()) {
    const settings = guildConfig(guild.id);
    for (const [channelId, room] of Object.entries(settings.rooms)) {
      const channel = guild.channels.cache.get(channelId);
      if (!channel) { delete settings.rooms[channelId]; changed = true; continue; }
      if (channel.type === ChannelType.GuildVoice && channel.members.size === 0 && Date.now() - (room.createdAt || 0) > EMPTY_ROOM_GRACE_MS) {
        delete settings.rooms[channelId];
        await channel.delete("Deleting an empty temporary voice room").catch(() => {});
        changed = true;
      }
    }
  }
  if (pruneSessions()) changed = true;
  if (changed) await persistState();
}

client.once(Events.ClientReady, async () => {
  console.log(`Discord bot ready as ${client.user.tag}`);
  await registerCommands().catch((error) => console.error("Slash commands could not be registered:", error.message));
  await sweepEmptyRooms().catch((error) => console.warn("Room cleanup failed:", error.message));
  setInterval(() => sweepEmptyRooms().catch((error) => console.warn("Room cleanup failed:", error.message)), 60 * 1000).unref();
});

function canControlRoom(req, room) {
  return Boolean(room && (room.ownerId === req.authSession.id || req.isGuildAdmin));
}

app.patch("/api/guild/:guildId/voice/:channelId", requireAuth, guildAccess({ admin: false }), requireCsrf, async (req, res) => {
  const { guild, guildSettings: settings } = req;
  const room = settings.rooms[req.params.channelId];
  if (!canControlRoom(req, room)) return res.status(403).json({ error: "You can only manage your own room." });
  const channel = guild.channels.cache.get(req.params.channelId);
  if (!channel || channel.type !== ChannelType.GuildVoice) return res.status(404).json({ error: "That room no longer exists." });
  const { name, userLimit, locked } = req.body || {};
  // Validate everything first so a bad value cannot leave the room half-updated.
  const limit = userLimit === undefined ? undefined : Number(userLimit);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 0 || limit > 99)) return res.status(400).json({ error: "The member limit must be between 0 and 99 (0 means no limit)." });
  if (locked !== undefined && typeof locked !== "boolean") return res.status(400).json({ error: "Invalid lock state." });
  try {
    if (name !== undefined) await channel.setName(`${ROOM_PREFIX}${safeChannelName(name)}`.slice(0, 100), "Room renamed from the dashboard");
    if (limit !== undefined) await channel.setUserLimit(limit, "Room capacity changed from the dashboard");
    if (locked !== undefined) {
      // Invited members keep their own allow overwrite; only @everyone changes.
      await channel.permissionOverwrites.edit(guild.id, locked ? { ViewChannel: false, Connect: false } : { ViewChannel: true, Connect: true }, locked ? "Room locked: invite only" : "Room opened to everyone");
      room.locked = locked;
    }
    await persistState();
    res.json({ ok: true, room: { id: channel.id, name: channel.name, userLimit: channel.userLimit, locked: Boolean(room.locked) } });
  } catch (error) {
    console.error("Voice room update failed:", error.message);
    res.status(400).json({ error: error.code === 50013 ? "The bot does not have enough permissions to manage this room." : "Could not update the room." });
  }
});

app.post("/api/guild/:guildId/voice/:channelId/members/:memberId", requireAuth, guildAccess({ admin: false }), requireCsrf, async (req, res) => {
  const { guild, guildSettings: settings } = req;
  const room = settings.rooms[req.params.channelId];
  if (!canControlRoom(req, room)) return res.status(403).json({ error: "You can only manage your own room." });
  const channel = guild.channels.cache.get(req.params.channelId);
  if (!channel || channel.type !== ChannelType.GuildVoice) return res.status(404).json({ error: "That room no longer exists." });
  const target = await guild.members.fetch(req.params.memberId).catch(() => null);
  if (!target || target.user.bot) return res.status(404).json({ error: "Member not found." });
  if (target.id === room.ownerId) return res.status(400).json({ error: "The room owner cannot be removed." });
  try {
    if (req.body?.action === "invite") {
      room.invitedMemberIds ||= [];
      if (!room.invitedMemberIds.includes(target.id)) room.invitedMemberIds.push(target.id);
      // FIX: invites used to depend on the lock state, so locking the room removed access for invited friends.
      await channel.permissionOverwrites.edit(target.id, { ViewChannel: true, Connect: true }, "Member invited from the room dashboard");
      await persistState();
      if (target.voice.channelId && target.voice.channelId !== channel.id && guild.members.me?.permissions.has(PermissionFlagsBits.MoveMembers)) {
        await target.voice.setChannel(channel, "Moved to the room after being invited by the owner").catch(() => {});
      }
      return res.json({ ok: true, message: `${target.displayName} was invited.` });
    }
    if (req.body?.action === "remove") {
      room.invitedMemberIds = (room.invitedMemberIds || []).filter((memberId) => memberId !== target.id);
      await channel.permissionOverwrites.edit(target.id, { ViewChannel: false, Connect: false }, "Member removed from the room");
      if (target.voice.channelId === channel.id && guild.members.me?.permissions.has(PermissionFlagsBits.MoveMembers)) await target.voice.disconnect("Removed by the room owner from the dashboard");
      await persistState();
      return res.json({ ok: true, message: `${target.displayName} was removed.` });
    }
    res.status(400).json({ error: "Unknown action." });
  } catch (error) {
    console.error("Voice room member action failed:", error.message);
    res.status(400).json({ error: error.code === 50013 ? "The bot does not have enough permissions to invite or remove members." : "Could not apply that action to the member." });
  }
});

app.post("/api/guild/:guildId/setup", requireAuth, guildAccess({ admin: true }), requireCsrf, async (req, res) => {
  try {
    const { settings } = await setupGuild(req.guild);
    res.json({ ok: true, games: Object.keys(settings.gameRoles).length, gangs: Object.keys(settings.gangs).length, message: "Game categories, roles, welcome and voice are set up." });
  } catch (error) {
    console.error("Guild setup failed:", error);
    res.status(400).json({ error: error.code === 50013 ? "The bot needs Manage Channels and Manage Roles. Move the bot's role above the new roles." : "Setup could not finish. Check the bot's permissions." });
  }
});

app.post("/api/guild/:guildId/games", requireAuth, guildAccess({ admin: true }), requireCsrf, async (req, res) => {
  const name = String(req.body?.name || "").trim().slice(0, 70);
  const emoji = String(req.body?.emoji || "🎮").slice(0, 12);
  if (!name) return res.status(400).json({ error: "Enter a game name." });
  if (Object.keys(req.guildSettings.gameRoles).length >= 25) return res.status(400).json({ error: "You have reached the limit of 25 games." });
  const key = `custom-${crypto.randomUUID().slice(0, 8)}`;
  try {
    await req.guild.channels.fetch().catch(() => {});
    await req.guild.roles.fetch().catch(() => {});
    await ensureGameSpace(req.guild, { key, name, emoji }, req.guildSettings);
    await postGameRolePanel(req.guild, req.guildSettings);
    await persistState();
    res.json({ ok: true, message: `Added the ${name} category and role.` });
  } catch (error) {
    console.error("Custom game setup failed:", error.message);
    res.status(400).json({ error: "Could not create the game category. Check the bot's permissions." });
  }
});

app.post("/api/guild/:guildId/gangs", requireAuth, guildAccess({ admin: true }), requireCsrf, async (req, res) => {
  const name = String(req.body?.name || "").trim().slice(0, 70);
  const emoji = String(req.body?.emoji || "🏴").slice(0, 12);
  if (!name) return res.status(400).json({ error: "Enter a gang name." });
  if (Object.keys(req.guildSettings.gangs).length >= 25) return res.status(400).json({ error: "You have reached the limit of 25 gangs." });
  const key = `custom-${crypto.randomUUID().slice(0, 8)}`;
  try {
    await req.guild.channels.fetch().catch(() => {});
    await req.guild.roles.fetch().catch(() => {});
    await ensureGangSpace(req.guild, key, { name, emoji, roleId: "", categoryId: "" }, req.guildSettings);
    await persistState();
    res.json({ ok: true, message: `Created the private ${name} category and role.` });
  } catch (error) {
    console.error("Custom gang setup failed:", error.message);
    res.status(400).json({ error: "Could not create the gang category. Check the bot's permissions." });
  }
});

app.post("/api/guild/:guildId/assets", requireAuth, guildAccess({ admin: true }), requireCsrf, upload.single("asset"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choose an image file first." });
  const imageBytes = await fs.readFile(req.file.path);
  if (!hasValidImageSignature(imageBytes, req.file.mimetype)) {
    await fs.unlink(req.file.path).catch(() => {});
    return res.status(400).json({ error: "The file contents do not match the selected image type." });
  }
  const url = `/uploads/${req.file.filename}`;
  res.json({ ok: true, url, name: req.file.originalname });
});

app.use((error, _req, res, _next) => {
  console.error("Request failed:", error.message);
  let status = error.status || error.statusCode || (error instanceof multer.MulterError ? 400 : 500);
  if (status < 400 || status > 599) status = 500;
  let message = status >= 500 ? "Internal error. Please try again." : error.message;
  if (error.code === "LIMIT_FILE_SIZE") message = "That image is too large (10 MB maximum).";
  if (status === 404) message = "Not found.";
  res.status(status).json({ error: message });
});

process.on("unhandledRejection", (reason) => console.error("Unhandled rejection:", reason));

await loadState();
if (process.env.DISCORD_TOKEN) {
  client.login(process.env.DISCORD_TOKEN).catch((error) => console.error("Discord login failed:", error.message));
} else {
  console.warn("DISCORD_TOKEN is missing. The dashboard web server will run, but bot features are offline.");
}
app.listen(PORT, "0.0.0.0", () => console.log(`LAST COMMUNITY dashboard listening on ${PORT}`));
