import dotenv from 'dotenv';

dotenv.config();

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function parseCsv(value) {
  if (!value) return [];
  return value
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

export const config = {
  twitch: {
    clientId: required('TWITCH_CLIENT_ID'),
    clientSecret: required('TWITCH_CLIENT_SECRET')
  },
  broadcasters: {
    ids: parseCsv(process.env.BROADCASTER_IDS),
    logins: parseCsv(process.env.BROADCASTER_LOGINS)
  },
  http: {
    port: Number(process.env.PORT || 3000),
    baseUrl: process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`
  }
};
