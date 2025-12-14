import {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder
} from "discord.js"

import express from "express"
import fetch from "node-fetch"
import { createClient } from "@supabase/supabase-js"

// ================= CLIENT =================
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
})

const app = express()
app.use(express.json())

// ================= SUPABASE =================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

// ================= ADMIN CHECK =================
async function isAdmin(discordId) {
  const { data } = await supabase
    .from("admins")
    .select("discord_id")
    .eq("discord_id", discordId)
    .maybeSingle()

  return !!data
}

// ================= KEEP ALIVE =================
app.get("/ping", (req, res) => {
  res.send("Alive")
})

// self ping
setInterval(async () => {
  try {
    await fetch(`${process.env.SELF_URL}/ping`)
  } catch (e) {}
}, 5 * 60 * 1000)

// ================= ROBLOX TRACK =================
app.post("/track", async (req, res) => {
  const { player_id, username, display_name } = req.body

  // ---- BAN CHECK ----
  const { data: ban } = await supabase
    .from("bans")
    .select("*")
    .eq("player_id", player_id)
    .maybeSingle()

  if (ban?.expires_at && new Date(ban.expires_at) < new Date()) {
    await supabase.from("bans").delete().eq("player_id", player_id)
  }

  if (ban) {
    return res.json({ banned: true, reason: ban.reason })
  }

  // ---- SAVE HISTORY ----
  await supabase.from("executions").insert({
    player_id,
    username,
    display_name
  })

  // ---- WHITELIST CHECK ----
  const { data: wl } = await supabase
    .from("whitelist")
    .select("player_id")
    .eq("player_id", player_id)
    .maybeSingle()

  // ---- SEND LOG IF NOT WHITELIST ----
  if (!wl) {
    const embed = new EmbedBuilder()
      .setTitle("🚨 Script Executed")
      .setColor(0xff0000)
      .addFields(
        { name: "Username", value: username, inline: true },
        { name: "Display Name", value: display_name, inline: true },
        { name: "Player ID", value: player_id }
      )
      .setTimestamp()

    const channel = await client.channels.fetch(process.env.LOG_CHANNEL)
    channel.send({ embeds: [embed] })
  }

  res.json({ banned: false })
})

// ================= SERVER =================
app.listen(process.env.PORT || 3000)

// ================= SLASH COMMANDS =================
const commands = [

  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a player permanently")
    .addStringOption(o =>
      o.setName("playerid")
        .setDescription("Roblox Player ID")
        .setRequired(true))
    .addStringOption(o =>
      o.setName("reason")
        .setDescription("Ban reason")
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName("tempban")
    .setDescription("Temporarily ban a player")
    .addStringOption(o =>
      o.setName("playerid")
        .setDescription("Roblox Player ID")
        .setRequired(true))
    .addIntegerOption(o =>
      o.setName("minutes")
        .setDescription("Duration in minutes")
        .setRequired(true))
    .addStringOption(o =>
      o.setName("reason")
        .setDescription("Reason")
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName("unban")
    .setDescription("Remove ban from player")
    .addStringOption(o =>
      o.setName("playerid")
        .setDescription("Roblox Player ID")
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName("banlist")
    .setDescription("Show all banned players"),

  new SlashCommandBuilder()
    .setName("clearbans")
    .setDescription("Remove all bans"),

  new SlashCommandBuilder()
    .setName("whitelist")
    .setDescription("Manage whitelist")
    .addSubcommand(s =>
      s.setName("add")
        .setDescription("Add player to whitelist")
        .addStringOption(o =>
          o.setName("playerid")
            .setDescription("Roblox Player ID")
            .setRequired(true)))
    .addSubcommand(s =>
      s.setName("remove")
        .setDescription("Remove player from whitelist")
        .addStringOption(o =>
          o.setName("playerid")
            .setDescription("Roblox Player ID")
            .setRequired(true)))
    .addSubcommand(s =>
      s.setName("list")
        .setDescription("Show whitelist")),

  new SlashCommandBuilder()
    .setName("history")
    .setDescription("Show execution history")
    .addStringOption(o =>
      o.setName("value")
        .setDescription("Username or Player ID")
        .setRequired(true))

].map(c => c.toJSON())

// ================= REGISTER =================
client.once("ready", async () => {
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN)
  await rest.put(
    Routes.applicationCommands(client.user.id),
    { body: commands }
  )
  console.log("Bot online")
})

// ================= COMMAND HANDLER =================
client.on("interactionCreate", async i => {
  if (!i.isChatInputCommand()) return

  if (!(await isAdmin(i.user.id))) {
    return i.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("❌ Access Denied")
          .setDescription("Admin only command")
          .setColor(0xff0000)
      ],
      ephemeral: true
    })
  }

  const pid = i.options.getString("playerid")

  if (i.commandName === "ban") {
    await supabase.from("bans").upsert({
      player_id: pid,
      reason: i.options.getString("reason")
    })
    return i.reply({ embeds: [new EmbedBuilder().setTitle("🚫 Banned").setDescription(pid)] })
  }

  if (i.commandName === "tempban") {
    const mins = i.options.getInteger("minutes")
    const exp = new Date(Date.now() + mins * 60000)
    await supabase.from("bans").upsert({
      player_id: pid,
      reason: i.options.getString("reason"),
      expires_at: exp
    })
    return i.reply({ embeds: [new EmbedBuilder().setTitle("⏱ Temp Ban").setDescription(exp.toString())] })
  }

  if (i.commandName === "unban") {
    await supabase.from("bans").delete().eq("player_id", pid)
    return i.reply({ embeds: [new EmbedBuilder().setTitle("✅ Unbanned")] })
  }

  if (i.commandName === "banlist") {
    const { data } = await supabase.from("bans").select("*")
    return i.reply({
      embeds: [new EmbedBuilder()
        .setTitle("🚫 Ban List")
        .setDescription(data.map(b => `${b.player_id} | ${b.reason}`).join("\n") || "Empty")]
    })
  }

  if (i.commandName === "clearbans") {
    await supabase.from("bans").delete().neq("player_id", "")
    return i.reply({ embeds: [new EmbedBuilder().setTitle("🧹 All bans cleared")] })
  }

  if (i.commandName === "whitelist") {
    const sub = i.options.getSubcommand()
    if (sub === "add") await supabase.from("whitelist").upsert({ player_id: pid })
    if (sub === "remove") await supabase.from("whitelist").delete().eq("player_id", pid)
    if (sub === "list") {
      const { data } = await supabase.from("whitelist").select("player_id")
      return i.reply({
        embeds: [new EmbedBuilder()
          .setTitle("Whitelist")
          .setDescription(data.map(x => x.player_id).join("\n") || "Empty")]
      })
    }
    return i.reply({ embeds: [new EmbedBuilder().setTitle("Whitelist updated")] })
  }

  if (i.commandName === "history") {
    const val = i.options.getString("value")
    const { data } = await supabase
      .from("executions")
      .select("*")
      .or(`player_id.eq.${val},username.eq.${val}`)
      .order("executed_at", { ascending: false })
      .limit(10)

    return i.reply({
      embeds: [new EmbedBuilder()
        .setTitle("📜 Execution History")
        .setDescription(
          data.map(e =>
            `${e.username} (${e.player_id})\n${new Date(e.executed_at).toLocaleString()}`
          ).join("\n\n") || "No data")]
    })
  }
})

client.login(process.env.DISCORD_TOKEN)
