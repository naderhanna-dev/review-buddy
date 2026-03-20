import 'dotenv/config'
import cors from 'cors'
import express from 'express'

const app = express()

const PORT = Number(process.env.PORT ?? 8787)
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173'
const GITHUB_CLIENT_ID = process.env.GITHUB_OAUTH_CLIENT_ID
const GITHUB_CLIENT_SECRET = process.env.GITHUB_OAUTH_CLIENT_SECRET

app.use(
  cors({
    origin: FRONTEND_ORIGIN,
  }),
)
app.use(express.json())

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

app.post('/api/auth/github/exchange', async (req, res) => {
  if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
    res.status(500).json({
      error:
        'Missing GITHUB_OAUTH_CLIENT_ID or GITHUB_OAUTH_CLIENT_SECRET on the OAuth server.',
    })
    return
  }

  const { code, redirectUri } = req.body ?? {}

  if (!code || typeof code !== 'string') {
    res.status(400).json({ error: 'Missing OAuth code.' })
    return
  }

  if (!redirectUri || typeof redirectUri !== 'string') {
    res.status(400).json({ error: 'Missing redirect URI.' })
    return
  }

  try {
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri,
      }),
    })

    const payload = await tokenResponse.json()

    if (!tokenResponse.ok || payload.error || !payload.access_token) {
      const description = payload.error_description ?? 'Token exchange failed.'
      res.status(400).json({ error: `GitHub OAuth exchange failed: ${description}` })
      return
    }

    res.json({ accessToken: payload.access_token })
  } catch {
    res.status(500).json({ error: 'Unable to exchange OAuth code with GitHub.' })
  }
})

app.listen(PORT, () => {
  process.stdout.write(
    `ReviewRadar OAuth server listening on http://localhost:${PORT}\n`,
  )
})
