# Starboard Bot

A Discord starboard bot that reposts popular messages when any single reaction reaches a configured threshold. It also includes utility commands for stats, help, copying channel messages, and downloading public Instagram/Facebook videos with the `meta` command.

## Features

- Posts messages to a starboard channel when any emoji reaches the reaction threshold.
- Updates existing starboard posts when reaction counts increase.
- Optionally removes starboard posts when reactions drop below the threshold.
- Supports images, GIFs, attachments, stickers, and jump-to-message buttons.
- Stores starboard entries in MongoDB so posts can be updated later.
- Provides prefix commands and slash commands.
- Includes a `meta` command to download and send public Instagram/Facebook videos.
- Includes a simple HTTP health check for Render hosting.
- Uses colored console logs: green for success, red for errors, white for normal logs.

## Commands

Default prefix: `!`

| Command                                                      | Description                                                       |
| ------------------------------------------------------------ | ----------------------------------------------------------------- |
| `!help` or `/help`                                           | Show bot help.                                                    |
| `!stats` or `/stats`                                         | Show starboard statistics for the server.                         |
| `!copy #channel [limit]` or `/copy source:#channel limit:10` | Copy messages from another text channel into the current channel. |
| `!meta <url>` or `/meta url:<url>`                           | Download and send a public Instagram/Facebook video.              |
| `!starboard help` or `!sb help`                              | Show starboard command help.                                      |
| `!starboard stats` or `!sb stats`                            | Show starboard statistics.                                        |
| `!starboard copy #channel [limit]`                           | Copy messages through the starboard command group.                |
| `!starboard meta <url>`                                      | Download and send a public Instagram/Facebook video.              |

## Requirements

- Node.js 18 or newer
- MongoDB database URI
- Discord bot token
- A Discord server where you can invite and configure the bot

## Discord Bot Setup

1. Go to the Discord Developer Portal.
2. Create an application and add a bot user.
3. Copy the bot token.
4. Enable these privileged gateway intents:
   - Message Content Intent
   - Server Members Intent
5. Invite the bot to your server with permissions for:
   - View Channels
   - Send Messages
   - Read Message History
   - Add Reactions
   - Manage Messages
   - Attach Files
   - Use Slash Commands

The `copy` command requires the user running it to have the Discord `Manage Server` permission.

## Installation

```bash
git clone https://github.com/milancodess/starboard.git
cd starboard
npm install
```

Create a `.env` file in the project root:

```env
DISCORD_TOKEN=your_discord_bot_token
MONGODB_URI=your_mongodb_connection_string
STARBOARD_CHANNEL_ID=your_starboard_channel_id

REACTION_THRESHOLD=4
PREFIX=!
ALLOW_BOT_MESSAGES=false
ALLOW_SELF_REACT=false
REMOVE_ON_THRESHOLD_DROP=false
META_MAX_DOWNLOAD_MB=25

COLOR_STARBOARD=ffd700
COLOR_ERROR=ff0000
COLOR_SUCCESS=00ff00
COLOR_INFO=0099ff
```

Start the bot:

```bash
npm start
```

For development with auto-restart:

```bash
npm run dev
```

## Environment Variables

| Variable                   | Required | Default           | Description                                                                              |
| -------------------------- | -------- | ----------------- | ---------------------------------------------------------------------------------------- |
| `DISCORD_TOKEN`            | Yes      | None              | Discord bot token.                                                                       |
| `MONGODB_URI`              | Yes      | None              | MongoDB connection string.                                                               |
| `STARBOARD_CHANNEL_ID`     | Yes      | Built-in fallback | Channel where starboard posts are sent. Set this to your own server's starboard channel. |
| `REACTION_THRESHOLD`       | No       | `4`               | Number of reactions needed for a message to reach starboard.                             |
| `PREFIX`                   | No       | `!`               | Prefix for text commands.                                                                |
| `ALLOW_BOT_MESSAGES`       | No       | `false`           | Whether bot-authored messages can be starred.                                            |
| `ALLOW_SELF_REACT`         | No       | `false`           | Whether users can trigger starboard by reacting to their own messages.                   |
| `REMOVE_ON_THRESHOLD_DROP` | No       | `false`           | Whether starboard posts are removed if reactions drop below the threshold.               |
| `META_MAX_DOWNLOAD_MB`     | No       | `25`              | Maximum video size the `meta` command will download and upload.                          |
| `COLOR_STARBOARD`          | No       | `ffd700`          | Embed color for starboard posts.                                                         |
| `COLOR_ERROR`              | No       | `ff0000`          | Error color setting.                                                                     |
| `COLOR_SUCCESS`            | No       | `00ff00`          | Success color setting.                                                                   |
| `COLOR_INFO`               | No       | `0099ff`          | Info embed color.                                                                        |

Color values should be hex strings without `#`.

## Meta Downloader Notes

The `meta` command downloads public Instagram and Facebook videos and uploads the video file to Discord.

Supported URL hosts:

- `instagram.com`
- subdomains of `instagram.com`
- `facebook.com`
- subdomains of `facebook.com`
- `fb.watch`

If a video is private, expired, too large, or blocked by the source site, the bot will return an error message instead of uploading it.

## Render Deployment

This repo includes `render.yaml` for deploying as a Render web service.

1. Push the repository to GitHub.
2. Create a new Render Blueprint or Web Service from the repo.
3. Add these secret environment variables in Render:
   - `DISCORD_TOKEN`
   - `MONGODB_URI`
   - `STARBOARD_CHANNEL_ID`
4. Keep the existing build and start commands:

```bash
npm install
npm start
```

The bot exposes a health check endpoint at `/`, which Render can use to keep the service healthy.

## Data Stored in MongoDB

Each starboard entry stores:

- Original message ID
- Starboard message ID
- Original channel ID
- Guild ID
- Trigger emoji
- Reaction count
- Reaction breakdown
- Author ID, name, and avatar
- Created and updated timestamps

## Troubleshooting

If slash commands do not appear, restart the bot and wait a minute for Discord to sync them.

If messages are not being starred, check that the bot has `View Channel`, `Read Message History`, and `Send Messages` permissions in both the source channels and starboard channel.

If copied messages fail to send attachments, make sure the bot has `Attach Files` in the destination channel.

If `meta` cannot upload a video, raise `META_MAX_DOWNLOAD_MB` only if your Discord server upload limit supports larger files.

## Contributing

Issues and pull requests are welcome.

If you find a bug, have an idea, or want to improve the bot, open an issue or submit a PR on GitHub:

https://github.com/milancodess/starboard/issues

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
