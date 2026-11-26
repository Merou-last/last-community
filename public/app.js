const pageNames = {
  overview: "Overview",
  games: "Games & Roles",
  gangs: "RP Gangs",
  voice: "Voice Rooms",
  welcome: "Welcome & Members",
  appearance: "Appearance",
};
const DEFAULT_IMAGE = "/assets/last-community.jpg";
const GANG_CHANNEL_NAMES = ["general", "members", "operations", "drug-trade", "weapons-trade", "territories"];
const state = { me: null, guildId: localStorage.getItem("lc-guild") || "", snapshot: null, page: "overview", memberOptions: {}, memberQuery: {} };
const content = document.querySelector("#page-content");

function esc(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function cssUrl(value) {
  const safe = String(value || DEFAULT_IMAGE).replace(/[\\"\r\n]/g, (char) => `\\${char}`);
  return `url("${safe}")`;
}

function setPreviewBackground(id, value) {
  const element = document.getElementById(id);
  if (element) element.style.backgroundImage = cssUrl(value);
}

function setCommunityBackground(value) {
  document.documentElement.style.setProperty("--community-background", cssUrl(value));
}

function icons() {
  if (window.lucide) window.lucide.createIcons();
}

function toast(message, error = false) {
  const node = document.createElement("div");
  node.className = `toast${error ? " error" : ""}`;
  node.innerHTML = `<i data-lucide="${error ? "circle-alert" : "circle-check"}"></i><span>${esc(message)}</span>`;
  document.querySelector("#toast-region").append(node);
  icons();
  window.setTimeout(() => node.remove(), 4200);
}

async function api(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (state.me?.csrf && !["GET", "HEAD"].includes((options.method || "GET").toUpperCase())) headers.set("x-csrf-token", state.me.csrf);
  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(url, { ...options, headers, credentials: "same-origin" });
  let result = {};
  try { result = await response.json(); } catch { /* A proxy can return a plain error page. */ }
  if (response.status === 401) {
    showLogin("session-expired");
    throw new Error("Your Discord session expired. Please sign in again.");
  }
  if (!response.ok) {
    const error = new Error(result.error || "The request could not be completed.");
    error.inviteUrl = result.inviteUrl;
    error.status = response.status;
    throw error;
  }
  return result;
}

function showLogin(reason = "") {
  document.querySelector("#app-shell").classList.add("hidden");
  document.querySelector("#login-screen").classList.remove("hidden");
  const messages = {
    "discord-config": "Finish the Discord OAuth settings in your Render environment variables first.",
    "discord-denied": "You did not approve the Discord sign-in.",
    "oauth-state": "The sign-in expired. Please start again.",
    "login-failed": "Sign-in could not be completed. Please try again.",
    "session-expired": "Your session expired. Please sign in again.",
  };
  const error = document.querySelector("#login-error");
  error.textContent = messages[reason] || "";
  error.classList.toggle("hidden", !messages[reason]);
  icons();
}

function updateProfile() {
  const user = state.me.user;
  document.querySelector("#profile-name").textContent = user.username || "Community member";
  document.querySelector("#profile-handle").textContent = `@${user.handle || "discord"}`;
  document.querySelector("#top-name").textContent = user.username || "LAST PLAYER";
  for (const id of ["profile-avatar", "top-avatar"]) {
    const image = document.getElementById(id);
    if (user.avatar) image.src = user.avatar;
  }
  document.querySelector("#sidebar-bot-status").textContent = state.me.botOnline ? "Bot online" : "Bot offline";
}

function updateGuildSelect() {
  const select = document.querySelector("#server-select");
  const guilds = state.me.guilds || [];
  select.innerHTML = guilds.length ? guilds.map((guild) => `<option value="${esc(guild.id)}">${esc(guild.name)}${guild.admin ? " · Admin" : ""}</option>`).join("") : `<option value="">No servers available</option>`;
  if (guilds.some((guild) => guild.id === state.guildId)) select.value = state.guildId;
  else state.guildId = guilds[0]?.id || "";
  if (state.guildId) localStorage.setItem("lc-guild", state.guildId);
}

async function refreshSnapshot() {
  if (!state.guildId) {
    state.snapshot = null;
    render();
    return;
  }
  content.innerHTML = `<div class="skeleton"></div><div class="stats-grid"><div class="skeleton"></div><div class="skeleton"></div></div>`;
  try {
    state.snapshot = await api(`/api/guild/${encodeURIComponent(state.guildId)}/snapshot`);
    const guild = state.snapshot.guild;
    document.querySelector("#footer-server").textContent = guild?.name || "Discord server";
    document.querySelector("#guild-status").innerHTML = `<span class="status-orb" style="background:${state.snapshot.installed ? "var(--green)" : "var(--gold)"}"></span> ${state.snapshot.installed ? "Bot online" : "Waiting for bot"}`;
    document.querySelector("#game-count").textContent = state.snapshot.games?.length || 0;
    document.querySelector("#voice-count").textContent = state.snapshot.rooms?.length || 0;
    render();
  } catch (error) {
    if (error.inviteUrl) {
      state.snapshot = { installed: false, inviteUrl: error.inviteUrl, admin: true };
      render();
      return;
    }
    toast(error.message, true);
    content.innerHTML = `<div class="empty-state"><div class="empty-icon"><i data-lucide="cloud-off"></i></div><h3>Could not load this server</h3><p>${esc(error.message)}</p><button class="button button-secondary" data-action="refresh"><i data-lucide="rotate-cw"></i> Try again</button></div>`;
    icons();
  }
}

function heading(kicker, title, subtitle, actions = "") {
  return `<div class="section-heading"><div><div class="section-kicker"><i data-lucide="sparkles"></i>${esc(kicker)}</div><h2>${esc(title)}</h2><p>${esc(subtitle)}</p></div>${actions ? `<div class="section-actions">${actions}</div>` : ""}</div>`;
}

function pageOverview() {
  const snap = state.snapshot;
  // FIX: names are passed raw to heading() (which escapes them once); they used to be escaped twice and the greeting was a plain string, so "${userName}" showed up literally.
  const userName = (state.me.user.username || "player").split(/[\s#]/)[0];
  const serverName = snap.guild?.name || "your server";
  const games = snap.games || [];
  const gangCount = snap.gangs?.length || 0;
  const rooms = snap.rooms || [];
  const members = snap.guild?.memberCount || "—";
  const gamePreview = games.slice(0, 4).map((game) => `<div class="game-mini"><span class="mini-emoji">${esc(game.emoji || "🎮")}</span><span>${esc(game.name)}</span></div>`).join("");
  const setupAction = snap.admin ? `<button class="button button-primary" data-action="setup"><i data-lucide="wand-sparkles"></i> Set up community</button>` : "";
  return `${heading("Your people, your space", `Welcome, ${userName}.`, `Manage ${serverName} and build a gaming space your crew will love.`, setupAction)}
    <section class="overview-hero"><div class="hero-copy"><span class="hero-label"><i data-lucide="radio"></i> LAST COMMUNITY · Your hangout</span><h1>Your friends are here.<br><span>Play it your way.</span></h1><p>Every game gets its own world, every gang gets its own HQ, and every voice session starts with one click.</p><div class="hero-actions"><button class="button button-primary" data-page="games"><i data-lucide="gamepad-2"></i> Explore game sections</button><button class="button button-secondary" data-page="voice"><i data-lucide="headphones"></i> Our voice rooms</button></div></div><div class="hero-glow"></div></section>
    <section class="stats-grid">
      <article class="stat-card"><span class="stat-icon"><i data-lucide="users-round"></i></span><span class="stat-meta"><span>Server members</span><strong>${esc(members)}</strong><small>Your friends in one place</small></span></article>
      <article class="stat-card"><span class="stat-icon"><i data-lucide="gamepad-2"></i></span><span class="stat-meta"><span>Game sections</span><strong>${games.length}</strong><small>Each with its own role</small></span></article>
      <article class="stat-card"><span class="stat-icon"><i data-lucide="shield"></i></span><span class="stat-meta"><span>Gang templates</span><strong>${gangCount}</strong><small>RP spaces ready to go</small></span></article>
      <article class="stat-card"><span class="stat-icon"><i data-lucide="headphones"></i></span><span class="stat-meta"><span>Your temporary rooms</span><strong>${rooms.length}</strong><small>Deleted when empty</small></span></article>
    </section>
    <section class="overview-grid"><article class="panel"><div class="panel-head"><h3><i data-lucide="zap"></i> Quick access</h3><small>Set up your community in a few steps</small></div><div class="panel-body"><div class="quick-list">
      <div class="quick-item"><span class="quick-icon"><i data-lucide="blocks"></i></span><span><strong>Organise game sections</strong><small>A private role and channels only players see</small></span><button data-page="games">Open →</button></div>
      <div class="quick-item"><span class="quick-icon"><i data-lucide="shield"></i></span><span><strong>Prepare RP gangs</strong><small>A private HQ for members, operations and trade</small></span><button data-page="gangs">Open →</button></div>
      <div class="quick-item"><span class="quick-icon"><i data-lucide="party-popper"></i></span><span><strong>Customise the welcome</strong><small>Your message, your image and the new-member role</small></span><button data-page="welcome">Open →</button></div>
    </div></div></article><article class="panel"><div class="panel-head"><h3><i data-lucide="trophy"></i> Community games</h3><button class="button button-secondary" data-page="games" style="min-height:28px;padding:0 9px;font-size:11px">All</button></div><div class="panel-body">${gamePreview ? `<div class="game-mini-grid">${gamePreview}</div>` : `<div class="empty-state" style="min-height:115px;padding:12px"><p>Set up the sections to see your games here.</p></div>`}</div></article></section>`;
}

function pageGames() {
  const snap = state.snapshot;
  const games = snap.games || [];
  const gameCards = games.map((game) => {
    const channels = (snap.channels || []).filter((channel) => channel.parentId === game.categoryId);
    const role = (snap.roles || []).find((item) => item.id === game.roleId);
    return `<article class="game-card"><div class="game-card-top"><span class="game-card-icon">${esc(game.emoji || "🎮")}</span><span><h3>${esc(game.name)}</h3><p>${channels.length} private channels · ${esc(role?.name || "Game role")}</p></span><span class="tag tag-good card-state"><i data-lucide="lock-keyhole"></i> Private</span></div><div class="game-channels">${channels.length ? channels.map((channel) => `<span class="channel-chip"><i data-lucide="hash"></i>${esc(channel.name)}</span>`).join("") : `<span class="channel-chip">Game channels are ready for role holders</span>`}</div><div class="card-footer"><small>Role ID · ${esc(game.roleId || "n/a")}</small>${snap.admin ? `<span class="tag"><i data-lucide="eye-off"></i> Visible to role holders only</span>` : ""}</div></article>`;
  }).join("");
  const actions = snap.admin ? `<button class="button button-secondary" data-action="setup"><i data-lucide="rotate-cw"></i> Sync sections</button>` : `<span class="tag"><i data-lucide="bot"></i> Pick your game with /roles</span>`;
  return `${heading("Every game in its place", "Games & Roles", "Players pick their game in Discord; the bot gives them the role and shows only that game's section.", actions)}
    ${snap.admin ? `<form id="create-game-form" class="panel form-card" style="margin-bottom:15px"><div class="panel-head" style="padding:0 0 12px;min-height:auto;margin-bottom:14px"><h3><i data-lucide="circle-plus"></i> Add a new game</h3><small>The bot creates the role, category and channels</small></div><div class="inline-form"><label class="field" style="flex:1"><span>Game name</span><input name="name" placeholder="e.g. Rocket League" maxlength="70" required></label><label class="field" style="width:100px"><span>Icon</span><input name="emoji" value="🎮" maxlength="12"></label><button class="button button-primary" type="submit"><i data-lucide="plus"></i> Add game</button></div></form>` : ""}
    ${gameCards ? `<div class="content-grid">${gameCards}</div>` : `<div class="empty-state"><span class="empty-icon"><i data-lucide="gamepad-2"></i></span><h3>Your game sections are waiting</h3><p>Click Set up community to create roles and sections for FiveM, Valorant, Fortnite, Minecraft and more. Each game's channels stay hidden from everyone else.</p>${snap.admin ? `<button class="button button-primary" data-action="setup"><i data-lucide="wand-sparkles"></i> Set up sections</button>` : ""}</div>`}
    <div class="asset-note" style="margin-top:14px"><i data-lucide="info"></i><span>After a member picks a role with <strong>/roles</strong>, the other games' channels stay hidden automatically. Members can switch their choice at any time.</span></div>`;
}

function pageGangs() {
  const snap = state.snapshot;
  const gangCards = (snap.gangs || []).map((gang) => {
    const channels = (snap.channels || []).filter((channel) => channel.parentId === gang.categoryId);
    const role = (snap.roles || []).find((item) => item.id === gang.roleId);
    const chips = (channels.length ? channels : GANG_CHANNEL_NAMES).map((channel) => `<span class="channel-chip"><i data-lucide="hash"></i>${esc(typeof channel === "string" ? channel : channel.name)}</span>`).join("");
    return `<article class="gang-card"><div class="gang-card-top"><span class="gang-card-icon">${esc(gang.emoji || "🏴")}</span><span><h3>${esc(gang.name)}</h3><p>${channels.length || GANG_CHANNEL_NAMES.length} channels restricted to the gang role</p></span><span class="tag ${gang.provisioned ? "tag-good" : "tag-gold"} card-state"><i data-lucide="${gang.provisioned ? "circle-check" : "clock-3"}"></i>${gang.provisioned ? "Ready" : "On first pick"}</span></div><div class="game-channels">${chips}</div><div class="card-footer"><small>${gang.roleId ? `Role · ${esc(role?.name || gang.roleId)}` : "The role is created on the first pick"}</small>${!gang.provisioned ? `<button class="button button-secondary" data-action="gang-help"><i data-lucide="terminal"></i> Pick with /gang</button>` : `<span class="tag tag-good"><i data-lucide="lock-keyhole"></i> Gang members only</span>`}</div></article>`;
  }).join("");
  const actions = snap.admin ? `<span class="tag tag-gold"><i data-lucide="users"></i> Members pick with /gang</span>` : `<span class="tag"><i data-lucide="terminal"></i> Use /gang in Discord</span>`;
  return `${heading("FiveM · Roleplay", "Every gang gets an HQ", "Families, Ballas, Bloods and more. The role unlocks the gang's channels automatically.", actions)}
    ${snap.admin ? `<form id="create-gang-form" class="panel form-card" style="margin-bottom:15px"><div class="panel-head" style="padding:0 0 12px;min-height:auto;margin-bottom:14px"><h3><i data-lucide="shield-plus"></i> Add a custom gang</h3><small>Role + private category + 6 RP channels</small></div><div class="inline-form"><label class="field" style="flex:1"><span>Gang or family name</span><input name="name" placeholder="e.g. The Lost MC" maxlength="70" required></label><label class="field" style="width:100px"><span>Icon</span><input name="emoji" value="🏴" maxlength="12"></label><button class="button button-primary" type="submit"><i data-lucide="plus"></i> Create section</button></div></form>` : ""}
    ${gangCards ? `<div class="content-grid">${gangCards}</div>` : `<div class="empty-state"><span class="empty-icon"><i data-lucide="shield"></i></span><h3>Create your first gang</h3><p>A gang's channels are visible only to members holding its role. Members can pick their gang with the /gang command.</p></div>`}
    <div class="asset-note" style="margin-top:14px"><i data-lucide="lock-keyhole"></i><span>Each gang category is shared by its members and includes general, members, operations, drug-trade, weapons-trade and territories channels. Members keep their gang role.</span></div>`;
}

function welcomePreviewText(message) {
  const serverName = state.snapshot?.guild?.name || "the server";
  return String(message || "").replaceAll("{user}", "@NewMember").replaceAll("{server}", serverName);
}

function pageWelcome() {
  const snap = state.snapshot;
  const settings = snap.settings || {};
  const textChannels = (snap.channels || []).filter((channel) => [0, 5].includes(channel.type));
  const roles = snap.roles || [];
  return `${heading("A first impression that lasts", "Welcome & Members", "Greet your friends with a message and an image of your choice. New members get their role automatically.", `<button class="button button-secondary" data-action="preview-welcome"><i data-lucide="eye"></i> Preview</button>`)}
    ${!snap.admin ? `<div class="empty-state"><span class="empty-icon"><i data-lucide="lock-keyhole"></i></span><h3>Admin settings</h3><p>You need the Manage Server permission in Discord to edit the welcome message and default role.</p></div>` : `<div class="content-grid"><form id="welcome-form" class="panel form-card"><div class="form-grid">
      <label class="field field-full"><span>Welcome channel</span><select name="welcomeChannelId"><option value="">No welcome channel</option>${textChannels.map((channel) => `<option value="${esc(channel.id)}" ${channel.id === settings.welcomeChannelId ? "selected" : ""}># ${esc(channel.name)}</option>`).join("")}</select><small class="help-text">The bot sends a clean embed that mentions the member and shows your image.</small></label>
      <label class="field field-full"><span>Welcome message</span><textarea name="welcomeMessage" maxlength="1600" placeholder="Welcome {user} to {server}!">${esc(settings.welcomeMessage || "")}</textarea><small class="help-text">Use {user} to mention the member and {server} for the server name.</small></label>
      <label class="field field-full"><span>New member role</span><select name="defaultRoleId"><option value="">Do not assign a role automatically</option>${roles.map((role) => `<option value="${esc(role.id)}" ${role.id === settings.defaultRoleId ? "selected" : ""}>${esc(role.name)}</option>`).join("")}</select><small class="help-text">The bot's role must be higher than this role.</small></label>
      <div class="field field-full"><span>Welcome image or GIF</span><div class="asset-row"><input name="welcomeImageUrl" value="${esc(settings.welcomeImageUrl || DEFAULT_IMAGE)}" placeholder="https://example.com/welcome.gif"><label class="button button-secondary" for="welcome-upload"><i data-lucide="upload"></i> Upload image / GIF</label><input id="welcome-upload" type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-upload-target="welcomeImageUrl" hidden></div><small class="help-text">JPG, PNG, WEBP or GIF · up to 10 MB</small></div>
    </div><div class="form-actions"><button class="button button-primary" type="submit"><i data-lucide="save"></i> Save welcome settings</button></div></form>
    <aside class="panel form-card"><div class="panel-head" style="padding:0 0 13px;min-height:auto;margin-bottom:13px"><h3><i data-lucide="sparkles"></i> Welcome preview</h3><span class="tag tag-good">Preview</span></div><div id="welcome-preview" class="preview-card"><div class="preview-content"><span class="tag tag-good"><i data-lucide="party-popper"></i> New member</span><h3>Welcome to the community! ✨</h3><p id="welcome-preview-text">${esc(welcomePreviewText(settings.welcomeMessage))}</p></div></div><p class="help-text" style="margin:12px 0 0">The bot shows the full welcome image inside the Discord message. The LAST COMMUNITY image is the default.</p></aside></div>`}`;
}

function pageAppearance() {
  const snap = state.snapshot;
  const settings = snap.settings || {};
  return `${heading("Community identity", "Appearance", "Make the dashboard reflect your style. The LAST COMMUNITY image is the default background.", `<span class="tag tag-good"><i data-lucide="image"></i> LAST COMMUNITY</span>`)}
    ${!snap.admin ? `<div class="empty-state"><span class="empty-icon"><i data-lucide="lock-keyhole"></i></span><h3>Admin settings</h3><p>You need the Manage Server permission to change the appearance.</p></div>` : `<div class="content-grid"><form id="appearance-form" class="panel form-card"><div class="panel-head" style="padding:0 0 14px;min-height:auto;margin-bottom:14px"><h3><i data-lucide="panels-top-left"></i> Dashboard background</h3></div><div class="field"><span>Background URL</span><input name="backgroundUrl" value="${esc(settings.backgroundUrl || DEFAULT_IMAGE)}" placeholder="https://example.com/background.jpg"><small class="help-text">An HTTPS link to an external image, or an image you uploaded here.</small></div><div class="asset-row" style="margin-top:12px"><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-upload-target="backgroundUrl" id="background-upload" hidden><label class="button button-secondary" for="background-upload"><i data-lucide="upload"></i> Upload image or GIF</label><span class="help-text">PNG / JPG / WEBP / GIF · up to 10 MB</span></div><div class="form-actions"><button class="button button-primary" type="submit"><i data-lucide="save"></i> Save background</button></div></form>
    <div id="background-preview" class="preview-card" style="min-height:290px"><div class="preview-content"><span class="tag tag-gold"><i data-lucide="sparkles"></i> Live preview</span><h3>This is your crew's space.</h3><p>LAST COMMUNITY · every game in its place</p></div></div></div><div class="asset-note" style="margin-top:14px"><i data-lucide="image"></i><span>Uploaded files are stored on the persistent Render disk, and you can reuse the same image for the dashboard background or the welcome message.</span></div>`}`;
}

function pageVoice() {
  const snap = state.snapshot;
  const rooms = snap.rooms || [];
  const voiceChannels = snap.voiceChannels || [];
  const settings = snap.settings || {};
  const roomCards = rooms.map((room) => {
    const isOwner = room.ownerId === state.me.user.id;
    const canManage = isOwner || snap.admin;
    const memberOptions = state.memberOptions[room.id] || [];
    const selectedName = room.name.replace(/^🔊・/u, "");
    const disabled = canManage ? "" : "disabled";
    return `<article class="voice-card"><div class="voice-card-head"><span class="voice-icon"><i data-lucide="headphones"></i></span><span><h3>${esc(room.name)}</h3><p>Room owner · ${esc(room.ownerName)}${isOwner ? " · you" : ""}</p></span><span class="tag ${room.locked ? "tag-gold" : "tag-good"}"><i data-lucide="${room.locked ? "lock-keyhole" : "door-open"}"></i>${room.locked ? "Invite only" : "Open"}</span></div><div class="voice-controls"><label class="field"><span>Room name</span><input data-room-name="${esc(room.id)}" value="${esc(selectedName)}" maxlength="70" ${disabled}></label><label class="field"><span>Member limit</span><input data-room-limit="${esc(room.id)}" type="number" min="0" max="99" value="${Number(room.userLimit || 0)}" ${disabled}></label><button class="button ${room.locked ? "button-secondary" : "button-primary"}" data-action="toggle-lock" data-room="${esc(room.id)}" data-locked="${room.locked}" ${disabled}><i data-lucide="${room.locked ? "unlock" : "lock"}"></i>${room.locked ? "Open room" : "Lock room"}</button><button class="button button-secondary" data-action="save-room" data-room="${esc(room.id)}" ${disabled}><i data-lucide="save"></i> Save</button></div><div class="voice-members">${room.members.length ? room.members.map((member) => `<span class="voice-member"><img src="${esc(member.avatar)}" alt=""><span>${esc(member.name)}</span>${member.id !== room.ownerId && canManage ? `<button data-action="remove-member" data-room="${esc(room.id)}" data-member="${esc(member.id)}" title="Remove from room"><i data-lucide="x"></i></button>` : ""}</span>`).join("") : `<span class="help-text">Nobody is in the room right now.</span>`}</div>${canManage ? `<div class="voice-invite"><input class="member-search" data-member-search="${esc(room.id)}" placeholder="Name or Discord ID" value="${esc(state.memberQuery[room.id] || "")}"><button class="button button-secondary" data-action="search-members" data-room="${esc(room.id)}"><i data-lucide="search"></i> Search</button><select class="member-select" data-member-picker="${esc(room.id)}"><option value="">Pick a friend to invite</option>${memberOptions.map((member) => `<option value="${esc(member.id)}">${esc(member.name)} (@${esc(member.handle)})</option>`).join("")}</select><button class="button button-primary" data-action="invite-member" data-room="${esc(room.id)}"><i data-lucide="user-plus"></i> Invite</button></div>` : ""}</article>`;
  }).join("");
  const roomIntro = `<div class="panel form-card" style="margin-bottom:15px"><div class="panel-head" style="padding:0 0 13px;min-height:auto;margin-bottom:13px"><h3><i data-lucide="audio-lines"></i> Automatic room creation</h3><span class="tag tag-good">Available to everyone</span></div>${snap.admin ? `<div class="form-grid"><label class="field field-full"><span>Channel that creates a room</span><select id="voice-lobby-select"><option value="">Pick a voice channel</option>${voiceChannels.map((channel) => `<option value="${esc(channel.id)}" ${channel.id === settings.voiceLobbyId ? "selected" : ""}>${esc(channel.name)}</option>`).join("")}</select><small class="help-text">Anyone who joins gets a private room and is moved into it. Admins can also post the /voice-panel button in a text channel.</small></label></div><div class="form-actions"><button class="button button-primary" data-action="save-voice-hub"><i data-lucide="save"></i> Save creator channel</button><span class="help-text">Empty rooms are deleted automatically.</span></div>` : `<div class="asset-note"><i data-lucide="info"></i><span>Join the room creator channel in Discord or use the /voice-panel button. The rooms you own appear here, where you can invite friends, lock them and change their capacity.</span></div>`}</div>`;
  return `${heading("Your room, your rules", "Voice Rooms", "Create a room in your name, control who joins, and invite friends from here.", `<span class="tag tag-good"><i data-lucide="radio"></i> ${rooms.length} active rooms</span>`)}${roomIntro}${roomCards ? `<div class="content-grid">${roomCards}</div>` : `<div class="empty-state"><span class="empty-icon"><i data-lucide="headphones"></i></span><h3>You have no rooms right now</h3><p>Join the room creator channel in Discord, or press <strong>Create my room</strong> on the /voice-panel message. The management tools appear as soon as your room exists.</p></div>`}`;
}

function renderBotInvite() {
  const guild = state.me.guilds.find((item) => item.id === state.guildId);
  if (!guild?.admin) {
    return `<div class="bot-invite panel"><span class="empty-icon"><i data-lucide="bot"></i></span><h2>Add the bot to this server</h2><p>This server has not added the LAST COMMUNITY bot yet. Ask a server admin to add it so the sections appear and room management works.</p><span class="tag tag-gold"><i data-lucide="shield-alert"></i> Manage Server permission required to add it</span></div>`;
  }
  const inviteUrl = state.snapshot?.inviteUrl || `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(state.me.clientId)}&permissions=${encodeURIComponent(state.me.botPermissions || "3156992")}&scope=bot%20applications.commands`;
  return `<div class="bot-invite panel"><span class="empty-icon"><i data-lucide="bot"></i></span><h2>Bring LAST COMMUNITY to your server</h2><p>Add the bot with permission to manage channels and roles, move voice members and send welcome messages. After adding it, come back here and refresh.</p><a class="button button-primary" href="${esc(inviteUrl)}" target="_blank" rel="noopener"><i data-lucide="external-link"></i> Add the bot to Discord</a><div style="margin-top:12px"><button class="button button-secondary" data-action="refresh"><i data-lucide="rotate-cw"></i> Refresh bot status</button></div></div>`;
}

function render() {
  if (!state.me) return;
  document.querySelector("#login-screen").classList.add("hidden");
  document.querySelector("#app-shell").classList.remove("hidden");
  document.querySelector("#page-crumb").textContent = pageNames[state.page];
  document.querySelectorAll(".nav-link").forEach((link) => link.classList.toggle("active", link.dataset.page === state.page));
  const snap = state.snapshot;
  if (!snap) {
    content.innerHTML = `<div class="empty-state"><span class="empty-icon"><i data-lucide="server"></i></span><h3>Pick a server from the menu</h3><p>You can manage servers where the bot is installed or where you have permission to manage the server.</p></div>`;
  } else if (!snap.installed) {
    setCommunityBackground(DEFAULT_IMAGE);
    content.innerHTML = renderBotInvite();
  } else {
    setCommunityBackground(snap.settings?.backgroundUrl);
    const pages = { overview: pageOverview, games: pageGames, gangs: pageGangs, voice: pageVoice, welcome: pageWelcome, appearance: pageAppearance };
    content.innerHTML = pages[state.page]();
    if (state.page === "welcome") setPreviewBackground("welcome-preview", snap.settings?.welcomeImageUrl);
    if (state.page === "appearance") setPreviewBackground("background-preview", snap.settings?.backgroundUrl);
  }
  icons();
}

async function loadMembers(roomId, query = "") {
  try {
    state.memberQuery[roomId] = query;
    const result = await api(`/api/guild/${encodeURIComponent(state.guildId)}/members?q=${encodeURIComponent(query)}`);
    state.memberOptions[roomId] = result.members || [];
    render();
    toast(result.members?.length ? "Members found. Pick a friend and press Invite." : "No members matched that search.", !result.members?.length);
  } catch (error) { toast(error.message, true); }
}

function sendJson(url, method, payload) {
  return api(url, { method, body: JSON.stringify(payload) });
}

async function uploadFile(input) {
  const file = input.files?.[0];
  if (!file) return;
  const target = input.dataset.uploadTarget;
  const body = new FormData();
  body.append("asset", file);
  try {
    const uploaded = await api(`/api/guild/${encodeURIComponent(state.guildId)}/assets`, { method: "POST", body });
    await sendJson(`/api/guild/${encodeURIComponent(state.guildId)}/settings`, "PUT", { [target]: uploaded.url });
    toast("Image uploaded and saved. It survives Render restarts.");
    await refreshSnapshot();
  } catch (error) { toast(error.message, true); }
  finally { input.value = ""; }
}

async function handleSubmit(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  const submit = form.querySelector("[type=submit]");
  if (submit) submit.disabled = true;
  try {
    if (form.id === "create-game-form" || form.id === "create-gang-form") {
      const payload = Object.fromEntries(new FormData(form).entries());
      const resource = form.id === "create-game-form" ? "games" : "gangs";
      const result = await sendJson(`/api/guild/${encodeURIComponent(state.guildId)}/${resource}`, "POST", payload);
      toast(result.message || "Created successfully.");
      await refreshSnapshot();
    } else if (form.id === "welcome-form" || form.id === "appearance-form") {
      const payload = Object.fromEntries(new FormData(form).entries());
      await sendJson(`/api/guild/${encodeURIComponent(state.guildId)}/settings`, "PUT", payload);
      toast(form.id === "welcome-form" ? "Welcome settings saved." : "Community background saved.");
      await refreshSnapshot();
    }
  } catch (error) { toast(error.message, true); }
  finally { if (submit) submit.disabled = false; }
}

async function handleClick(event) {
  const pageButton = event.target.closest("[data-page]");
  if (pageButton) {
    state.page = pageButton.dataset.page;
    document.querySelector(".sidebar").classList.remove("mobile-open");
    render();
    return;
  }
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  const base = `/api/guild/${encodeURIComponent(state.guildId)}`;
  try {
    if (action === "menu") { document.querySelector(".sidebar").classList.toggle("mobile-open"); return; }
    if (action === "profile") { state.page = "overview"; render(); return; }
    if (action === "refresh") { await refreshSnapshot(); return; }
    if (action === "logout") {
      await api("/auth/logout", { method: "POST" });
      localStorage.removeItem("lc-guild");
      window.location.reload();
      return;
    }
    if (action === "setup") {
      button.disabled = true;
      const result = await sendJson(`${base}/setup`, "POST", {});
      toast(result.message || "Server setup complete.");
      await refreshSnapshot();
      return;
    }
    if (action === "gang-help") { toast("Open Discord and type /gang to pick your gang."); return; }
    if (action === "preview-welcome") { document.querySelector("#welcome-preview")?.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
    if (action === "save-voice-hub") {
      const voiceLobbyId = document.querySelector("#voice-lobby-select")?.value || "";
      await sendJson(`${base}/settings`, "PUT", { voiceLobbyId });
      toast("Room creator channel saved.");
      await refreshSnapshot();
      return;
    }
    const roomId = button.dataset.room;
    if (action === "save-room") {
      const name = document.querySelector(`[data-room-name="${CSS.escape(roomId)}"]`).value;
      const userLimit = Number(document.querySelector(`[data-room-limit="${CSS.escape(roomId)}"]`).value);
      await sendJson(`${base}/voice/${encodeURIComponent(roomId)}`, "PATCH", { name, userLimit });
      toast("Room settings saved.");
      await refreshSnapshot();
      return;
    }
    if (action === "toggle-lock") {
      const locked = button.dataset.locked !== "true";
      await sendJson(`${base}/voice/${encodeURIComponent(roomId)}`, "PATCH", { locked });
      toast(locked ? "Room locked. Only invited members can join." : "Room opened to everyone in the server.");
      await refreshSnapshot();
      return;
    }
    if (action === "search-members") {
      const query = document.querySelector(`[data-member-search="${CSS.escape(roomId)}"]`)?.value.trim() || "";
      await loadMembers(roomId, query);
      return;
    }
    if (action === "invite-member") {
      const memberId = document.querySelector(`[data-member-picker="${CSS.escape(roomId)}"]`)?.value;
      if (!memberId) { toast("Press Search first, then pick a friend from the list.", true); return; }
      const result = await sendJson(`${base}/voice/${encodeURIComponent(roomId)}/members/${encodeURIComponent(memberId)}`, "POST", { action: "invite" });
      toast(result.message || "Member invited.");
      await refreshSnapshot();
      return;
    }
    if (action === "remove-member") {
      const result = await sendJson(`${base}/voice/${encodeURIComponent(roomId)}/members/${encodeURIComponent(button.dataset.member)}`, "POST", { action: "remove" });
      toast(result.message || "Member removed.");
      await refreshSnapshot();
    }
  } catch (error) { toast(error.message, true); }
  finally { button.disabled = false; }
}

document.addEventListener("click", handleClick);
document.addEventListener("submit", handleSubmit);
document.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && event.target.matches?.("[data-member-search]")) {
    event.preventDefault();
    loadMembers(event.target.dataset.memberSearch, event.target.value.trim());
  }
});
document.addEventListener("input", (event) => {
  const field = event.target;
  if (field.name === "welcomeMessage") {
    const text = document.querySelector("#welcome-preview-text");
    if (text) text.textContent = welcomePreviewText(field.value);
  } else if (field.name === "welcomeImageUrl") setPreviewBackground("welcome-preview", field.value);
  else if (field.name === "backgroundUrl") setPreviewBackground("background-preview", field.value);
});
document.addEventListener("change", async (event) => {
  if (event.target.id === "server-select") {
    state.guildId = event.target.value;
    localStorage.setItem("lc-guild", state.guildId);
    await refreshSnapshot();
  } else if (event.target.matches("input[type=file][data-upload-target]")) {
    await uploadFile(event.target);
  }
});

async function boot() {
  try {
    state.me = await api("/api/me");
    updateProfile();
    updateGuildSelect();
    await refreshSnapshot();
  } catch {
    if (!state.me) showLogin(new URLSearchParams(location.search).get("error") || "");
  }
  icons();
}

boot();
