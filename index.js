import {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder
} from "discord.js"
import { createClient } from "@supabase/supabase-js"

const client = new Client({ intents: [GatewayIntentBits.Guilds] })

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

// ===== SLASH COMMANDS =====
const commands = [
  new SlashCommandBuilder()
    .setName("whitelist")
    .setDescription("Whitelist controls")
    .addSubcommand(s =>
      s.setName("add")
        .setDescription("Add user")
        .addStringOption(o => o.setName("userid").setDescription("User ID").setRequired(true))
        .addStringOption(o => o.setName("username").setDescription("Username").setRequired(true))
        .addStringOption(o => o.setName("display").setDescription("Display name").setRequired(true))
        .addStringOption(o => o.setName("playerid").setDescription("Player ID").setRequired(true))
    )
    .addSubcommand(s =>
      s.setName("remove")
        .setDescription("Remove user")
        .addStringOption(o => o.setName("userid").setDescription("User ID").setRequired(true))
    ),

  new SlashCommandBuilder()
    .setName("history")
    .setDescription("Execution history")
    .addStringOption(o =>
      o.setName("value").setDescription("username / display / player id").setRequired(true)
    )
].map(c => c.toJSON())

client.once("ready", async () => {
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN)
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands })
  console.log("Bot online & commands registered")
})

// ===== COMMAND HANDLER =====
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return

  // WHITELIST
  if (interaction.commandName === "whitelist") {
    const sub = interaction.options.getSubcommand()

    if (sub === "add") {
      await supabase.from("whitelist").insert({
        user_id: interaction.options.getString("userid"),
        username: interaction.options.getString("username"),
        display_name: interaction.options.getString("display"),
        player_id: interaction.options.getString("playerid")
      })

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("✅ User Whitelisted")
            .setColor(0x00ff99)
            .addFields(
              { name: "Username", value: interaction.options.getString("username"), inline: true },
              { name: "Display", value: interaction.options.getString("display"), inline: true },
              { name: "Player ID", value: interaction.options.getString("playerid"), inline: true }
            )
            .setTimestamp()
        ]
      })
    }

    if (sub === "remove") {
      await supabase.from("whitelist")
        .delete()
        .eq("user_id", interaction.options.getString("userid"))

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("❌ Removed from Whitelist")
            .setColor(0xff5555)
            .setTimestamp()
        ]
      })
    }
  }

  // HISTORY
  if (interaction.commandName === "history") {
    const value = interaction.options.getString("value")

    const { data } = await supabase
      .from("executions")
      .select("*")
      .or(`username.eq.${value},display_name.eq.${value},player_id.eq.${value}`)
      .order("executed_at", { ascending: false })
      .limit(10)

    if (!data || data.length === 0) {
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("❌ No History Found")
            .setColor(0xff0000)
        ]
      })
    }

    const desc = data.map(
      (e, i) =>
        `**${i + 1}.** ${new Date(e.executed_at).toLocaleString()}
User: ${e.username}
Display: ${e.display_name}
Player ID: ${e.player_id}`
    ).join("\n\n")

    interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("📜 Execution History")
          .setColor(0x0099ff)
          .setDescription(desc)
          .setTimestamp()
      ]
    })
  }
})

client.login(process.env.DISCORD_TOKEN)
