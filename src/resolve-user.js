import { config } from './lib/config.js';
import { getAppAccessToken } from './lib/twitchAuth.js';
import { helixGetUsers } from './lib/twitchHelix.js';

const login = process.argv[2];
if (!login) {
  console.error('Usage: npm run resolve -- <twitch_login>');
  process.exit(1);
}

const token = await getAppAccessToken(config);
const users = await helixGetUsers({ config, token, logins: [login] });

if (users.length === 0) {
  console.error(`No Twitch user found for login: ${login}`);
  process.exit(2);
}

const user = users[0];
console.log(JSON.stringify({ id: user.id, login: user.login, display_name: user.display_name }, null, 2));
