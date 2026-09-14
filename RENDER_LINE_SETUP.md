# Render + LINE LIFF setup

Set these Environment Variables in the Render Web Service:

- `NODE_ENV=production`
- `DATABASE_URL` = Render PostgreSQL Internal Database URL
- `JWT_SECRET` = random text of at least 32 characters
- `UPLOAD_DIR=/tmp/uploads`
- `LIFF_ID` = LIFF ID, for example `2000000000-AbCdEfGh`
- `LINE_LOGIN_CHANNEL_ID` = Channel ID of the LINE Login channel that owns the LIFF app
- `LINE_CHANNEL_SECRET` = Messaging API channel secret (needed for webhook)
- `LINE_CHANNEL_ACCESS_TOKEN` = Messaging API channel access token (needed for notifications)

In LINE Developers Console, edit the existing LIFF app and set Endpoint URL to the Render HTTPS URL, for example:

`https://your-service.onrender.com/`

Enable LIFF scopes `openid` and `profile`. Open the app through:

`https://liff.line.me/<LIFF_ID>`

Important: `LIFF_ID` and `LINE_LOGIN_CHANNEL_ID` must belong to the same LINE Login channel.
